# Phase 2: Google Maps Discovery Tool – Detaillierter Plan für Claude Code

> **Für:** Claude Code in Cursor
> **Repos:**
> - `alles-neue-tools` → `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools`
> - `alles-neue` → `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue`
> **Voraussetzung:** Phase 0 abgeschlossen (shared/ Infrastruktur steht)
> **Dauer:** ~6-8 Stunden
> **Ergebnis:** Vollautomatischer Google Maps Scanner für Hoi An. $0/Monat.

---

## SCOPE-ENTSCHEIDUNG

### Was in Phase 2 drin ist:
- Google Places API (New) Scanner mit H3 Grid
- 2-Stufen-Strategie (IDs Only → Details nur für Neue)
- Delta Detection über `known_places` Tabelle
- Orchestrator mit City-Config
- Cron-fähig (Railway)

### Was NICHT in Phase 2 ist (→ Backlog):
- ~~OSM Overpass Scanner~~ → Phase 3 (T4: OSM Changeset Monitor)
- ~~Foursquare Scanner~~ → Backlog (nice-to-have, anderer Datenpool)
- ~~Enrichment (Phone, Website, Hours)~~ → Spätere Erweiterung
- ~~Multi-City (Da Nang)~~ → Erst Hoi An perfektionieren

### Warum nur Google:
1. **Beste Datenqualität** für Vietnam (OSM ist in Vietnam dünn)
2. **Kostenlos** für unseren Scale (IDs Only = $0)
3. **Einfachstes Delta-Signal** (Place ID ist deterministisch)
4. **Weniger Komplexität** = schneller fertig = schneller Leads

---

## ÜBERBLICK: 6 SCHRITTE

```
G1. Google Places API Client                    (1.5 Std)
G2. H3 Grid Scanner                             (1.5 Std)
G3. Delta Detection Integration                 (1 Std)
G4. Category Mapper + Lead Transformer           (45 Min)
G5. Orchestrator (index.ts)                      (1 Std)
G6. Tests + Validierung + Erster Scan            (1 Std)
```

### Abhängigkeiten:

```
G1 (API Client)  ──┐
                    ├──→ G5 (Orchestrator) ──→ G6 (Tests)
G2 (Grid Scanner) ─┤
                    │
G3 (Delta)  ────────┤
                    │
G4 (Mapper) ────────┘
```

G1, G2, G3, G4 sind parallel möglich. G5 braucht alle vier. G6 braucht G5.

---

## G1: GOOGLE PLACES API CLIENT

### Ort: `src/google-maps/places-client.ts`

### Was es tut:
Wrapper um die Google Places API (New). Zwei Methoden:
1. **Nearby Search** (IDs Only) — kostenlos, für Grid-Scan
2. **Place Details** (Basic) — Pro Tier, nur für neue Places

### API Endpunkte:

```
Nearby Search:  POST https://places.googleapis.com/v1/places:searchNearby
Place Details:  GET  https://places.googleapis.com/v1/places/{placeId}
```

### Interface:

```typescript
interface PlacesClient {
  // Stufe 1: Nearby Search — NUR IDs (GRATIS)
  searchNearbyIDs(params: {
    lat: number;
    lng: number;
    radius: number;          // in Metern, max 50000
    includedTypes: string[]; // ['restaurant', 'cafe', 'bar', 'lodging']
  }): Promise<string[]>;    // Array von Place IDs

  // Stufe 2: Place Details — Basic Fields (Pro Tier)
  getBasicDetails(placeId: string): Promise<PlaceBasicDetails>;

  // Stufe 2b: Place Details — Batch (mehrere IDs)
  getBasicDetailsBatch(placeIds: string[]): Promise<PlaceBasicDetails[]>;
}

interface PlaceBasicDetails {
  id: string;
  displayName: {
    text: string;
    languageCode: string;
  };
  formattedAddress: string;
  location: {
    latitude: number;
    longitude: number;
  };
  types: string[];
  businessStatus: string;
  googleMapsUri: string;
  primaryType?: string;
  primaryTypeDisplayName?: {
    text: string;
    languageCode: string;
  };
}
```

### Implementierungs-Details:

#### Nearby Search Request:

```typescript
async function searchNearbyIDs(params: {
  lat: number;
  lng: number;
  radius: number;
  includedTypes: string[];
}): Promise<string[]> {
  const response = await fetch(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.google.placesApiKey,
        'X-Goog-FieldMask': 'places.id',  // NUR ID → IDs Only Tier → $0
      },
      body: JSON.stringify({
        includedTypes: params.includedTypes,
        locationRestriction: {
          circle: {
            center: {
              latitude: params.lat,
              longitude: params.lng,
            },
            radius: params.radius,
          },
        },
        maxResultCount: 20,  // Max erlaubt
        languageCode: 'en',
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new PlacesApiError(
      `Nearby Search failed: ${response.status}`,
      response.status,
      error
    );
  }

  const data = await response.json();

  // Leere Antwort = keine Places in diesem Radius
  if (!data.places || data.places.length === 0) {
    return [];
  }

  return data.places.map((p: { id: string }) => p.id);
}
```

#### Place Details Request:

```typescript
async function getBasicDetails(placeId: string): Promise<PlaceBasicDetails> {
  // WICHTIG: Nur Basic/Pro Fields anfragen → $17-20/1000
  // NIEMALS Advanced/Enterprise Fields hier anfragen!
  const BASIC_FIELDS = [
    'id',
    'displayName',
    'formattedAddress',
    'location',
    'types',
    'businessStatus',
    'googleMapsUri',
    'primaryType',
    'primaryTypeDisplayName',
  ].join(',');

  const response = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        'X-Goog-Api-Key': config.google.placesApiKey,
        'X-Goog-FieldMask': BASIC_FIELDS,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new PlacesApiError(
      `Place Details failed for ${placeId}: ${response.status}`,
      response.status,
      error
    );
  }

  return response.json();
}
```

### Rate Limiting & Error Handling:

```typescript
// Rate Limiter Config
const RATE_LIMIT = {
  requestsPerSecond: 10,     // Google erlaubt ~50 QPS, wir bleiben konservativ
  delayBetweenCells: 500,    // 500ms zwischen Grid-Zellen
  delayBetweenCategories: 200, // 200ms zwischen Kategorien
  retryAttempts: 2,
  retryDelayMs: 2000,
};

// Retry-Logik
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RATE_LIMIT.retryAttempts
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      if (error instanceof PlacesApiError && error.status === 429) {
        // Rate limited → länger warten
        await sleep(RATE_LIMIT.retryDelayMs * (i + 1) * 2);
      } else if (error instanceof PlacesApiError && error.status >= 500) {
        // Server error → normal retry
        await sleep(RATE_LIMIT.retryDelayMs * (i + 1));
      } else {
        throw error; // Client error → nicht retrien
      }
    }
  }
  throw new Error('Unreachable');
}
```

### Custom Error Class:

```typescript
class PlacesApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public apiError?: unknown
  ) {
    super(message);
    this.name = 'PlacesApiError';
  }
}
```

### Auch erstellen: `src/google-maps/types.ts`

Alle Interfaces für das Google Maps Tool an einem Ort.

---

## G2: H3 GRID SCANNER

### Ort: `src/google-maps/grid-scanner.ts`

### Was es tut:
Nutzt die H3 Grid-Zellen aus `shared/city-config.ts` und scannt jede Zelle mit dem Places Client. Sammelt alle gefundenen Place IDs.

### Interface:

```typescript
interface GridScanResult {
  city: string;
  cellsScanned: number;
  totalIdsFound: number;
  uniqueIdsFound: number;
  idsByCategory: Record<string, number>;
  idsByCell: Record<string, string[]>; // H3 Cell ID → Place IDs
  allUniqueIds: string[];
  durationMs: number;
  errors: ScanError[];
}

interface ScanError {
  cellId: string;
  category: string;
  error: string;
  retried: boolean;
}

interface GridScanner {
  // Hauptfunktion: Scannt alle Zellen einer Stadt
  scanCity(city: CityConfig): Promise<GridScanResult>;

  // Einzelne Zelle scannen (für Tests)
  scanCell(
    cellId: string,
    lat: number,
    lng: number,
    categories: string[]
  ): Promise<Map<string, string[]>>;
}
```

### Implementierungs-Details:

```typescript
async function scanCity(city: CityConfig): Promise<GridScanResult> {
  const startTime = Date.now();
  const allIds = new Map<string, Set<string>>(); // category → Set<placeId>
  const idsByCell = new Map<string, string[]>();
  const errors: ScanError[] = [];

  // H3 Zellen generieren (aus shared/city-config.ts)
  const cells = generateScanCells(city);
  logger.info('google-maps', `Scanning ${cells.length} cells for ${city.name}`);

  // Kategorien die wir scannen
  const SCAN_CATEGORIES = ['restaurant', 'cafe', 'bar', 'lodging'];

  for (const cell of cells) {
    const center = getCellCenter(cell);
    const cellIds: string[] = [];

    for (const category of SCAN_CATEGORIES) {
      try {
        const ids = await withRetry(() =>
          placesClient.searchNearbyIDs({
            lat: center.lat,
            lng: center.lng,
            radius: 500,  // 500m Radius passt zu H3 Resolution 8
            includedTypes: [category],
          })
        );

        ids.forEach(id => cellIds.push(id));

        // Pro Kategorie sammeln
        if (!allIds.has(category)) allIds.set(category, new Set());
        ids.forEach(id => allIds.get(category)!.add(id));

        logger.debug('google-maps',
          `Cell ${cell.substring(0, 8)}... | ${category}: ${ids.length} IDs`
        );

        await sleep(RATE_LIMIT.delayBetweenCategories);

      } catch (error) {
        errors.push({
          cellId: cell,
          category,
          error: error instanceof Error ? error.message : String(error),
          retried: true,
        });
        logger.warn('google-maps',
          `Error scanning cell ${cell} for ${category}: ${error}`
        );
      }
    }

    idsByCell.set(cell, [...new Set(cellIds)]);
    await sleep(RATE_LIMIT.delayBetweenCells);
  }

  // Alle IDs deduplizieren (ein Place kann in mehreren Zellen sein)
  const uniqueIds = new Set<string>();
  allIds.forEach(ids => ids.forEach(id => uniqueIds.add(id)));

  const result: GridScanResult = {
    city: city.name,
    cellsScanned: cells.length,
    totalIdsFound: Array.from(allIds.values()).reduce((sum, s) => sum + s.size, 0),
    uniqueIdsFound: uniqueIds.size,
    idsByCategory: Object.fromEntries(
      Array.from(allIds.entries()).map(([k, v]) => [k, v.size])
    ),
    idsByCell: Object.fromEntries(idsByCell),
    allUniqueIds: Array.from(uniqueIds),
    durationMs: Date.now() - startTime,
    errors,
  };

  logger.info('google-maps',
    `Scan complete: ${result.uniqueIdsFound} unique IDs ` +
    `in ${result.cellsScanned} cells (${result.durationMs}ms)`,
    { categories: result.idsByCategory }
  );

  return result;
}
```

### Erwartete Scan-Metriken für Hoi An:

```
Zellen:            ~18-32 (Resolution 8 + Hotspots Resolution 9)
Kategorien:        4 (restaurant, cafe, bar, lodging)
API Calls:         ~72-128 pro Scan (Zellen × Kategorien)
Erwartete IDs:     ~300-600 unique Places
Dauer:             ~2-5 Minuten (mit Delays)
Kosten:            $0 (IDs Only Tier, weit unter 10K Free)
```

---

## G3: DELTA DETECTION INTEGRATION

### Ort: `src/google-maps/delta-detector.ts`

### Was es tut:
Vergleicht die gescannten Place IDs mit dem Delta Store (`shared/delta-store.ts`). Gibt nur die NEUEN IDs zurück.

### Interface:

```typescript
interface DeltaResult {
  city: string;
  scanDate: string;
  totalScanned: number;
  knownIds: number;
  newIds: string[];
  newCount: number;
  // Optional: IDs die im letzten Scan da waren aber jetzt fehlen
  missingIds?: string[];
  missingCount?: number;
}

interface DeltaDetector {
  // Hauptfunktion: Finde neue Place IDs
  detectNew(
    scanResult: GridScanResult,
    city: CityConfig
  ): Promise<DeltaResult>;

  // Nach erfolgreichem Push: IDs als bekannt markieren
  markAsProcessed(
    newIds: string[],
    city: CityConfig,
    scanResult: GridScanResult
  ): Promise<void>;
}
```

### Implementierungs-Details:

```typescript
async function detectNew(
  scanResult: GridScanResult,
  city: CityConfig
): Promise<DeltaResult> {
  const allScannedIds = scanResult.allUniqueIds;

  // Batch-Check gegen Delta Store
  const entries = allScannedIds.map(id => ({
    source: 'google_maps' as const,
    sourceId: id,
  }));

  const newEntries = await deltaStore.findNew(entries);
  const newIds = newEntries.map(e => e.sourceId);

  logger.info('google-maps',
    `Delta: ${allScannedIds.length} scanned, ` +
    `${allScannedIds.length - newIds.length} known, ` +
    `${newIds.length} NEW`
  );

  return {
    city: city.name,
    scanDate: new Date().toISOString(),
    totalScanned: allScannedIds.length,
    knownIds: allScannedIds.length - newIds.length,
    newIds,
    newCount: newIds.length,
  };
}

async function markAsProcessed(
  newIds: string[],
  city: CityConfig,
  scanResult: GridScanResult
): Promise<void> {
  // H3 Cell pro Place ID finden (für Tracking)
  const entries = newIds.map(id => {
    // Finde in welcher Zelle diese ID gefunden wurde
    const cell = Object.entries(scanResult.idsByCell)
      .find(([_, ids]) => ids.includes(id));

    return {
      source: 'google_maps' as const,
      sourceId: id,
      city: city.name,
      h3Cell: cell ? cell[0] : undefined,
    };
  });

  await deltaStore.markKnown(entries);
}
```

### Erster Scan (Baseline):

Beim allerersten Scan sind ALLE IDs "neu". Das ist gewollt:
1. Erster Scan → alle ~400-600 Places als "neu" erkannt
2. Details abrufen → alle an Pipeline senden (mit Flag `initial_baseline: true`)
3. Ab dem zweiten Scan → nur noch echte Neuzugänge (5-15/Woche)

**OPTION A:** Baseline-Scan ohne Pipeline-Push (nur known_places füllen):
```bash
npx tsx src/google-maps/index.ts --city hoi-an --baseline-only
```

**OPTION B:** Alles an Pipeline senden (Admin filtert im Dashboard):
```bash
npx tsx src/google-maps/index.ts --city hoi-an
```

→ **Empfehlung: Option A** für den ersten Scan, damit die Pipeline nicht mit 500 "Leads" geflutet wird.

---

## G4: CATEGORY MAPPER + LEAD TRANSFORMER

### Ort: `src/google-maps/category-mapper.ts` + `src/google-maps/lead-transformer.ts`

### category-mapper.ts — Was es tut:
Mappt Google Places Types auf unsere 4 Kategorien.

```typescript
// Google gibt Types wie: ['restaurant', 'food', 'point_of_interest', 'establishment']
// Wir brauchen: 'restaurants' | 'bars' | 'cafes' | 'hotels'

type OurCategory = 'restaurants' | 'bars' | 'cafes' | 'hotels';

const TYPE_MAPPING: Record<string, OurCategory> = {
  // Restaurants
  'restaurant': 'restaurants',
  'meal_delivery': 'restaurants',
  'meal_takeaway': 'restaurants',
  'food': 'restaurants',
  'bakery': 'restaurants',
  'steak_house': 'restaurants',
  'seafood_restaurant': 'restaurants',
  'pizza_restaurant': 'restaurants',
  'sushi_restaurant': 'restaurants',
  'vietnamese_restaurant': 'restaurants',
  'italian_restaurant': 'restaurants',
  'japanese_restaurant': 'restaurants',
  'korean_restaurant': 'restaurants',
  'indian_restaurant': 'restaurants',
  'thai_restaurant': 'restaurants',
  'chinese_restaurant': 'restaurants',
  'mexican_restaurant': 'restaurants',
  'american_restaurant': 'restaurants',
  'french_restaurant': 'restaurants',
  'vegan_restaurant': 'restaurants',
  'vegetarian_restaurant': 'restaurants',
  'brunch_restaurant': 'restaurants',
  'breakfast_restaurant': 'restaurants',
  'ramen_restaurant': 'restaurants',
  'hamburger_restaurant': 'restaurants',
  'sandwich_shop': 'restaurants',
  'ice_cream_shop': 'restaurants',

  // Bars
  'bar': 'bars',
  'night_club': 'bars',
  'pub': 'bars',
  'wine_bar': 'bars',
  'cocktail_bar': 'bars',
  'beer_hall': 'bars',
  'beer_garden': 'bars',

  // Cafés
  'cafe': 'cafes',
  'coffee_shop': 'cafes',
  'tea_house': 'cafes',
  'espresso_bar': 'cafes',

  // Hotels
  'lodging': 'hotels',
  'hotel': 'hotels',
  'motel': 'hotels',
  'resort_hotel': 'hotels',
  'guest_house': 'hotels',
  'hostel': 'hotels',
  'bed_and_breakfast': 'hotels',
  'cottage': 'hotels',
  'extended_stay_hotel': 'hotels',
  'farmstay': 'hotels',
  'private_guest_room': 'hotels',
  'rv_park': 'hotels',
  'campground': 'hotels',
};

function mapCategory(types: string[]): OurCategory | null {
  // Priorität: Erster Match gewinnt
  // Types sind nach Relevanz sortiert (Google gibt primary type zuerst)
  for (const type of types) {
    if (TYPE_MAPPING[type]) return TYPE_MAPPING[type];
  }
  return null;
}

function mapCategoryFromPrimaryType(primaryType?: string): OurCategory | null {
  if (!primaryType) return null;
  return TYPE_MAPPING[primaryType] || null;
}
```

### lead-transformer.ts — Was es tut:
Transformiert Place Details in Pipeline Lead Format.

```typescript
function transformToLead(
  place: PlaceBasicDetails,
  scanMeta: {
    city: string;
    h3Cell?: string;
    scanDate: string;
    isBaseline: boolean;
  }
): PipelineLeadInput {
  return {
    source: 'google_maps',
    source_id: place.id,
    source_url: place.googleMapsUri || null,
    name: place.displayName?.text || null,
    address: place.formattedAddress || null,
    city: scanMeta.city,
    category_guess: mapCategory(place.types)
      || mapCategoryFromPrimaryType(place.primaryType)
      || null,
    google_maps_url: place.googleMapsUri || null,
    raw_data: {
      google_place_id: place.id,
      google_types: place.types,
      google_primary_type: place.primaryType,
      google_primary_type_display: place.primaryTypeDisplayName?.text,
      google_business_status: place.businessStatus,
      location: place.location,
      display_name_language: place.displayName?.languageCode,
      discovery: {
        method: 'h3_grid_scan',
        h3_cell: scanMeta.h3Cell,
        scan_date: scanMeta.scanDate,
        is_baseline: scanMeta.isBaseline,
      },
    },
  };
}
```

---

## G5: ORCHESTRATOR

### Ort: `src/google-maps/index.ts`

### Was es tut:
Verbindet alles: Grid Scanner → Delta Detection → Details abrufen → Lead Transform → Pipeline Push. Das ist der Einstiegspunkt den man aufruft.

### CLI Interface:

```bash
# Standard-Scan (Hoi An, nur neue Places)
npx tsx src/google-maps/index.ts

# Mit Optionen
npx tsx src/google-maps/index.ts --city hoi-an
npx tsx src/google-maps/index.ts --city hoi-an --dry-run
npx tsx src/google-maps/index.ts --city hoi-an --baseline-only
npx tsx src/google-maps/index.ts --city hoi-an --verbose
```

### CLI Args:

```typescript
interface GoogleMapsToolOptions {
  city: string;            // Default: 'hoi-an'
  dryRun: boolean;         // Default: false → wenn true, nicht an Pipeline senden
  baselineOnly: boolean;   // Default: false → wenn true, nur known_places füllen
  verbose: boolean;        // Default: false → wenn true, debug logging
  categories?: string[];   // Default: alle 4 → optional nur bestimmte scannen
}
```

### Ablauf (Pseudocode):

```typescript
async function main(options: GoogleMapsToolOptions): Promise<ToolRunReport> {
  // 1. Config laden
  const city = getCityConfig(options.city);
  if (!city) throw new Error(`Unknown city: ${options.city}`);

  logger.info('google-maps', `Starting scan for ${city.name}`, {
    dryRun: options.dryRun,
    baselineOnly: options.baselineOnly,
  });

  // 2. Grid scannen (Stufe 1: IDs Only = GRATIS)
  const scanResult = await gridScanner.scanCity(city);

  // 3. Delta Detection (was ist neu?)
  const deltaResult = await deltaDetector.detectNew(scanResult, city);

  if (deltaResult.newCount === 0) {
    logger.info('google-maps', 'No new places found. Done.');
    return buildReport({ ...deltaResult, leadsPushed: 0, status: 'success' });
  }

  logger.info('google-maps',
    `Found ${deltaResult.newCount} new places. Fetching details...`
  );

  // 4. Details für neue Places abrufen (Stufe 2: Basic = Pro Tier)
  const details: PlaceBasicDetails[] = [];
  for (const placeId of deltaResult.newIds) {
    try {
      const detail = await withRetry(() =>
        placesClient.getBasicDetails(placeId)
      );
      details.push(detail);
      await sleep(100); // Sanftes Rate Limiting
    } catch (error) {
      logger.warn('google-maps',
        `Failed to get details for ${placeId}: ${error}`
      );
    }
  }

  // 5. In Leads transformieren
  const leads = details
    .filter(d => d.businessStatus !== 'CLOSED_PERMANENTLY')
    .map(d => transformToLead(d, {
      city: city.name,
      h3Cell: findCellForPlace(d.id, scanResult),
      scanDate: deltaResult.scanDate,
      isBaseline: options.baselineOnly,
    }));

  // 6. An Pipeline senden (oder Dry-Run)
  let pushedCount = 0;
  if (!options.dryRun && !options.baselineOnly) {
    const results = await pipelineClient.pushLeads(leads, {
      dryRun: options.dryRun,
    });
    pushedCount = results.filter(r => r.success || r.duplicate).length;
  } else if (options.baselineOnly) {
    logger.info('google-maps',
      `Baseline mode: Skipping pipeline push for ${leads.length} leads`
    );
  }

  // 7. Neue IDs als bekannt markieren
  await deltaDetector.markAsProcessed(
    deltaResult.newIds,
    city,
    scanResult
  );

  // 8. Tool Run Report
  const report = buildReport({
    city: city.name,
    totalScanned: scanResult.uniqueIdsFound,
    newFound: deltaResult.newCount,
    detailsFetched: details.length,
    leadsPushed: pushedCount,
    errors: scanResult.errors,
    durationMs: Date.now() - startTime,
    status: scanResult.errors.length === 0 ? 'success' : 'partial',
  });

  // 9. Report in Supabase tool_runs Tabelle
  await reportRun(report);

  return report;
}
```

### Hilfsfunktion: findCellForPlace

```typescript
function findCellForPlace(
  placeId: string,
  scanResult: GridScanResult
): string | undefined {
  for (const [cellId, ids] of Object.entries(scanResult.idsByCell)) {
    if (ids.includes(placeId)) return cellId;
  }
  return undefined;
}
```

---

## G6: TESTS + VALIDIERUNG + ERSTER SCAN

### Ort: `src/google-maps/test-scan.ts`

### 6.1 Unit Test: Places Client

```typescript
// Test 1: Kann IDs abrufen
// → searchNearbyIDs({ lat: 15.88, lng: 108.34, radius: 500, includedTypes: ['restaurant'] })
// → Erwartet: Array mit > 0 Place IDs

// Test 2: Kann Details abrufen
// → getBasicDetails('ChIJ...') mit einer bekannten Place ID
// → Erwartet: Objekt mit displayName, formattedAddress, types

// Test 3: Field Mask funktioniert (kein Overcharging)
// → Prüfe dass Response NICHT rating, phoneNumber etc. enthält

// Test 4: Rate Limiting / Retry
// → Simuliere 429 Response → Retry funktioniert
```

### 6.2 Integration Test: Grid Scan

```typescript
// Test 5: Mini-Scan (1 Zelle, 1 Kategorie)
// → scanCell(singleCell, lat, lng, ['restaurant'])
// → Erwartet: Map mit mindestens 1 Place ID

// Test 6: Hoi An Grid-Generierung
// → generateScanCells(hoiAnConfig)
// → Erwartet: 18-32 Zellen (Resolution 8 + Hotspots)
```

### 6.3 Integration Test: Delta Detection

```typescript
// Test 7: Erster Scan = alle neu
// → detectNew(scanResult) mit leerem Delta Store
// → Erwartet: newIds.length === scanResult.allUniqueIds.length

// Test 8: Zweiter Scan = nichts neu
// → markAsProcessed(ids) → detectNew(gleiches scanResult)
// → Erwartet: newIds.length === 0

// Test 9: Dritter Scan mit 1 neuem Place
// → scanResult mit 1 zusätzlicher ID
// → Erwartet: newIds.length === 1
```

### 6.4 Erster echter Scan (Dry-Run)

```bash
# Schritt 1: Dry-Run — nur scannen, nichts speichern
npx tsx src/google-maps/index.ts --city hoi-an --dry-run --verbose

# Erwartete Ausgabe:
# [INFO] [google-maps] Starting scan for Hoi An
# [INFO] [google-maps] Scanning 32 cells for Hoi An
# [DEBUG] [google-maps] Cell 882a11a... | restaurant: 12 IDs
# [DEBUG] [google-maps] Cell 882a11a... | cafe: 8 IDs
# ...
# [INFO] [google-maps] Scan complete: 487 unique IDs in 32 cells (180000ms)
# [INFO] [google-maps] Delta: 487 scanned, 0 known, 487 NEW
# [INFO] [google-maps] DRY RUN: Would fetch details for 487 places
# [INFO] [google-maps] DRY RUN: Would push 487 leads to pipeline
```

```bash
# Schritt 2: Baseline-Scan — IDs speichern, NICHT an Pipeline
npx tsx src/google-maps/index.ts --city hoi-an --baseline-only

# Erwartete Ausgabe:
# [INFO] [google-maps] Starting scan for Hoi An
# [INFO] [google-maps] Scan complete: 487 unique IDs
# [INFO] [google-maps] Delta: 487 scanned, 0 known, 487 NEW
# [INFO] [google-maps] Fetching details for 487 places...
# [INFO] [google-maps] Baseline mode: Skipping pipeline push
# [INFO] [google-maps] Marked 487 IDs as known in delta store
# [INFO] [google-maps] Done. Baseline established.
```

```bash
# Schritt 3: Normaler Scan (ab jetzt wöchentlich)
npx tsx src/google-maps/index.ts --city hoi-an

# Erwartete Ausgabe (nach Baseline):
# [INFO] [google-maps] Starting scan for Hoi An
# [INFO] [google-maps] Scan complete: 489 unique IDs
# [INFO] [google-maps] Delta: 489 scanned, 487 known, 2 NEW
# [INFO] [google-maps] Fetching details for 2 places...
# [INFO] [google-maps] Pushed 2 leads to pipeline
# [INFO] [google-maps] Done.
```

---

## DATEISTRUKTUR NACH PHASE 2

```
alles-neue-tools/
├── src/
│   ├── shared/                      ← Phase 0 (bereits fertig)
│   │   ├── config.ts
│   │   ├── pipeline-client.ts
│   │   ├── city-config.ts
│   │   ├── h3-grid.ts
│   │   ├── delta-store.ts
│   │   ├── logger.ts
│   │   ├── tool-runner.ts
│   │   ├── types.ts
│   │   └── database.types.ts
│   │
│   ├── google-maps/                  ← Phase 2 (NEU)
│   │   ├── index.ts                 # Orchestrator / Entry Point
│   │   ├── places-client.ts         # Google Places API Wrapper
│   │   ├── grid-scanner.ts          # H3 Grid + Nearby Search
│   │   ├── delta-detector.ts        # Delta Detection Integration
│   │   ├── category-mapper.ts       # Google Types → Unsere Kategorien
│   │   ├── lead-transformer.ts      # Place Details → Pipeline Lead
│   │   ├── types.ts                 # Alle Interfaces
│   │   └── test-scan.ts             # Test + Validierung
│   │
│   ├── facebook-scout/              ← (leer, Phase 4)
│   ├── instagram-scout/             ← (leer, Phase 4)
│   ├── google-alerts/               ← (leer, Phase 3)
│   ├── sitemap-miner/               ← (leer, Phase 3)
│   ├── osm-monitor/                 ← (leer, Phase 3)
│   └── cli/                         ← (leer, Phase 5)
```

---

## KOSTEN-RECHNUNG PHASE 2

### Pro Scan (Hoi An):

```
Stufe 1 — Nearby Search (IDs Only):
  32 Zellen × 4 Kategorien = 128 Requests
  Kosten: $0 (IDs Only Tier = GRATIS)
  Free Tier: 10.000/Monat → 78 Scans möglich

Stufe 2 — Place Details (Basic):
  ~5-15 neue Places/Woche = Details-Abruf
  Kosten: $0 (weit unter 5.000 Free Tier/Monat)

TOTAL pro Scan: $0
TOTAL pro Monat (4 Scans): $0
```

### Baseline-Scan (einmalig):

```
Stufe 1: 128 Requests → $0
Stufe 2: ~400-600 Details → $0 (unter 5.000 Free Tier)
TOTAL: $0
```

### Bei 10 Städten:

```
Stufe 1: 128 × 10 × 4 = 5.120 Requests/Monat → $0 (unter 10K Free)
Stufe 2: ~50-150 neue Details/Monat → $0 (unter 5K Free)
TOTAL: $0/Monat
```

---

## RAILWAY CRON (Nach G6 Validierung)

Wenn alles funktioniert, Cron Job in Railway einrichten:

### railway.toml Update:

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npx tsx src/google-maps/index.ts --city hoi-an"
cronSchedule = "0 1 * * 1"  # Jeden Montag 01:00 UTC (08:00 Vietnam)
```

### Alternative: Manuell triggern (für den Anfang empfohlen):

```bash
# Lokal
npx tsx src/google-maps/index.ts --city hoi-an

# Via Railway CLI
railway run npx tsx src/google-maps/index.ts --city hoi-an
```

---

## VALIDIERUNG: IST PHASE 2 FERTIG?

```
□ places-client.ts: searchNearbyIDs gibt Place IDs zurück
□ places-client.ts: getBasicDetails gibt Details zurück
□ places-client.ts: Field Mask korrekt (nur Basic Fields, kein Enterprise)
□ grid-scanner.ts: Hoi An Scan gibt ~300-600 unique IDs
□ grid-scanner.ts: Scan dauert < 10 Minuten
□ delta-detector.ts: Erster Scan = alle IDs neu
□ delta-detector.ts: Zweiter Scan = 0 neue IDs
□ category-mapper.ts: Restaurant/Cafe/Bar/Hotel korrekt gemappt
□ lead-transformer.ts: Output validiert gegen Pipeline Schema
□ index.ts: --dry-run funktioniert (nichts wird gesendet)
□ index.ts: --baseline-only funktioniert (IDs gespeichert, kein Push)
□ index.ts: Normaler Scan funktioniert (neue Leads an Pipeline)
□ known_places: Einträge korrekt in Supabase
□ tool_runs: Run-Report korrekt in Supabase
□ Pipeline: Test-Lead erfolgreich empfangen
□ Keine Google API Errors (429, 403, etc.)
```

---

## BACKLOG: WAS KOMMT NACH PHASE 2

### Nächste Prioritäten (Phase 3):

| # | Was | Aufwand | Wann |
|---|-----|---------|------|
| T2 | Google Alerts Aggregator (RSS → Pipeline) | 3 Std | Phase 3 |
| T3 | Sitemap Delta Miner (TripAdvisor/Foody) | 3 Std | Phase 3 |
| T4 | OSM Changeset Monitor (Overpass API) | 1.5 Std | Phase 3 |
| T5 | changedetection.io Setup | 1 Std | Phase 3 |

### Verschoben in Backlog:

| # | Was | Warum verschoben |
|---|-----|-----------------|
| Foursquare Scanner | Anderer Datenpool, aber Google deckt Vietnam gut ab |
| OSM Overpass als Teil von Phase 2 | Eigenständiges Tool (Phase 3, T4), nicht an Grid gekoppelt |
| Enrichment (Phone/Website/Hours) | Enterprise Tier ($35-40/1000), nicht nötig für Lead-Erkennung |
| Da Nang Scan | Erst Hoi An perfektionieren, dann expandieren |

---

## PROMPT FÜR CLAUDE CODE IN CURSOR

```
Ich arbeite am Projekt "alles-neue-tools" – ein TypeScript Tool-Repo
das Discovery-Tools für newaround.com baut.

Repo-Pfad: /Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools

Phase 0 (Fundament) ist abgeschlossen. Shared-Module sind fertig:
- src/shared/config.ts (Env-Var Validierung)
- src/shared/pipeline-client.ts (POST an Pipeline API)
- src/shared/city-config.ts (Städte + Boundaries)
- src/shared/h3-grid.ts (H3 Grid-Generierung)
- src/shared/delta-store.ts (Supabase Known Places)
- src/shared/logger.ts (Structured Logging)
- src/shared/tool-runner.ts (Base Class für Tools)

Lies die Datei /Users/philipp/Code/Projekte/Alles Neue Portal/Coworker/Tools/15_PHASE_2_PLAN.md
für den detaillierten Plan.

Wir bauen jetzt Phase 2: Google Maps Discovery Tool.
Starte mit [G1/G2/G3/G4/G5/G6].

Wichtig:
- Google Places API (New) verwenden, NICHT Legacy
- Field Masking: Stufe 1 nur 'places.id' (GRATIS), Stufe 2 nur Basic Fields
- H3 Grid aus shared/h3-grid.ts nutzen
- Delta Store aus shared/delta-store.ts nutzen
- Pipeline Client aus shared/pipeline-client.ts nutzen
- GOOGLE_PLACES_API_KEY ist in .env
```
