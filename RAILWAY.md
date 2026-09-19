# Railway — Umstellung auf Infrastructure as Code

Stand: 19.09.2026

## Worum es geht

Railway hat **Config as Code** (`railway.toml` / `railway.json`) abgekuendigt.
Bestehende Dateien werden noch gelesen, aber nur bis zum **01.12.2026** — das ist
ein harter Cutoff, kein Warnhinweis. Neue Services koennen sich gar nicht mehr
dafuer anmelden. Nachfolger ist **Infrastructure as Code**: eine TypeScript-Datei
unter `.railway/railway.ts`, die nicht nur den Build eines Service beschreibt,
sondern das ganze Projekt — Services, Variablen, Cron-Zeiten, Domains.

Der Unterschied ist nicht nur das Dateiformat. `railway.toml` galt pro Service
und konnte nur sagen „so wirst du gebaut und gestartet". Die IaC-Datei
beschreibt **alle fuenf Services auf einmal**, samt Cron und Env — also genau
das, was bisher nur im Railway-Dashboard stand und nirgends im Repo nachlesbar
war.

Ein Zwischenschritt auf `railway.json` lohnt nicht: das ist dasselbe
abgekuendigte Format in anderer Syntax und stirbt am selben Tag.

## Was in diesem Commit liegt

| Datei | Rolle |
|-------|-------|
| `.railway/railway.ts` | die neue Quelle der Wahrheit — noch nicht angewendet |
| `.railway/tsconfig.json` | damit die Datei ueberhaupt geprueft wird (`rootDir` der Haupt-`tsconfig` ist `src`, die IaC-Datei faellt da raus) |
| `railway.toml` | bleibt unveraendert stehen, mit Hinweis-Header. **Bis `apply` durch ist, steuert weiter sie den Betrieb.** |
| `package.json` | `railway@3.11.0` als devDependency, Script `typecheck:railway` |
| `.github/workflows/ci.yml` | CI prueft die IaC-Datei mit |

Die IaC-Datei ist bis zum `apply` **inert**: Railway liest sie erst, wenn die
Services in Railway von Config as Code auf IaC umgestellt sind. Dieser Commit
aendert am laufenden Betrieb also nichts.

## Die fuenf Services

Aus `tool_configs` in Supabase (`config.railway_instance_id` ist gesetzt):

| Service | TOOL_SLUG | TOOL_CITY | TOOL_MODE | aktiv |
|---------|-----------|-----------|-----------|-------|
| `google-maps-hoi-an` | `google-maps` | `hoi-an` | — | ✅ |
| `google-maps-da-nang` | `google-maps` | `da-nang` | `baseline_only` | ❌ |
| `sitemap-miner` | `sitemap-miner` | `all` | `baseline_only` | ❌ |
| `google-alerts` | `google-alerts` | `all` | — | ❌ |
| `osm-monitor` | `osm-monitor` | `all` | — | ❌ |

**Die Spalte `TOOL_SLUG` ist die Stolperfalle.** Der Service heisst
`google-maps-hoi-an`, `TOOL_SLUG` muss aber `google-maps` sein. `run-tool.ts`
setzt den Config-Slug selbst aus `--slug` + `--city` zusammen und kennt in
`loadToolFactory()` nur die Basis-Slugs. Steht `TOOL_SLUG` auf dem
Service-Namen, stirbt der Lauf mit `Unknown tool slug`. Derselbe Fehler passiert
still, wenn `TOOL_SLUG` gar nicht gesetzt ist: `entrypoint.sh` faellt dann auf
`RAILWAY_SERVICE_NAME` zurueck — und der ist bei den Per-City-Services genau der
falsche Wert.

## Ablauf der Migration

Braucht **Railway CLI >= 5.42.1** (aeltere CLIs nutzen die abgeschaltete
TypeScript-Engine und brechen mit einem Upgrade-Fehler ab).

```bash
railway --version                # muss >= 5.42.1 sein
pnpm install                     # zieht railway@3.11.0 mit rein
railway link                     # Projekt + Environment verknuepfen

railway config plan              # DIFF ANSEHEN — aendert nichts
```

`plan` ist hier kein Formalismus, sondern der eigentliche Pruefschritt (siehe
naechster Abschnitt). Erst wenn der Diff verstanden ist:

```bash
railway config apply             # fragt vor destruktiven Schritten nach
```

Danach, und **erst** danach:

```bash
git rm railway.toml
```

Sicherheitsnetze, die Railway dabei eingebaut hat: `apply` wird abgelehnt, wenn
sich die Umgebung seit dem `plan` geaendert hat; Variablenwerte sind in der
Plan-Ausgabe geschwaerzt; und das Loeschen von Ressourcen oder Variablen
braucht zusaetzlich `--confirm-destructive`, ein verirrtes `--yes` allein reicht
also nicht.

## Was belegt ist — und was nicht

Die Railway-API war aus der Arbeitsumgebung nicht erreichbar (403 der
Egress-Policy auf `backboard.railway.com` und `railway.app`). Es ist derselbe
Blocker, an dem schon der Dependency-Audit haengengeblieben ist. Die Werte in
`.railway/railway.ts` sind deshalb **rekonstruiert**, nicht aus Railway gelesen.

Belegt:

- **Der Deploy laeuft.** `google-maps-hoi-an` hat seit dem Audit-Merge
  (30.08.2026, 05:09 UTC) neun Laeufe hinter sich, alle gruen — vom 31.08. bis
  zum 18.09.2026, je rund 20–27 Minuten. Der offene Punkt aus
  `DEPENDENCY-AUDIT.md` — „der Railway-Deploy selbst ist nicht verifiziert" —
  ist damit durch Produktionsdaten erledigt.
- **Die Cron-Zeit von `google-maps-hoi-an`** ist `0 22 * * 1,3,5`. Alle 52
  Laeufe starteten Mo/Mi/Fr zwischen 22:00 und 22:05 UTC; die Streuung ist die
  Container-Startzeit.

  **Railway wertet Cron in UTC aus** — nicht in der Zeitzone des Dashboards und
  nicht in einer US-Zeitzone. Der Ausdruck oben ist also woertlich UTC. Was er
  lokal bedeutet:

  | Zone | lokale Zeit |
  |------|-------------|
  | UTC | Mo/Mi/Fr 22:00 |
  | Vietnam (UTC+7) | **Di/Do/Sa 05:00** |
  | Deutschland (CEST, UTC+2) | Di/Do/Sa 00:00 |
  | US Eastern (UTC-4) | Mo/Mi/Fr 18:00 |

  Wichtig ist der Tagessprung: lokal laeuft das Tool **Di/Do/Sa**, nicht
  Mo/Mi/Fr. Wer eine Cron-Zeit von lokal nach UTC umrechnet, muss die
  Wochentagsfelder mit verschieben — sonst stimmt die Stunde und der Tag nicht.
- **`tsx` startet trotz blockiertem esbuild-Postinstall.** pnpm 10 fuehrt
  `esbuild@0.28.2`s Build-Script nicht aus; das Binary kommt aus dem
  Plattform-Paket `@esbuild/linux-x64`. `./node_modules/.bin/tsx --version`
  funktioniert nach `pnpm install --frozen-lockfile` auf Node 22, der
  Untergrenze von `engines`.
- **Die IaC-Datei ist gueltig.** `validateGraph()` aus dem SDK meldet keine
  Fehler, die fuenf Adressen sind eindeutig, die Secrets kompilieren zu
  `preserve` statt zu Literalen.

Nicht belegt — gehoert in den `plan`-Diff:

- **Die Cron-Zeiten der vier inaktiven Services.** Sie sind aus
  `tool_configs.schedule` uebernommen. Genau diese Spalte weicht bei
  `google-maps-hoi-an` aber nachweislich von Railway ab: sie sagt
  `0 6 * * 1,3,5`, Railway feuert `0 22 * * 1,3,5`. Gesteuert wird der Lauf von
  Railway, nicht von der Spalte.

  Die Differenz laesst sich mit keiner Zeitzone sauber wegrechnen: `0 6` wuerde
  22:00 UTC nur in UTC+8 entsprechen, und dann waeren die Wochentage Di/Do/Sa
  statt Mo/Mi/Fr. Denkbar ist also eine halbe Umrechnung (Stunde verschoben,
  Wochentag nicht) — oder die Spalte wurde einfach nie nachgezogen. Solange das
  nicht geklaert ist, ist sie als Quelle fuer die anderen vier schwach.
- **Die Env-Variablen der Services.** Fuer `google-maps-hoi-an` sind sie aus dem
  Laufverhalten ableitbar, bei den anderen vier nicht. Ein leerer Diff bestaetigt
  sie; alles andere ist zu klaeren, bevor `apply` laeuft.

Ein Diff bei den `TOOL_*`-Variablen ist also **kein Rauschen**, sondern die
Antwort auf eine offene Frage.

## Danach

1. **Builder auf Railpack** — eigener Plan, siehe unten.
2. **`tool_configs.schedule` aufraeumen.** Die Spalte suggeriert eine Steuerung,
   die sie nicht hat, und steht bei `google-maps-hoi-an` auf einem falschen Wert.
   Entweder aus der IaC-Datei nachziehen oder im Admin-UI als reine Anzeige
   kennzeichnen.
3. **`TOOL_MODE` gegen Tippfehler absichern.** `entrypoint.sh` kennt nur
   `baseline_only` und `dry_run` und verwirft alles andere still — derselbe
   Fehler, der auf der DB-Seite mit PR #3 behoben wurde (`Unknown
   run_config.mode ... — ignored`). Auf der Env-Seite steht er noch offen.

---

# Plan: Nixpacks -> Railpack

Railpack ist der Nachfolger von Nixpacks und auf Railway inzwischen der
Standard-Builder. Der Wechsel ist **nicht** das Umlegen eines Schalters: die
beiden Builder ermitteln die Node-Version unterschiedlich, und dieses Repo
haengt an genau dieser Stelle an einer bewussten Entscheidung.

## Warum das nicht trivial ist

`package.json` steht auf `"engines": { "node": ">=22 <25" }`. Die Obergrenze ist
Absicht: Nixpacks nimmt aus der Range den hoechsten verfuegbaren LTS-Major, und
ohne `<25` wuerde der Build mitwandern, sobald Nixpacks eine neue Major aufnimmt.

Railpack loest anders auf. Reihenfolge laut Quellcode des Node-Providers:

```
RAILPACK_NODE_VERSION  >  package.json engines.node  >  mise-Dateien (.nvmrc, .node-version)  >  Default "lts"
```

Zwei Konsequenzen fuer dieses Repo:

- **`.nvmrc` (24) verliert.** `engines.node` steht darueber. Heute ist das
  folgenlos, weil beide auf 24 hinauslaufen sollten — aber die Datei ist dann
  Dekoration, nicht Steuerung.
- **Die Range geht woertlich an mise.** Railpack reicht den String
  `">=22 <25"` unveraendert weiter und laesst mise aufloesen. Neuere mise-
  Versionen koennen npm-Semver-Ranges und wuerden die hoechste passende Version
  waehlen (also 24, wie heute). Aeltere mise-Versionen haben Range-Operatoren
  abgeschnitten und daraus ein Praefix gemacht — aus `>=22 <25` wuerde dann
  etwas anderes als 24, im schlechtesten Fall ein Parse-Fehler.

Welche mise-Version im Railpack-Image steckt, ist von hier aus nicht
feststellbar. **Das ist die eine Frage, die der Testlauf beantworten muss** —
nicht durch Nachdenken, sondern durch Ablesen.

Das Gute: die Antwort steht schon im Log. `entrypoint.sh` gibt seit dem
Dependency-Audit in Zeile 2 die aufgeloeste Runtime aus:

```
  runtime: node v24.x.x | tsx v4.23.13
```

## Vorbedingung

Die IaC-Migration muss durch sein (`railway config apply`, siehe oben). Dann ist
der Builder-Wechsel eine Ein-Zeilen-Aenderung in `.railway/railway.ts`, und
`railway config plan` zeigt genau diese eine Zeile. Das ist der ganze Punkt der
Aufteilung: ein Diff, eine Ursache.

## Schritt 1 — Kanarienvogel: `google-maps-da-nang`

Nicht mit dem produktiven Service anfangen. `google-maps-da-nang` ist dafuer
ideal und schon da:

- eigener Railway-Service, gleiches Repo, gleiches `entrypoint.sh`
- `is_active = false` in `tool_configs`, seit jeher nie gelaufen
- **`run-tool.ts` steigt bei `is_active = false` sofort mit Exit 0 aus**, bevor
  irgendein Tool geladen wird

Der Lauf schreibt also nichts und kostet keine API-Calls — beweist aber genau
das, was der Builder kaputtmachen kann: Image gebaut, Node aufgeloest, pnpm
installiert, `./node_modules/.bin/tsx` gestartet, `config.ts` geladen, Supabase
erreicht. Tool-Logik kann ein Builder nicht brechen.

```ts
// .railway/railway.ts — nur beim da-nang-Service:
build: { builder: 'RAILPACK' },
```

```bash
railway config plan     # muss GENAU eine Zeile zeigen
railway config apply
```

Dann den Service in Railway einmal manuell starten und im Deploy-Log pruefen:

| Zu pruefen | Erwartung |
|------------|-----------|
| Build laeuft durch | gruen |
| `runtime: node v…` in Zeile 2 | **v24.x** — wie unter Nixpacks |
| pnpm-Version im Build-Log | 10.33.0 (aus `packageManager`) |
| Install-Kommando | `--frozen-lockfile`, kein Lockfile-Update |
| `tsx v4.23.13` in Zeile 2 | vorhanden (nicht leer) |
| letzte Zeile | `[run-tool] Tool "google-maps" is deactivated (is_active=false). Exiting.` |

**Die Node-Major ist das Abbruchkriterium.** Steht dort v22 statt v24, hat mise
die Range anders aufgeloest als Nixpacks. Dann nicht weitermachen, sondern
zuerst die Version explizit festnageln (Schritt 2). Ein leeres `tsx v…` heisst,
das esbuild-Binary fehlt — dann haette Railpack die Plattform-Pakete anders
behandelt als pnpm lokal.

## Schritt 2 — nur falls Schritt 1 die falsche Node-Major liefert

Die Range explizit machen, statt sie zu interpretieren. Zwei Wege, der zweite
ist der ehrlichere:

- `RAILPACK_NODE_VERSION=24` als Service-Variable — hoechste Prioritaet,
  ueberschreibt alles. Schnell, aber die Wahrheit steht dann in Railway und
  nicht im Repo.
- `"engines": { "node": "24.x" }` in der `package.json`. Damit gibt es nichts
  mehr aufzuloesen. Kostet die Untergrenze `>=22`, die bisher verhindert hat,
  dass Code eingecheckt wird, der auf Node 22 fehlt — dafuer muesste die CI-
  Matrix dann beide Majors bauen. Diese Abwaegung gehoert in den PR, nicht in
  einen Kommentar.

Danach Schritt 1 wiederholen.

## Schritt 3 — produktive Services nachziehen

Erst wenn der Kanarienvogel sauber ist. Reihenfolge: die drei uebrigen
inaktiven Services (`sitemap-miner`, `google-alerts`, `osm-monitor`) zusammen,
danach `google-maps-hoi-an` allein.

**Zeitfenster:** `google-maps-hoi-an` feuert Mo/Mi/Fr 22:00 UTC und laeuft
20–27 Minuten. Umstellen direkt nach einem gruenen Lauf, dann sind knapp zwei
Tage Puffer bis zum naechsten — genug, um einen Fehlschlag zu bemerken und
zurueckzudrehen, ohne ein Lauffenster zu verlieren.

## Rollback

Die eine Zeile zurueck auf `'NIXPACKS'`, `railway config plan`, `apply`. Kein
Datenrisiko: die Services sind Einmal-Jobs mit `restartPolicyType: NEVER`, ein
roter Build nimmt nichts vom Netz, er laesst schlimmstenfalls ein Lauffenster
ausfallen. Solange Railway `railway.toml` noch liest (bis 01.12.2026), ist auch
der Weg zurueck auf Config as Code offen.

## Wann das erledigt sein muss

Der Builder-Wechsel hat **keine** Deadline — Nixpacks funktioniert weiter. Die
IaC-Migration hat eine (01.12.2026). Nicht die Reihenfolge verwechseln: erst
das, was ablaeuft, dann das, was besser waere.

