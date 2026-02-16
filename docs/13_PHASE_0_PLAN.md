# Phase 0: Fundament – Detaillierter Plan für Claude Code / Cursor

> **Für:** Claude Code in Cursor
> **Repos:**
> - `alles-neue` → `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue`
> - `alles-neue-tools` → `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools`

---

## ÜBERBLICK: 7 Schritte

```
F1. alles-neue-tools/ Repo initialisieren        (15 Min)
F2. shared/pipeline-client.ts                     (45 Min)
F3. shared/city-config.ts + H3 Grid              (45 Min)
F4. shared/delta-store.ts                         (45 Min)
F5. shared/logger.ts + tool-runner.ts             (30 Min)
F6. Railway Setup                                 (15 Min)
F7. Pipeline Schema erweitern (alles-neue Repo)   (10 Min)
```

---

## F1: REPO INITIALISIEREN

### Ort: `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools`

### Schritt 1: Repo erstellen

```bash
cd "/Users/philipp/Code/Projekte/Alles Neue Portal"
mkdir alles-neue-tools
cd alles-neue-tools
git init
```

### Schritt 2: package.json erstellen

```json
{
  "name": "alles-neue-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "google-maps": "tsx src/google-maps/index.ts",
    "facebook-scout": "tsx src/facebook-scout/index.ts",
    "instagram-scout": "tsx src/instagram-scout/index.ts",
    "alerts": "tsx src/google-alerts/index.ts",
    "sitemap-miner": "tsx src/sitemap-miner/index.ts",
    "osm-monitor": "tsx src/osm-monitor/index.ts",
    "quick-entry": "tsx src/cli/quick-entry.ts",
    "prompt-import": "tsx src/cli/prompt-import.ts",
    "typecheck": "tsc --noEmit",
    "db:types": "npx supabase gen types typescript --project-id yoezwzlqcvitkiwuuqvr > src/shared/database.types.ts"
  },
  "dependencies": {
    "h3-js": "^4.4.0",
    "@turf/boolean-point-in-polygon": "^7.3.0",
    "@turf/distance": "^7.3.0",
    "@supabase/supabase-js": "^2.90.0",
    "fast-xml-parser": "^5.0.0",
    "cheerio": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.21.0",
    "@types/node": "^22.0.0"
  }
}
```

### Schritt 3: tsconfig.json erstellen

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### Schritt 4: .env erstellen

```bash
# .env (NICHT committen!)

# Pipeline API (alles-neue Backend)
PIPELINE_API_URL=https://newaround.com/api/pipeline/leads
PIPELINE_API_KEY=***REMOVED***

# Supabase Direct (für Delta Store)
SUPABASE_URL=https://yoezwzlqcvitkiwuuqvr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=***REMOVED***

# Google Places API
GOOGLE_PLACES_API_KEY=***REMOVED***

# Meta / Facebook / Instagram
META_APP_ID=***REMOVED***
META_USER_ACCESS_TOKEN=***REMOVED***
META_INSTAGRAM_TOKEN=***REMOVED***
META_PAGE_ACCESS_TOKEN=***REMOVED***
META_PAGE_ID=***REMOVED***

# Foursquare
FOURSQUARE_API_KEY=

# Tool Identification
TOOL_ENV=development
```

### Schritt 5: .env.example erstellen (committen!)

```bash
# .env.example
PIPELINE_API_URL=https://newaround.com/api/pipeline/leads
PIPELINE_API_KEY=your_pipeline_api_key

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

GOOGLE_PLACES_API_KEY=your_google_api_key

META_APP_ID=your_meta_app_id
META_USER_ACCESS_TOKEN=your_user_token
META_INSTAGRAM_TOKEN=your_ig_token
META_PAGE_ACCESS_TOKEN=your_page_token
META_PAGE_ID=your_page_id

FOURSQUARE_API_KEY=your_foursquare_key

TOOL_ENV=development
```

### Schritt 6: .gitignore erstellen

```
node_modules/
dist/
.env
*.log
.DS_Store
```

### Schritt 7: Ordnerstruktur anlegen

```bash
mkdir -p src/shared
mkdir -p src/google-maps
mkdir -p src/facebook-scout
mkdir -p src/instagram-scout
mkdir -p src/google-alerts
mkdir -p src/sitemap-miner
mkdir -p src/osm-monitor
mkdir -p src/cli
```

### Schritt 8: Dependencies installieren

```bash
npm install
```

### Schritt 9: GitHub Repo erstellen + Push

```bash
git add .
git commit -m "v0.1.0 🏗️ - Initiales Setup: Repo-Struktur, Dependencies, Config"
gh repo create alles-neue-tools --private --source=. --push
```

---

## F2: SHARED/PIPELINE-CLIENT.TS

### Ort: `src/shared/pipeline-client.ts`

### Was es tut:
POST Requests an die Pipeline API von alles-neue. Jedes Tool nutzt diesen Client um Leads einzuliefern.

### Anforderungen:
- POST an `PIPELINE_API_URL` mit `X-API-Key` Header
- Validierung des Inputs vor dem Senden
- Retry-Logik (1 Retry bei Netzwerk-Fehler)
- Duplikat-Erkennung (409 Response = kein Fehler, nur loggen)
- Batch-Support (mehrere Leads auf einmal)
- Trockenlauf-Modus (`dryRun: true` → nur loggen, nicht senden)

### Interface:

```typescript
interface PipelineLeadInput {
  source: 'facebook' | 'google_maps' | 'instagram' | 'manual' | 'google_alert' |
          'foursquare' | 'osm' | 'foody' | 'tripadvisor' | 'prompt_scout' |
          'job_posting' | 'other';
  source_url?: string | null;
  source_id?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string;                // Default: 'Hoi An'
  category_guess?: 'restaurants' | 'bars' | 'cafes' | 'hotels' | null;
  description?: string | null;
  photos?: string[] | null;
  google_maps_url?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  website?: string | null;
  phone?: string | null;
  raw_data?: Record<string, unknown> | null;
}

interface PipelineResult {
  success: boolean;
  id?: string;
  status?: string;
  duplicate?: boolean;
  error?: string;
}

interface PipelineClient {
  pushLead(lead: PipelineLeadInput, options?: { dryRun?: boolean }): Promise<PipelineResult>;
  pushLeads(leads: PipelineLeadInput[], options?: { dryRun?: boolean }): Promise<PipelineResult[]>;
}
```

### Auch erstellen: `src/shared/config.ts`

```typescript
// Zentrale Env-Var Validierung
// Wirft Fehler wenn Pflicht-Vars fehlen
// Exportiert typisiertes Config-Objekt

interface AppConfig {
  pipeline: {
    apiUrl: string;
    apiKey: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  google: {
    placesApiKey: string;
  };
  meta: {
    appId: string;
    userToken: string;
    instagramToken: string;
    pageToken: string;
    pageId: string;
  };
  foursquare: {
    apiKey: string;
  };
  env: 'development' | 'production';
}
```

---

## F3: SHARED/CITY-CONFIG.TS + H3 GRID

### Ort: `src/shared/city-config.ts`

### Was es tut:
Definiert alle Städte mit ihren Grenzen und H3-Konfiguration. Generiert Grid-Punkte für jeden Scanner.

### Anforderungen:
- Jede Stadt hat: Name, Slug, Land, Boundary Polygon, H3 Resolution, Kategorien
- Optional: Hotspots (Altstadt etc.) mit höherer Resolution
- `generateScanCells(city)` → gibt H3 Cell IDs zurück
- `getCellCenters(cells)` → gibt Lat/Lng Paare zurück
- Deterministisch: selbe City = selbe Cells, immer

### Städte für den Start:

```typescript
const CITIES = {
  hoi_an: {
    name: 'Hoi An',
    slug: 'hoi-an',
    country: 'VN',
    // Bounding Box: ~15.86-15.90 lat, 108.31-108.36 lng
    boundary: [
      [108.310, 15.860], [108.360, 15.860],
      [108.360, 15.900], [108.310, 15.900],
      [108.310, 15.860]
    ],
    resolution: 8,
    categories: ['restaurant', 'cafe', 'bar', 'lodging'],
    hotspots: [{
      name: 'Altstadt',
      boundary: [
        [108.325, 15.875], [108.340, 15.875],
        [108.340, 15.885], [108.325, 15.885],
        [108.325, 15.875]
      ],
      resolution: 9
    }]
  },
  da_nang: {
    name: 'Da Nang',
    slug: 'da-nang',
    country: 'VN',
    boundary: [
      [108.150, 16.010], [108.250, 16.010],
      [108.250, 16.100], [108.150, 16.100],
      [108.150, 16.010]
    ],
    resolution: 8,
    categories: ['restaurant', 'cafe', 'bar', 'lodging']
  }
};
```

### Auch erstellen: `src/shared/h3-grid.ts`

```typescript
// Wrapper um h3-js für unseren Use Case
// generateScanCells(cityConfig) → string[]
// getCellCenter(cellId) → { lat: number, lng: number }
// getHotspotCells(hotspot) → string[]
// mergeCells(mainCells, hotspotCells, mainResolution) → string[]
//   (entfernt Parent-Cells die durch Hotspot-Children ersetzt werden)
```

### Test: Ausgabe validieren

```bash
npx tsx src/shared/city-config.ts
# Erwartete Ausgabe:
# Hoi An: 18 Zellen (Resolution 8) + 14 Hotspot-Zellen (Resolution 9) = 32 Scan-Punkte
# Da Nang: ~130 Zellen (Resolution 8) = 130 Scan-Punkte
```

---

## F4: SHARED/DELTA-STORE.TS

### Ort: `src/shared/delta-store.ts`

### Was es tut:
Speichert bekannte Place IDs in Supabase. Bei jedem Scan vergleicht es: welche IDs sind NEU?

### Anforderungen:
- Supabase-Tabelle: `known_places` (muss in Supabase angelegt werden!)
- Pro Eintrag: source, source_id, city, h3_cell, first_seen, last_seen
- `isKnown(source, sourceId)` → boolean
- `markKnown(source, sourceId, city, h3Cell)` → void
- `findNew(foundIds, source, city)` → string[] (nur neue IDs)
- Batch-fähig (100+ IDs auf einmal prüfen)

### Neue Supabase Tabelle (SQL muss manuell ausgeführt werden):

```sql
-- In Supabase SQL Editor ausführen:

CREATE TABLE IF NOT EXISTS known_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,              -- 'google_maps', 'osm', 'foursquare', etc.
  source_id TEXT NOT NULL,           -- Google Place ID, OSM Node ID, etc.
  city TEXT NOT NULL DEFAULT 'Hoi An',
  h3_cell TEXT,                      -- H3 Cell ID wo gefunden
  name TEXT,                         -- Name zum Zeitpunkt der Entdeckung
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  pushed_to_pipeline BOOLEAN DEFAULT FALSE,
  pipeline_lead_id UUID REFERENCES pipeline_leads(id),

  UNIQUE(source, source_id)         -- Keine Duplikate pro Quelle
);

-- Index für schnelle Lookups
CREATE INDEX idx_known_places_source_id ON known_places(source, source_id);
CREATE INDEX idx_known_places_city ON known_places(city);
CREATE INDEX idx_known_places_first_seen ON known_places(first_seen);

-- RLS deaktiviert (nur Service Role Key hat Zugriff)
ALTER TABLE known_places ENABLE ROW LEVEL SECURITY;
```

### Interface:

```typescript
interface DeltaStore {
  // Prüfe ob IDs bereits bekannt sind
  findNew(entries: { source: string; sourceId: string }[]): Promise<{ source: string; sourceId: string }[]>;

  // Markiere IDs als bekannt
  markKnown(entries: {
    source: string;
    sourceId: string;
    city: string;
    h3Cell?: string;
    name?: string;
  }[]): Promise<void>;

  // Markiere als an Pipeline gesendet
  markPushed(source: string, sourceId: string, pipelineLeadId: string): Promise<void>;

  // Stats
  getStats(city: string): Promise<{ total: number; bySource: Record<string, number> }>;
}
```

---

## F5: SHARED/LOGGER.TS + TOOL-RUNNER.TS

### Ort: `src/shared/logger.ts` + `src/shared/tool-runner.ts`

### logger.ts – Was es tut:
Einheitliches Logging für alle Tools. Structured, mit Timestamp, Tool-Name, Level.

```typescript
// Einfach gehalten, kein winston/pino nötig
// logger.info('Google Maps', 'Found 15 new places in Hoi An')
// logger.error('Facebook', 'Token expired', { tokenAge: '62 days' })
// logger.warn('Instagram', 'Hashtag quota: 28/30 used')

interface Logger {
  info(tool: string, message: string, data?: Record<string, unknown>): void;
  warn(tool: string, message: string, data?: Record<string, unknown>): void;
  error(tool: string, message: string, data?: Record<string, unknown>): void;
  debug(tool: string, message: string, data?: Record<string, unknown>): void;
}

// Format: [2026-02-16 08:00:00] [INFO] [google-maps] Found 15 new places in Hoi An
```

### tool-runner.ts – Was es tut:
Base Class die jedes Tool benutzt. Managed Start/Ende, Logging, Error Handling, tool_runs Tabelle Update.

```typescript
interface ToolRunOptions {
  toolSlug: string;           // 'google-maps', 'facebook-scout', etc.
  city: string;               // 'hoi-an'
  dryRun?: boolean;           // true = nicht an Pipeline senden
}

interface ToolRunReport {
  toolSlug: string;
  city: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  leadsFound: number;
  leadsNew: number;
  leadsPushed: number;
  errors: string[];
  status: 'success' | 'partial' | 'failed';
}

// Base Class
abstract class BaseTool {
  abstract run(city: CityConfig): Promise<ToolRunReport>;

  // Schreibt in Supabase tool_runs Tabelle
  protected async reportRun(report: ToolRunReport): Promise<void>;
}
```

### Supabase Integration:
Die `tool_runs` und `tool_configs` Tabellen existieren bereits in der DB. Der ToolRunner schreibt den Run-Status dort rein, sodass das Admin Dashboard den Fortschritt anzeigen kann.

---

## F6: RAILWAY SETUP

### Kein Code – nur Konfiguration

### Schritt 1: Railway Account
- https://railway.app → Sign Up mit GitHub

### Schritt 2: Projekt erstellen
- "New Project" → "Deploy from GitHub Repo" → `alles-neue-tools`

### Schritt 3: Environment Variables setzen
- Alle Vars aus `.env` in Railway Dashboard eintragen
- `TOOL_ENV=production` setzen

### Schritt 4: railway.toml im Repo erstellen

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "echo 'Tools ready. Trigger via cron or manual.'"
restartPolicyType = "never"
```

### Schritt 5: Cron Jobs (SPÄTER, nicht jetzt)
- Werden erst eingerichtet wenn Tool 1 fertig ist
- Railway Cron: Über Dashboard oder `railway.toml`

### Kosten:
- $5 Free Credit/Monat
- Unsere Tools laufen nur Minuten → weit unter Limit

---

## F7: PIPELINE SCHEMA ERWEITERN

### Ort: `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue`

### Datei: `lib/validations/pipeline.ts`

### Änderung (1 Zeile):

```typescript
// VORHER (Zeile 3):
export const LEAD_SOURCES = ['facebook', 'google_maps', 'instagram', 'manual', 'google_alert', 'other'] as const;

// NACHHER:
export const LEAD_SOURCES = [
  'facebook', 'google_maps', 'instagram', 'manual', 'google_alert',
  'foursquare', 'osm', 'foody', 'tripadvisor', 'prompt_scout', 'job_posting',
  'other'
] as const;
```

### Supabase Constraint prüfen:
Wenn die `pipeline_leads.source` Spalte einen CHECK Constraint hat, muss dieser in Supabase auch erweitert werden:

```sql
-- Prüfen ob ein Constraint existiert:
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'pipeline_leads'::regclass
AND contype = 'c';

-- Falls ja, erweitern:
ALTER TABLE pipeline_leads
DROP CONSTRAINT IF EXISTS pipeline_leads_source_check;

ALTER TABLE pipeline_leads
ADD CONSTRAINT pipeline_leads_source_check
CHECK (source IN (
  'facebook', 'google_maps', 'instagram', 'manual', 'google_alert',
  'foursquare', 'osm', 'foody', 'tripadvisor', 'prompt_scout', 'job_posting',
  'other'
));
```

### Commit:

```bash
cd "/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue"
git add lib/validations/pipeline.ts
git commit -m "v0.2.05 🔧 - Pipeline Schema erweitert: neue Source Types für Discovery Tools"
git push
```

---

## DATEISTRUKTUR NACH PHASE 0

```
alles-neue-tools/
├── package.json
├── tsconfig.json
├── .env                          ← Secrets (gitignored)
├── .env.example                  ← Template (committed)
├── .gitignore
├── railway.toml
│
├── src/
│   ├── shared/
│   │   ├── config.ts             ← Env-Var Validierung
│   │   ├── pipeline-client.ts    ← POST an Pipeline API
│   │   ├── city-config.ts        ← Städte + Boundaries
│   │   ├── h3-grid.ts            ← H3 Grid-Generierung
│   │   ├── delta-store.ts        ← Supabase Known Places
│   │   ├── logger.ts             ← Structured Logging
│   │   ├── tool-runner.ts        ← Base Class für Tools
│   │   ├── types.ts              ← Shared Interfaces
│   │   └── database.types.ts     ← Supabase Generated Types
│   │
│   ├── google-maps/              ← (leer, Phase 2)
│   ├── facebook-scout/           ← (leer, Phase 4)
│   ├── instagram-scout/          ← (leer, Phase 4)
│   ├── google-alerts/            ← (leer, Phase 3)
│   ├── sitemap-miner/            ← (leer, Phase 3)
│   ├── osm-monitor/              ← (leer, Phase 3)
│   └── cli/                      ← (leer, Phase 5)
│
└── node_modules/
```

---

## VALIDIERUNG: IST PHASE 0 FERTIG?

Checkliste – alles muss grün sein bevor Phase 2 startet:

```
□ alles-neue-tools/ Repo auf GitHub (private)
□ npm install funktioniert ohne Fehler
□ npx tsc --noEmit kompiliert ohne Fehler
□ .env hat alle Keys (Pipeline, Supabase, Google, Meta)
□ Pipeline Client: Test-Lead senden + empfangen
□ H3 Grid: Hoi An generiert ~18-32 Zellen
□ Delta Store: known_places Tabelle in Supabase existiert
□ Delta Store: Insert + Query funktioniert
□ Logger: Ausgabe im Terminal sichtbar
□ Tool Runner: Schreibt in tool_runs Tabelle
□ Railway: Projekt existiert, Environment Vars gesetzt
□ alles-neue: LEAD_SOURCES erweitert + deployed
□ Supabase: known_places Tabelle + Indexes angelegt
□ Supabase: Source Constraint erweitert (falls vorhanden)
```

### Quick-Test Script (zum Schluss ausführen):

```typescript
// src/shared/test-foundation.ts
// Testet alle Komponenten:
// 1. Config lädt alle Env-Vars
// 2. H3 generiert Cells für Hoi An
// 3. Delta Store schreibt + liest
// 4. Pipeline Client sendet Test-Lead (dry-run)
// 5. Logger gibt formatierte Ausgabe
// 6. Tool Runner schreibt in tool_runs
```

---

## PROMPT FÜR CLAUDE CODE IN CURSOR

Wenn du in Cursor mit Claude Code arbeitest, nutze diesen Prompt:

```
Ich arbeite am Projekt "alles-neue-tools" – ein TypeScript Tool-Repo
das Discovery-Tools für newaround.com baut.

Repo-Pfad: /Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools
Schwester-Repo: /Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue (Next.js 16)

Lies die Datei /Users/philipp/Code/Projekte/Alles Neue Portal/Coworker/Tools/13_PHASE_0_PLAN.md
für den detaillierten Plan.

Wir arbeiten an Phase 0: Fundament. Starte mit [F1/F2/F3/F4/F5/F6/F7].
```

---

## REIHENFOLGE (WICHTIG)

```
1. F1 (Repo Init)          ← Muss zuerst
2. F7 (Pipeline Schema)    ← Kann parallel, anderes Repo
3. F2 (Pipeline Client)    ← Braucht F1
4. F3 (City Config + H3)   ← Braucht F1
5. F4 (Delta Store)        ← Braucht F1 + Supabase SQL
6. F5 (Logger + Runner)    ← Braucht F1 + F4
7. F6 (Railway)            ← Kann jederzeit, braucht nur GitHub Repo
8. Test Script             ← Braucht alles
```

F1 und F7 parallel möglich (verschiedene Repos). F2, F3, F4 parallel möglich (gleicher Shared-Ordner, keine Abhängigkeiten untereinander). F5 braucht F4 (Tool Runner schreibt in Supabase). F6 ist unabhängig.
