# alles-neue-tools

Discovery-Tools für **New Around** (allesneue). Jedes Tool sucht in einer Quelle nach
neu eröffneten Orten (Restaurants, Cafés, Bars, Hotels) in Hội An und Đà Nẵng und
schiebt gefundene Leads in die Pipeline des Web-Repos.

> Stand: v1.44 + Dependency-Audit (PR #1) · Diese Datei ist die Referenz, wenn du
> länger nicht am Projekt warst.

---

## 1. Wie alles zusammenhängt

```
  Quelle (Google Maps, RSS, OSM, Sitemap, …)
        │
        ▼
  Tool  (src/<tool>/index.ts, erbt von BaseTool)
        │
        ├─► known_places  (Supabase)   Delta-Store: "kenne ich schon?"
        │
        ▼
  POST /api/pipeline/leads  (allesneue)  ──► pipeline_leads (status: new)
        │
        ▼
  Admin-Triage  /admin/pipeline        ──► manuell: Place anlegen (is_draft = true)
        │
        ▼
  Admin veröffentlicht (is_draft = false) ──► öffentlicher Feed  newaround.com
```

Parallel dazu meldet jedes Tool seinen Lauf an `POST/PATCH /api/tools/runs`
→ Tabelle `tool_runs` → sichtbar unter `/admin/tools`.

### Die drei Repos

| Repo | Rolle |
|------|-------|
| `smrk-ai/alles-neue-tools` | dieses Repo — die Discovery-Tools (Node/TS, läuft auf Railway) |
| `smrk-ai/allesneue` | Next.js Web-App: Pipeline-API, Admin, öffentlicher Feed |
| React-Native-App | Mobile-Client (eigenes Repo, siehe `TODO.md` in `allesneue`) |

### Datenbank (Supabase, geteilt mit `allesneue`)

| Tabelle | Wer schreibt | Zweck |
|---------|--------------|-------|
| `cities` | allesneue | Stadt-Boundary (GeoJSON), H3-Resolution, Kategorien, Hotspots. **Wird beim Start jedes Tools geladen** (`loadCities()`) — ohne aktive Stadt startet kein Tool. |
| `known_places` | tools | Delta-Store. `UNIQUE(source, source_id)`. Cross-Source-Dedup über `name_normalized` + `canonical_id`. |
| `api_budget_usage` | tools | Google-Places-Budget pro Tool × SKU × Monat. |
| `tool_configs` | allesneue (Admin-UI) | **Steuerzentrale**: `is_active`, `schedule`, `config.run_config.{city,mode}`, `config.railway_instance_id`. |
| `tool_runs` | tools (via API) | Lauf-Historie, Fehler, Lead-Zähler. |
| `pipeline_leads` | allesneue (via API) | Eingang der Triage. |
| `places` | allesneue | Der veröffentlichte Feed. |

Migrations liegen in `sql/` und werden **manuell** im Supabase SQL-Editor ausgeführt
(001–006). Es gibt kein automatisches Migrations-Tooling in diesem Repo.

---

## 2. Die Tools

| Slug | Quelle | Kosten | Läuft ohne weiteres Setup? |
|------|--------|--------|----------------------------|
| `google-maps` | Places API (H3-Grid-Scan + Details) | Text Search gratis, Details budgetiert | ✅ ja, braucht `GOOGLE_PLACES_API_KEY` |
| `google-alerts` | 18 Google-Alerts-RSS-Feeds (EN + VI) | gratis | ✅ ja, RSS-URLs sind in `src/google-alerts/config.ts` hinterlegt |
| `osm-monitor` | Overpass API | gratis | ✅ ja |
| `sitemap-miner` | Booking.com + Agoda Sitemaps | gratis | ✅ ja (4 Quellen) |
| `facebook-scout` | Meta Graph API Place Search | gratis | ❌ braucht gültigen `META_PAGE_ACCESS_TOKEN` |
| `instagram-scout` | Meta Graph API Hashtag Search | gratis | ❌ braucht gültigen `META_INSTAGRAM_TOKEN` |
| `changedetection` | changedetection.io (self-hosted) | gratis | ❌ Docker-Setup + **10 Watch-UUIDs fehlen** in `src/changedetection/config.ts` |
| `quick-entry` / `prompt-import` | manuell (CLI) | — | ✅ ja |

**Wahrheit über „aktiv"**: `is_active` und `schedule` stehen in der DB-Tabelle
`tool_configs`, nicht im Code. `sql/002_tool_configs_seed.sql` ist nur der
ursprüngliche Seed und kann vom Live-Stand abweichen. Prüfe `/admin/tools`.

### google-maps im Detail

1. **Grid-Scan** — H3-Zellen über die City-Boundary, Text Search „IDs only" (gratis).
2. **Delta** — welche Place-IDs sind in `known_places` noch unbekannt?
3. **Details** — gestaffelt nach Budget: Enterprise (1.000/Monat, inkl. Rating) →
   Pro (5.000/Monat) → `queued` (auf nächsten Monat vertagt).
4. **Cross-Source-Dedup** über normalisierte Namen.
5. **Push** in die Pipeline, in Chunks à 100 — jeder Chunk wird komplett persistiert,
   bevor der nächste startet (Timeout verliert damit nur den laufenden Chunk).

Homestays werden erkannt (`homestay-filter.ts`), in `known_places` behalten, aber
**nicht** in die Pipeline gepusht.

---

## 3. Live-Stand (abgefragt 18.09.2026)

> Direkt aus Supabase (`tool_configs`, `tool_runs`, `pipeline_leads`, `places`,
> `known_places`). Abschnitt 2 sagt, ob ein Tool *laufen koennte* — dieser hier
> sagt, ob es *laeuft*.

**Von 11 Eintraegen in `tool_configs` ist genau einer aktiv.**

| Slug | aktiv | Zeitplan laut `tool_configs` | letzter Lauf | Befund |
|------|-------|------------------------------|--------------|--------|
| `google-maps-hoi-an` | ✅ | `0 6 * * 1,3,5` | 16.09.2026 | laeuft zuverlaessig, 13 Laeufe/30 Tage ohne Fehler |
| `google-alerts` | ❌ | `0 */6 * * *` | 30.08.2026 | letzter Lauf fand 58 neue Eintraege, danach abgeschaltet |
| `osm-monitor` | ❌ | `0 4 * * 0` | 14.07.2026 | `Overpass API error 406` |
| `sitemap-miner` | ❌ | `0 3 * * *` | 05.06.2026 | Modus jetzt `baseline_only` (stand auf `baseline`, wurde ignoriert) |
| `google-maps-da-nang` | ❌ | `0 7 * * 2,6` | nie | **kein Railway-Service** — `railway_instance_id` zeigt ins Leere |
| `changedetection` | ❌ | `0 5 * * *` | 09.03.2026 | Watch-UUIDs leer; **Railway-Service existiert**, aber ohne Cron |
| `facebook-scout` / `instagram-scout` | ❌ | — | nie | Meta-Tokens fehlen |
| `google-maps` | ❌ | — | 21.06.2026 | alter Basis-Slug vor der per-City-Umstellung, Karteileiche |
| `quick-entry` / `prompt-import` | ❌ | — | nie | CLI, wird nicht ueber `tool_runs` getrackt |

> **Die Spalte `Zeitplan` steuert nichts.** Gesteuert wird der Lauf von
> Railway, und dort stehen bei allen vier Cron-Services andere Werte. Der
> Ist-Zustand steht in `RAILWAY.md`.

### Der Trichter

| Stufe | Anzahl |
|-------|--------|
| `known_places` gesamt | 24.206 |
| davon als Lead eingereicht | 1.149 |
| offen, Status `new` | 465 |
| jemals konvertiert | 2 (zuletzt 16.04.2026) |
| oeffentlich im Feed | 13 (neuester 15.05.2026) |

Der Zufluss funktioniert, der Abfluss steht seit vier Monaten. Weitere Tools
anzuschalten vergroessert den Stapel — es fuellt nicht den Feed.

### API-Budget

Unkritisch. September: 40/900 Enterprise-Calls, 7.029 gratis Text-Searches.
Einziger Ausrutscher war Juni 2026 mit 1.730 Enterprise-Calls gegen 1.000
Freikontingent (~18,25 $). 1.417 Google-Maps-Orte in Hoi An sind als bekannt
markiert, aber ohne Details.

### Dokumentation

Research, Roadmaps und Plaene liegen im Vault: `smrk-ai/vaultone`, Ordner
`Projekte/alles-neue/`. Dort steht auch die urspruengliche
`Research/Tools/00_UEBERSICHT_DISCOVERY_TOOLS.md` und die Master-Roadmap. Aus
deren Phase 5 fehlen bis heute `vn-platforms`, `foody-monitor` und `job-monitor`.

---

## 4. Betrieb

### Railway

Jedes Tool ist ein eigener Railway-Service mit `restartPolicyType = never`.
Gesteuert wird seit dem IaC-`apply` (19.09.2026) über den **Startbefehl** in
`.railway/railway.ts`, nicht mehr über Env-Variablen:

```
npm run run-tool -- --slug <basis-slug> [--city <stadt>] [--dry-run] [--baseline-only]
```

`--slug` ist der **Basis-Slug**, nicht der Service-Name. Der Service
`google-maps-hoi-an` startet mit `--slug google-maps --city hoi-an`;
`run-tool.ts` setzt daraus den Config-Slug `google-maps-hoi-an` wieder zusammen.

**`--city` darf bei stadtspezifischen Tools nicht fehlen.** Ohne das Flag greift
der Default `all`, der Config-Slug bleibt der Basis-Slug — und der steht in
`tool_configs` auf `is_active=false`. Der Lauf steigt dann still mit Exit 0 aus,
der Deploy bleibt grün, das Tool tut nichts.

Welche Env-Variablen im Deploy noch wirken:

| Variable | Wirkung |
|----------|---------|
| `TOOL_ENV` | `production` \| `development` — steuert das Log-Level (`src/shared/logger.ts`) |
| `TOOL_MAX_EXECUTION_MIN` | Hard-Timeout, Default 30 min (`src/shared/config.ts`) |
| `TOOL_SLUG`, `TOOL_CITY`, `TOOL_MODE` | **tot im Deploy** — nur `entrypoint.sh` liest sie, und das wird seit dem `apply` nicht mehr aufgerufen. Stehen noch in Railway, wirken aber nicht. |

`--slug run-all` startet alle in `tool_configs` aktiven Tools nacheinander.

Der Admin-Button „Run Now" triggert über die Railway-API
(`config.railway_instance_id` im jeweiligen `tool_configs`-Eintrag).

**Config as Code ist abgekündigt.** Railway liest `railway.toml` nur noch bis
zum 01.12.2026. Die Ablösung liegt als Infrastructure as Code in
`.railway/railway.ts` und beschreibt alle fünf Services (`google-maps-hoi-an`,
`osm-monitor`, `sitemap-miner`, `google-alerts`, `changedetection`) samt Cron
und Env-Variablen. Sie ist mit `railway config pull` aus der Produktion gelesen
und **angewendet** — `railway config plan` meldet keine offene Änderung mehr.
Die `railway.toml` ist damit wirkungslos.

Wichtig seit dem `apply`: der Startbefehl kommt aus der IaC-Datei und umgeht
`entrypoint.sh`. `TOOL_CITY` und `TOOL_MODE` werden deshalb im Deploy **nicht
mehr gelesen** — die Stadt steht als `--city` im Startbefehl. Ablauf, Belege und
offene Punkte: `RAILWAY.md`.

### Lokal

```bash
pnpm install                                   # pnpm-lock.yaml ist das einzige Lockfile
cp .env.example .env                           # Keys eintragen

pnpm run run-tool -- --slug google-maps --city hoi-an --dry-run
pnpm run run-all -- --only google-alerts,osm-monitor
pnpm run q                                     # manueller Einzeleintrag
pnpm run import                                # Bulk-JSON-Import

pnpm run typecheck                             # muss fehlerfrei sein
pnpm run smoke                                 # laedt alle Module, prueft die Deps — ohne Netz
pnpm run test-foundation                       # gegen die echte DB: Config, Pipeline
```

### Toolchain

pnpm ist der einzige Paketmanager (`packageManager` in der `package.json` pinnt die
Version). `engines` steht auf `>=22 <25` — die Obergrenze ist Absicht: Nixpacks nimmt
aus der Range den hoechsten verfuegbaren LTS-Major, ohne sie wuerde der Build
mitwandern, sobald Nixpacks eine neue Major aufnimmt. `@types/node` bleibt bewusst
auf `^22`, also auf der Untergrenze, damit kein Code eingecheckt wird, der nur auf
Node 24 existiert. TypeScript ist auf 7.x.

`.github/workflows/ci.yml` laeuft bei jedem Push und PR: `install --frozen-lockfile`,
`typecheck`, `audit --audit-level=high`, `smoke`.

### Run-Modi

`tool_configs.config.run_config.mode` kennt genau drei Werte:

| Modus | Wirkung |
|-------|---------|
| `normal` (oder nicht gesetzt) | Regelbetrieb: finden, Delta pruefen, in die Pipeline pushen |
| `baseline_only` | **Punkt null aufbauen.** Gefundene Orte werden nur in `known_places` registriert — kein Lead, kein Feed-Eintrag. Laeuft so lange, bis der Bestand vollstaendig eingesammelt ist; danach auf `normal` stellen, und ab dann gilt jeder Fund als echte Neueroeffnung. |
| `dry_run` | Nur loggen, nichts schreiben |

`baseline_only` unterstuetzen `google-maps` und `sitemap-miner`. Ein unbekannter
Wert wird nicht mehr still verworfen, sondern geloggt:
`Unknown run_config.mode "..." — ignored, running in normal mode`.

### Schutzmechanismen

- **Lock**: läuft derselbe Slug seit < 20 min mit Status `running`, bricht der Lauf ab.
- **Hard-Timeout** (30 min) und **SIGTERM-Handler** markieren den Run als `error`,
  statt ihn als Zombie auf `running` hängen zu lassen.
- **Fehlgeschlagene Pushes** werden *nicht* als „known" markiert → nächster Lauf
  versucht sie erneut.

---

## 5. Bekannte Baustellen

- `changedetection`: alle 10 Watch-UUIDs sind leer → Tool kann nicht laufen.
- `facebook-scout` / `instagram-scout`: Meta-Tokens abgelaufen.
- Google-Places-Foto-Referenzen werden abgerufen und bezahlt (`photos.name` im
  Field-Mask), aber beim Lead nur als `photo_count` gespeichert — die URLs gehen
  verloren.

### Erledigt mit PR #1 (Dependency-Audit)

Die frühere Fassung dieses Abschnitts nannte drei Punkte, die inzwischen behoben
sind: der Typecheck-Fehler in `push-baseline-places.ts`, das zweite Lockfile
(`package-lock.json` ist gelöscht), und der `npx`-Aufruf im `entrypoint.sh`
(nutzt jetzt `./node_modules/.bin/tsx`). Dazu sind fünf Schwachstellen im
Abhängigkeitsbaum geschlossen und drei nie importierte Runtime-Pakete entfernt
worden. Details in `DEPENDENCY-AUDIT.md`.

Der dort offen gebliebene Punkt — der Railway-Deploy selbst, mangels Zugang zur
Railway-API nie verifiziert — ist inzwischen durch Produktionsdaten erledigt:
`google-maps-hoi-an` hat seit dem Merge am 30.08.2026 neun Läufe hinter sich,
alle grün, zuletzt am 18.09.2026. Im Deploy-Log steht in Zeile 2 die aufgelöste
Runtime (`runtime: node v… | tsx v…`). Details in `RAILWAY.md`.
