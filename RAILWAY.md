# Railway — Umstellung auf Infrastructure as Code

Stand: 19.09.2026 (apply durch, Regression im Startbefehl gefunden und behoben)

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
| `.railway/railway.ts` | die neue Quelle der Wahrheit — **angewendet** |
| `.railway/tsconfig.json` | damit die Datei ueberhaupt geprueft wird (`rootDir` der Haupt-`tsconfig` ist `src`, die IaC-Datei faellt da raus) |
| `railway.toml` | bleibt vorerst stehen, mit Hinweis-Header. Siehe „Was die `railway.toml` heute noch steuert" |
| `package.json` | `railway@3.11.0` als devDependency, Script `typecheck:railway` |
| `.github/workflows/ci.yml` | CI prueft die IaC-Datei mit |

Die IaC-Datei war bis zum `apply` inert. Das `apply` ist inzwischen gelaufen —
siehe „Stand nach dem apply".

## Herkunft der Werte

`.railway/railway.ts` ist mit **`railway config pull`** aus dem Projekt
`alles-neue-tools`, Environment `production`, erzeugt (19.09.2026) und danach
nur umformatiert und kommentiert — `railway config plan` bestaetigt, dass die
Umformatierung nichts an der Semantik geaendert hat.

Die Werte sind also **gelesen, nicht rekonstruiert**. Das ist der Unterschied zum
ersten Entwurf dieser Migration: der entstand, als die Railway-API aus der
Arbeitsumgebung nicht erreichbar war (403 der Egress-Policy auf
`backboard.railway.com`), und leitete die Services aus `tool_configs` in Supabase
ab. Dieser Abgleich war falsch — siehe naechster Abschnitt.

## Die fuenf Services

Ist-Zustand aus Railway:

| Service | Startbefehl | Cron (UTC) | Builder |
|---------|-------------|------------|---------|
| `google-maps-hoi-an` | `npm run run-tool -- --slug google-maps --city hoi-an` | `0 23 * * 0,2,4` | RAILPACK |
| `osm-monitor` | `npm run run-tool -- --slug osm-monitor` | `0 22 * * *` | RAILPACK |
| `sitemap-miner` | `npm run run-tool -- --slug sitemap-miner` | `0 18 * * *` | RAILPACK |
| `google-alerts` | `npm run run-tool -- --slug google-alerts` | `0 18 * * *` | RAILPACK |
| `changedetection` | `npm run run-tool -- --slug changedetection` | — (nur manuell) | RAILPACK |

Alle fuenf: eine Replica in `europe-west4-drams3a`, `restartPolicyType: NEVER`,
`buildEnvironment: V3`, `runtime: V2`.

### Supabase ist als Quelle unbrauchbar

`tool_configs` in Supabase beschreibt die Railway-Landschaft an drei Stellen
falsch. Wer von dort aus plant, plant an der Produktion vorbei:

| Behauptung in `tool_configs` | Realitaet in Railway |
|------------------------------|----------------------|
| `google-maps-da-nang` hat einen Railway-Service | **existiert nicht** |
| `changedetection` hat keinen Railway-Service | **existiert** |
| `schedule` von `google-maps-hoi-an` = `0 6 * * 1,3,5` | `0 22 * * 1,3,5` |
| `schedule` von `sitemap-miner` = `0 3 * * *` | `0 18 * * *` |
| `schedule` von `google-alerts` = `0 */6 * * *` | `0 18 * * *` |
| `schedule` von `osm-monitor` = `0 4 * * 0` | `0 22 * * *` |

Gesteuert wird der Lauf von Railway, nicht von der Spalte. `tool_configs.schedule`
ist reine Anzeige und seit unbekannter Zeit nicht nachgezogen.

### `TOOL_SLUG` ist der Basis-Slug

Der Service heisst `google-maps-hoi-an`, `TOOL_SLUG` muss aber `google-maps`
sein. `run-tool.ts` setzt den Config-Slug selbst aus `--slug` + `--city`
zusammen und kennt in `loadToolFactory()` nur die Basis-Slugs. Steht `TOOL_SLUG`
auf dem Service-Namen, stirbt der Lauf mit `Unknown tool slug`.

In der IaC-Datei stehen die `TOOL_*`-Variablen als `preserve()` — sie werden
weiter im Dashboard gepflegt. `apply` kann sie damit weder ueberschreiben noch
loeschen.

## Was die `railway.toml` gesteuert hat

**Korrektur.** Eine fruehere Fassung dieses Dokuments hat hier „vermutlich
nichts" behauptet. Das war falsch, und die Fehlannahme hat direkt die Regression
verursacht, die unter „Stand nach dem apply" steht.

Richtig ist: `startCommand = "bash entrypoint.sh"` war bis zum 18.09.2026 aktiv.
Der Beleg steht im Deployment-Log dieses Tages — `▶ Starting tool: google-maps
(city: hoi-an)` kann nur aus `entrypoint.sh` kommen, `run-tool.ts` gibt diese
Zeile nicht aus. Alle 52 bisherigen Laeufe von `google-maps-hoi-an` sind ueber
dieses Skript gegangen, und es hat dabei `--city "$TOOL_CITY"` angehaengt.

Erst seit dem `apply` gilt der IaC-Startbefehl, und der ruft `run-tool.ts`
direkt auf. Konsequenzen:

- **`entrypoint.sh` wird im Deploy ab jetzt nicht mehr aufgerufen** — belegt,
  nicht vermutet. Der Fallback auf `RAILWAY_SERVICE_NAME` und die Runtime-Zeile
  `runtime: node v… | tsx v…` greifen im Railway-Lauf nicht mehr. Lokal ist das
  Skript weiter nutzbar.
- **`TOOL_CITY` und `TOOL_MODE` sind im Deploy tote Variablen.** Nur
  `entrypoint.sh` liest sie; `grep -rn "TOOL_CITY" src/` ist leer. Was sie
  frueher gesteuert haben, muss jetzt im Startbefehl der IaC-Datei stehen.
- **Der frueher geplante Schritt „Nixpacks -> Railpack" ist erledigt**, bevor er
  angefangen hat. Er steht deshalb nicht mehr in diesem Dokument.

Die Datei ist jetzt wirkungslos — der Builder steht auf RAILPACK, der
Startbefehl kommt aus der IaC. Sie kann weg, sobald ein Lauf mit dem
`--city`-Fix gruen war.

## Ablauf der Migration

Braucht **Railway CLI >= 5.42.1** (aeltere CLIs nutzen die abgeschaltete
TypeScript-Engine und brechen mit einem Upgrade-Fehler ab).

```bash
railway --version                # muss >= 5.42.1 sein
pnpm install                     # zieht railway@3.11.0 mit rein
railway link                     # Projekt + Environment verknuepfen

railway config plan              # DIFF ANSEHEN — aendert nichts
```

Erwartet wird **genau eine** Aenderung:

```
Plan: 0 to add, 1 to change, 0 to destroy
  ~ Update google-maps-hoi-an deploy.cronSchedule
    └ deploy.cronSchedule ("0 22 * * 1,3,5" → "0 23 * * 0,2,4")
```

Sieht der Plan anders aus, wurde in Railway von Hand verstellt — dann erst
klaeren, nicht anwenden. Sonst:

```bash
railway config apply             # fragt vor destruktiven Schritten nach
```

Danach einen gruenen Lauf von `google-maps-hoi-an` abwarten, und **erst** dann:

```bash
git rm railway.toml
```

Sicherheitsnetze, die Railway eingebaut hat: `apply` wird abgelehnt, wenn sich
die Umgebung seit dem `plan` geaendert hat; Variablenwerte sind in der
Plan-Ausgabe geschwaerzt; und das Loeschen von Ressourcen oder Variablen braucht
zusaetzlich `--confirm-destructive`, ein verirrtes `--yes` allein reicht also
nicht.

## Die eine beabsichtigte Aenderung

Alles an dieser Migration bildet den Ist-Zustand ab — mit **einer** Ausnahme:
die Cron-Zeit von `google-maps-hoi-an`.

| | Cron (UTC) | lokal (Vietnam, UTC+7) |
|---|---|---|
| heute in Railway | `0 22 * * 1,3,5` | Di/Do/Sa 05:00 |
| gewollt | `0 23 * * 0,2,4` | **Mo/Mi/Fr 06:00** |

**Railway wertet Cron in UTC aus** — nicht in der Zeitzone des Dashboards.
Umrechnung ICT -> UTC (Vietnam hat keine Sommerzeit, dauerhaft UTC+7):

```
Mo 06:00 ICT  =  So 23:00 UTC   -> cron-Wochentag 0
Mi 06:00 ICT  =  Di 23:00 UTC   -> 2
Fr 06:00 ICT  =  Do 23:00 UTC   -> 4
```

**Der Wochentag rutscht einen zurueck**, weil 06:00 minus sieben Stunden ueber
Mitternacht faellt. Nur die Stunde umzurechnen und `1,3,5` stehen zu lassen,
waere um genau einen Tag daneben.

**Zeitfenster:** der Service laeuft 20–27 Minuten. Umstellen direkt nach einem
gruenen Lauf, dann sind knapp zwei Tage Puffer bis zum naechsten.

## Belegt

- **Der Deploy laeuft.** `google-maps-hoi-an` hat seit dem Audit-Merge
  (30.08.2026, 05:09 UTC) neun Laeufe hinter sich, alle gruen — vom 31.08. bis
  zum 18.09.2026, je rund 20–27 Minuten. Der offene Punkt aus
  `DEPENDENCY-AUDIT.md` — „der Railway-Deploy selbst ist nicht verifiziert" —
  ist damit durch Produktionsdaten erledigt.
- **Der Plan-Diff.** `railway config plan` gegen die Produktionsumgebung zeigt
  die eine Cron-Zeile und sonst nichts. Services, Startbefehle, Regionen und
  Variablen decken sich also mit der Datei.
- **Die IaC-Datei ist gueltig.** `pnpm run typecheck:railway` ist gruen, die
  fuenf Adressen sind eindeutig, die Variablen kompilieren zu `preserve` statt
  zu Literalen.

## Stand nach dem `apply`

`railway config apply` ist am 19.09.2026 gelaufen. `railway config plan` (CLI
5.57.11) meldet seitdem „Your Railway configuration is already up to date" —
alle fuenf Services, Startbefehle, Cron-Zeiten, Regionen, Replicas,
Restart-Policies und Variablennamen decken sich mit der Datei. Die Cron-Zeit von
`google-maps-hoi-an` steht live auf `0 23 * * 0,2,4`, die beabsichtigte
Aenderung ist also drin.

### Die Regression, die das `apply` ausgeloest hat

Der neue Startbefehl umgeht `entrypoint.sh` — und damit ging das `--city`-Flag
verloren. Die Kette:

1. Startbefehl war `npm run run-tool -- --slug google-maps`, **ohne `--city`**.
2. `run-tool.ts` Zeile 91: `city: flagValue('--city') ?? 'all'` → `all`.
3. Zeile 115: `configSlug = opts.city !== 'all' ? slug-city : slug` → **`google-maps`**,
   nicht `google-maps-hoi-an`.
4. In `tool_configs` steht `google-maps` auf `is_active=false`
   (`google-maps-hoi-an` steht auf `true`).
5. Zeile 118: `if (dbConfig.isActive === false) { … process.exit(0) }` — stiller
   Exit 0. Kein Lauf, kein `tool_runs`-Eintrag, kein Fehler, **gruener Deploy**.

Der naechste Cron-Lauf (So 20.09.2026, 23:00 UTC) waere durchgelaufen und haette
nichts getan. Behoben durch `--city hoi-an` im Startbefehl der IaC-Datei.

**Warum es vorher lief:** alle 52 bisherigen Laeufe gingen ueber
`entrypoint.sh`, das `--city "$TOOL_CITY"` anhaengt. Die Annahme weiter oben in
diesem Dokument — die `railway.toml` steuere „vermutlich nichts" — war damit
falsch: sie hat bis zum 18.09.2026 sehr wohl gesteuert. Der Beleg steht im
Deployment-Log vom 18.09.: `▶ Starting tool: google-maps (city: hoi-an)` ist
eine Ausgabe aus `entrypoint.sh`, nicht aus `run-tool.ts`.

**Folge fuer `TOOL_CITY` und `TOOL_MODE`:** beide werden von `src/` nirgends
gelesen (`grep -rn "TOOL_CITY" src/` ist leer) — nur `entrypoint.sh` liest sie.
Im IaC-Pfad sind sie tote Variablen. Wer die Stadt oder den Modus aendern will,
muss den Startbefehl in `.railway/railway.ts` aendern, nicht die Env-Variable im
Dashboard.

## Danach

1. **`railway.toml` entfernen** — `apply` ist durch, es fehlt noch ein gruener
   Lauf mit dem `--city`-Fix (So 20.09., 23:00 UTC). Erst danach loeschen.
2. **`tool_configs.schedule` aufraeumen.** Die Spalte suggeriert eine Steuerung,
   die sie nicht hat, und steht bei allen vier Cron-Services auf falschen Werten.
   Entweder aus der IaC-Datei nachziehen oder im Admin-UI als reine Anzeige
   kennzeichnen.
3. **`config.railway_instance_id` korrigieren.** Der Eintrag fuer
   `google-maps-da-nang` zeigt auf einen Service, den es nicht gibt;
   `changedetection` hat einen Service, aber keinen Eintrag.
4. **`entrypoint.sh` klaeren.** Wird im Railway-Deploy nicht mehr aufgerufen
   (belegt, nicht mehr vermutet — siehe „Die Regression"). Entweder als reines
   Lokal-Skript kennzeichnen oder entfernen. Solange es liegen bleibt, suggeriert
   es eine `TOOL_CITY`/`TOOL_MODE`-Steuerung, die es im Deploy nicht mehr gibt.
5. **`TOOL_MODE` gegen Tippfehler absichern.** `entrypoint.sh` kennt nur
   `baseline_only` und `dry_run` und verwirft alles andere still — derselbe
   Fehler, der auf der DB-Seite mit PR #3 behoben wurde (`Unknown
   run_config.mode ... — ignored`). Auf der Env-Seite steht er noch offen.
