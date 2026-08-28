# alles-neue-tools

Discovery-Tools für **New Around** (allesneue). Jedes Tool sucht in einer Quelle nach
neu eröffneten Orten (Restaurants, Cafés, Bars, Hotels) in Hội An und Đà Nẵng und
schiebt gefundene Leads in die Pipeline des Web-Repos.

> Stand: v1.44 · Diese Datei ist die Referenz, wenn du länger nicht am Projekt warst.

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
| `google-alerts` | 19 Google-Alerts-RSS-Feeds (EN + VI) | gratis | ✅ ja, RSS-URLs sind in `src/google-alerts/config.ts` hinterlegt |
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

## 3. Betrieb

### Railway

Jedes Tool ist ein eigener Railway-Service mit `startCommand = bash entrypoint.sh`
und `restartPolicyType = never`. Gesteuert wird über Env-Variablen:

| Variable | Wirkung |
|----------|---------|
| `TOOL_SLUG` | welches Tool (Fallback: `RAILWAY_SERVICE_NAME`). Leer oder `alles-neue-tools` → Exit 0. |
| `TOOL_CITY` | `hoi-an`, `da-nang` oder `all` (Default) |
| `TOOL_MODE` | `baseline_only` \| `dry_run` \| leer |
| `TOOL_MAX_EXECUTION_MIN` | Hard-Timeout, Default 30 min |

`TOOL_SLUG=run-all` startet stattdessen alle in `tool_configs` aktiven Tools nacheinander.

Der Admin-Button „Run Now" triggert über die Railway-API
(`config.railway_instance_id` im jeweiligen `tool_configs`-Eintrag).

### Lokal

```bash
pnpm install                                   # pnpm-lock.yaml ist das gepflegte Lockfile
cp .env.example .env                           # Keys eintragen

pnpm run run-tool -- --slug google-maps --city hoi-an --dry-run
pnpm run run-all -- --only google-alerts,osm-monitor
pnpm run q                                     # manueller Einzeleintrag
pnpm run import                                # Bulk-JSON-Import
pnpm run test-foundation                       # Smoke-Test: DB, Config, Pipeline
```

### Schutzmechanismen

- **Lock**: läuft derselbe Slug seit < 20 min mit Status `running`, bricht der Lauf ab.
- **Hard-Timeout** (30 min) und **SIGTERM-Handler** markieren den Run als `error`,
  statt ihn als Zombie auf `running` hängen zu lassen.
- **Fehlgeschlagene Pushes** werden *nicht* als „known" markiert → nächster Lauf
  versucht sie erneut.

---

## 4. Bekannte Baustellen (Stand v1.44)

- `npm run typecheck` schlägt fehl: `src/cli/push-baseline-places.ts:45` —
  `mapCategory(types)` bekommt `string[] | undefined`.
- `package-lock.json` ist **nicht** synchron zu `package.json` → `npm ci` bricht ab.
  Es existieren zwei Lockfiles; `pnpm-lock.yaml` ist der gepflegte Stand.
- `tsx` und `typescript` stehen in `devDependencies`, `entrypoint.sh` ruft sie aber
  zur Laufzeit über `npx` auf — bei einem Prod-Install ohne devDeps ist das fragil.
- `changedetection`: alle 10 Watch-UUIDs sind leer → Tool kann nicht laufen.
- `facebook-scout` / `instagram-scout`: Meta-Tokens abgelaufen.
- Google-Places-Foto-Referenzen werden abgerufen und bezahlt (`photos.name` im
  Field-Mask), aber beim Lead nur als `photo_count` gespeichert — die URLs gehen
  verloren.
