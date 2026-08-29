# Dependency-Audit — alles-neue-tools

Erhoben am 2026-08-29 gegen `89180ce` (v1.44).
Versionsstände live aus der npm-Registry, Schwachstellen aus `npm audit` / `pnpm audit`.
Schritte 1 und 4 wurden vorab in einer separaten Installation vollständig durchgespielt.

Ausführliche Fassung: siehe Artifact-Link im zugehörigen Chat.

---

## Zusammenfassung

| | |
|---|---|
| Offene Schwachstellen | **5** (4 hoch, 1 niedrig) |
| Ungenutzte Runtime-Dependencies | **3 von 7** |
| Konkurrierende Lockfiles | **2** |
| Typecheck auf `main` | **rot** (1 vorbestehender Fehler) |
| CI | **nicht vorhanden** |

---

## Befunde

### 1. Fünf Schwachstellen im Abhängigkeitsbaum (hoch)

- `undici 7.22.0` — 16 Advisories (Request-Smuggling, CRLF-Injection, WebSocket-DoS). Kommt über `cheerio`, das ungenutzt ist.
- `fast-xml-parser 5.5.9` — 3 Advisories, direkte Abhängigkeit.
- `fast-xml-builder 1.0.0` — XML-Comment-/CDATA-Injection, transitiv über `fast-xml-parser`.
- `ws 8.19.0` — uninitialisierter Speicher, Memory-Exhaustion. Über `@supabase/realtime-js`.
- `esbuild 0.27.3` — niedrig, nur Windows-Dev-Server. Über `tsx`.

Einordnung: `sitemap-fetcher.ts` und `rss-parser.ts` setzen beide `processEntities: false`,
und `XMLBuilder` wird nirgends instanziiert — die XML-Advisories greifen praktisch nicht.
Der Fix ist trotzdem kostenlos.

**Verifiziert:** Nach Schritt 1 meldet `pnpm audit` "No known vulnerabilities found".

### 2. Drei tote Runtime-Dependencies (hoch)

`cheerio`, `@turf/boolean-point-in-polygon`, `@turf/distance` — kein einziger Import in `src/`.
Geometrie läuft vollständig über `h3-js`, HTML wird nicht geparst.
`cheerio` ist der einzige Grund, warum `undici` im Baum liegt.

### 3. Zwei widersprüchliche Lockfiles (hoch)

`package-lock.json` (2026-03-09) vs. `pnpm-lock.yaml` (2026-04-01), unterschiedliche Versionen
(`fast-xml-parser` 5.4.2 vs. 5.5.9). Welches auf Railway gewinnt, entscheidet nixpacks.
Build ist nicht reproduzierbar.

### 4. Typecheck bereits rot auf `main` (mittel)

```
src/cli/push-baseline-places.ts(45,19): error TS2345:
  Argument of type 'string[] | undefined' is not assignable to parameter of type 'string[]'.
```

Einzeiler-Fix. Problem ist das fehlende CI — es gibt kein `.github/workflows/`.

### 5. Node-Version / Typen (mittel)

- `engines: node >=20` — Node 20 ("Iron") ist EOL (letztes Release 2026-03). Aktuelles LTS: Node 24 ("Krypton").
- `@types/node ^25.5.0` auf Node-22-Runtime: Typen beschreiben APIs, die zur Laufzeit fehlen.

### 6. Ungepinnte Ausführungspfade (niedrig)

- `docker/docker-compose.changedetection.yml`: `changedetection.io:latest`, `sockpuppetbrowser:latest`
- `entrypoint.sh`: `npx tsx` statt lokalem Binary
- `db:types`: `npx supabase` ohne Version

---

## Versionsstand

| Paket | Installiert | Aktuell | Rückstand | Empfehlung |
|---|---|---|---|---|
| cheerio | 1.2.0 | 1.2.0 | — | **Entfernen** (ungenutzt, schleppt `undici` ein) |
| @turf/boolean-point-in-polygon | 7.3.4 | 7.4.0 | 7 Mon. | **Entfernen** (ungenutzt) |
| @turf/distance | 7.3.4 | 7.4.0 | 7 Mon. | **Entfernen** (ungenutzt) |
| fast-xml-parser | 5.5.9 | 5.11.1 | 5 Mon. | `^5.11.1` — behebt 3 Advisories |
| @supabase/supabase-js | 2.101.1 | 2.112.4 | 5 Mon. | `^2.112.4` — zieht sicheres `ws` nach |
| tsx | 4.21.0 | 4.23.12 | 9 Mon. | `^4.23.12` — zieht sicheres `esbuild` nach |
| h3-js | 4.4.0 | 4.5.0 | 8 Mon. | `^4.5.0` |
| dotenv | 17.3.1 | 17.4.2 | 6 Mon. | `^17.4.2` |
| @types/node | 25.5.0 | 26.4.0 | 5 Mon. | **Nicht** auf 26 — auf `^22.20.1` (Runtime-Match) |
| typescript | 5.9.3 | 7.0.2 | 11 Mon., 2 Majors | eigener Schritt (siehe 4) |

---

## Plan — fünf einzeln abfeuerbare Schritte

Jeder Schritt: eigener Branch, eigener PR, eigene Prüfung.
Jeder Prompt funktioniert ohne den Ursprungs-Chat.

### Schritt 1 — Sicherheit und Ballast (getestet, ~10 Min.)

```
Im Repo smrk-ai/alles-neue-tools, Branch claude/deps-step1-security:

1. Aus package.json entfernen (in src/ nirgends importiert, bitte vorher per
   grep gegenprüfen): cheerio, @turf/boolean-point-in-polygon, @turf/distance
2. Anheben: @supabase/supabase-js ^2.112.4, dotenv ^17.4.2,
   fast-xml-parser ^5.11.1, h3-js ^4.5.0, tsx ^4.23.12
3. package-lock.json löschen. pnpm ist der einzige Paketmanager, pnpm-lock.yaml
   bleibt. In package.json ein Feld "packageManager": "pnpm@10.33.0" ergänzen.
4. pnpm install, dann pnpm audit und pnpm typecheck ausführen.

Erwartung: pnpm audit meldet keine Schwachstellen. Der Typecheck zeigt genau
einen Fehler in src/cli/push-baseline-places.ts:45 — der ist vorbestehend und
wird hier NICHT gefixt.

Committen und pushen. Ausgabe von pnpm audit im PR zitieren.
```

### Schritt 2 — Node-Version und Startpfad festnageln (Deploy prüfen, ~20 Min.)

```
Im Repo smrk-ai/alles-neue-tools, Branch claude/deps-step2-runtime:

1. package.json: "engines": { "node": ">=22" } statt ">=20" (Node 20 ist EOL).
   Wenn Railway Node 24 unterstützt, lieber ">=22 <25" plus .nvmrc mit 24 —
   bitte kurz prüfen und im PR begründen, was du gewählt hast.
2. @types/node von ^25.5.0 auf ^22.20.1 herunterziehen. Grund: Die Runtime ist
   Node 22; Typen für Node 25/26 beschreiben APIs, die zur Laufzeit fehlen.
   Der Downgrade ist Absicht.
3. entrypoint.sh: "npx tsx" durch "pnpm exec tsx" ersetzen, damit zur Laufzeit
   nichts aus dem Netz nachgeladen wird. Prüfen, dass das im Railway-Container
   funktioniert (pnpm muss dort verfügbar sein) — falls nicht, stattdessen
   ./node_modules/.bin/tsx verwenden.
4. pnpm install && pnpm typecheck.

Erwartung: weiterhin nur der eine vorbestehende Fehler in
push-baseline-places.ts:45.

Committen und pushen. Im PR notieren, was am Deploy zu verifizieren ist,
bevor gemerged wird.
```

### Schritt 3 — Typecheck grün und CI (empfohlen, ~20 Min.)

```
Im Repo smrk-ai/alles-neue-tools, Branch claude/deps-step3-ci:

1. src/cli/push-baseline-places.ts Zeile 45: mapCategory(types) schlägt fehl,
   weil types den Typ string[] | undefined hat. Sauber fixen
   (z.B. mapCategory(types ?? [])) — aber erst nachsehen, wie mapCategory an
   anderen Stellen aufgerufen wird, und konsistent dazu lösen.
2. .github/workflows/ci.yml anlegen: läuft bei push und pull_request, Node 22,
   pnpm mit --frozen-lockfile, dann pnpm typecheck und
   pnpm audit --audit-level=high.
3. Prüfen, dass pnpm typecheck jetzt komplett fehlerfrei durchläuft.

Committen und pushen.
```

### Schritt 4 — TypeScript 5.9 → 7.0 (getestet, optional)

Vorab durchgespielt: TS 7.0.2 gegen den vollständigen Quellbaum. Es braucht exakt
zwei tsconfig-Änderungen, danach identisches Ergebnis zu TS 5.9 — kein neuer
Fehler. Typecheck-Dauer: **0,4 s statt 2,35 s**.

- `baseUrl` + `paths` raus: `baseUrl` ist in TS 7 entfernt, und der Alias `@shared/*`
  wird im gesamten Repo nirgends verwendet (alle Importe relativ).
- `"types": ["node"]` rein: TS 6+ zieht Ambient-Typen nicht mehr automatisch;
  ohne diese Zeile kennt der Compiler `process` und `Buffer` nicht.

```
Im Repo smrk-ai/alles-neue-tools, Branch claude/deps-step4-ts7.
Setzt Schritt 3 voraus (Typecheck muss grün sein).

1. tsconfig.json: baseUrl und paths ersatzlos entfernen. Der Alias @shared/*
   wird nirgends benutzt — bitte per grep bestätigen, bevor du löschst.
2. tsconfig.json: "types": ["node"] in compilerOptions ergänzen. Ohne das
   kennt TS 6+ process/Buffer nicht mehr.
3. typescript auf ^7.0.2 anheben.
4. pnpm typecheck — muss vollständig fehlerfrei sein.
5. Zusätzlich einen Laufzeit-Smoke-Test: tsx gegen ein paar Module ohne
   Netzwerkzugriff, z.B. src/shared/h3-grid.ts, src/google-alerts/rss-parser.ts,
   src/sitemap-miner/sitemap-fetcher.ts, src/shared/name-matcher.ts importieren
   und prüfen, dass sie laden.

Falls Schritt 4 unerwartete Fehler bringt: Zwischenstufe typescript@6.0.3 mit
"ignoreDeprecations": "6.0" probieren.

Committen und pushen.
```

### Schritt 5 — Infrastruktur pinnen (optional, ~15 Min.)

```
Im Repo smrk-ai/alles-neue-tools, Branch claude/deps-step5-infra:

1. docker/docker-compose.changedetection.yml: die :latest-Tags für
   ghcr.io/dgtlmoon/changedetection.io und dgtlmoon/sockpuppetbrowser durch
   konkrete, aktuelle Versions-Tags ersetzen. Bitte die tatsächlich verfügbaren
   Tags nachschlagen, nicht raten.
2. package.json, Script db:types: "npx supabase" auf eine feste Version pinnen
   (npx supabase@<version>) oder supabase als devDependency aufnehmen.
3. Im Kommentarkopf der Compose-Datei einen kurzen Hinweis ergänzen, wie man
   die Images bewusst aktualisiert.

Committen und pushen.
```

---

## Bewusst nicht empfohlen

**`@types/node` auf 26.4.0.** Zwar "latest", aber falsch: Die Major-Linie folgt der
Node-Major-Linie. Auf einer Node-22-Runtime beschreiben Node-26-Typen APIs, die es
dort nicht gibt. Richtig ist `^22` — bzw. `^24`, falls Schritt 2 auf Node 24 geht.

**Alles in einem PR.** Schritt 1 ist sofort mergebar, Schritt 2 fasst die
Deploy-Runtime an. Kippt das zusammen, hängt auch der Sicherheits-Fix.
Getrennt halten, bis Schritt 2 auf Railway verifiziert ist.
