# Phase 4: Social Media Tools – Detaillierter Plan für Claude Code

> **Für:** Claude Code in Cursor
> **Repo:** `alles-neue-tools` → `/Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools`
> **Voraussetzung:** Phase 0 abgeschlossen, Meta Tokens vorhanden (sind sie!)
> **Dauer:** ~7 Stunden
> **Ergebnis:** Facebook + Instagram Discovery, automatisch, $0/Monat

---

## WAS PHASE 4 IST

Phase 4 nutzt die Meta Graph API um auf Facebook und Instagram nach neuen Businesses zu suchen. Wir haben bereits alle Tokens — sie wurden in einer früheren Session generiert und liegen in `.env`.

| # | Tool | Methode | Frequenz | Leads/Woche |
|---|------|---------|----------|-------------|
| **T6** | Facebook Scout | Graph API Place Search + Quick-Entry | Wöchentlich (API) + Täglich (manuell) | 3-8 |
| **T7** | Instagram Scout | Graph API Hashtag Monitor + Post Analyzer | Täglich | 3-8 |

---

## TOKEN STATUS (BEREITS VORHANDEN)

```
✅ Meta App ID:              ***REMOVED***
✅ User Token (Long-Lived):   Läuft bis ~16. April 2026
✅ Instagram Token (LL):      Läuft bis ~16. April 2026
✅ Page Token (Permanent):    Läuft nie ab
✅ Facebook Page:             "New Around" (ID: ***REMOVED***)
✅ Instagram:                 @new_aroundyou

Alle Tokens liegen in: alles-neue-tools/.env
```

### Token Refresh Thema:

User Token und Instagram Token laufen nach ~60 Tagen ab. Wir brauchen einen Auto-Refresh — das bauen wir als Teil von Phase 4 mit ein.

---

## ABHÄNGIGKEITEN

```
Phase 0 (shared/)        ← MUSS fertig sein
Meta Tokens              ← BEREITS vorhanden ✅

T6 und T7 teilen:
- shared/meta-client.ts  ← NEU (gemeinsamer Meta API Base Client)
- shared/token-refresh.ts ← NEU (Auto-Refresh für LL Tokens)

T6 (Facebook) und T7 (Instagram) können PARALLEL gebaut werden,
nachdem der shared Meta Client steht.
```

---

## ÜBERBLICK: 8 SCHRITTE

```
M1. shared/meta-client.ts (Base Client + Token Refresh)    (1 Std)
T6a. Facebook Place Search                                   (1.5 Std)
T6b. Facebook Quick-Entry CLI                                (30 Min)
T6c. Facebook Orchestrator                                   (30 Min)
T7a. Instagram Hashtag Monitor                               (1.5 Std)
T7b. Instagram Post Analyzer                                 (1 Std)
T7c. Instagram Orchestrator                                  (30 Min)
M2.  Tests + Validierung                                     (30 Min)
```

### Reihenfolge:

```
M1 (Meta Client)  ──→  T6a + T7a (parallel)  ──→  T6c + T7c  ──→  M2
                   ──→  T6b (parallel)
                   ──→  T7b (parallel)
```

---

## M1: SHARED META CLIENT + TOKEN REFRESH (1 Std)

### Ort: `src/shared/meta-client.ts` + `src/shared/token-refresh.ts`

### meta-client.ts — Was es tut:
Base Client für alle Meta Graph API Calls. Handhabt Auth, Rate Limiting, Error Handling.

### Interface:

```typescript
interface MetaApiClient {
  // Generischer Graph API Call
  get<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T>;

  // Paginierter Fetch (folgt @next cursor)
  getPaginated<T>(
    endpoint: string,
    params?: Record<string, string>,
    maxPages?: number
  ): Promise<T[]>;

  // Token Status prüfen
  checkTokenStatus(): Promise<TokenStatus>;
}

interface TokenStatus {
  userToken: {
    valid: boolean;
    expiresAt: Date | null;     // null = permanent
    daysRemaining: number | null;
    scopes: string[];
  };
  instagramToken: {
    valid: boolean;
    expiresAt: Date | null;
    daysRemaining: number | null;
  };
  pageToken: {
    valid: boolean;
    expiresAt: null;            // Permanent, läuft nie ab
  };
}
```

### Implementierungs-Details:

```typescript
const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';

// Rate Limiting: 200 Calls/User/Stunde
const RATE_LIMIT = {
  callsPerHour: 200,
  delayBetweenCalls: 500,   // 500ms = max 7.200/Stunde, wir nutzen ~200
};

async function graphApiGet<T>(
  endpoint: string,
  params: Record<string, string>,
  token: string
): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('access_token', token);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.json();
    throw new MetaApiError(
      error.error?.message || `Graph API error: ${response.status}`,
      response.status,
      error.error?.code,
      error.error?.error_subcode
    );
  }

  return response.json();
}

class MetaApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public errorCode?: number,
    public errorSubcode?: number
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  // Token abgelaufen?
  get isTokenExpired(): boolean {
    return this.errorCode === 190;
  }

  // Rate Limited?
  get isRateLimited(): boolean {
    return this.errorCode === 4 || this.errorCode === 32;
  }
}
```

### token-refresh.ts — Was es tut:
Prüft Token-Gültigkeit und refreshed automatisch wenn nötig.

```typescript
interface TokenRefresher {
  // Prüft ob Tokens noch gültig sind
  checkAll(): Promise<TokenStatus>;

  // Refreshed User Token (Long-Lived → neuen Long-Lived)
  refreshUserToken(): Promise<string>;

  // Refreshed Instagram Token
  refreshInstagramToken(): Promise<string>;

  // Warnung wenn Token bald abläuft (< 7 Tage)
  getWarnings(): TokenWarning[];
}

// Refresh-Logik für Long-Lived User Token:
// GET /oauth/access_token?grant_type=fb_exchange_token
//   &client_id={APP_ID}
//   &client_secret={APP_SECRET}
//   &fb_exchange_token={CURRENT_LL_TOKEN}
// → Gibt neuen LL Token zurück (weitere 60 Tage)

// WICHTIG: Muss BEVOR der alte Token abläuft ausgeführt werden!
// Empfehlung: Alle 50 Tage refreshen (10 Tage Puffer)
```

### Token Debug Endpoint:

```typescript
// Token inspizieren:
// GET /debug_token?input_token={TOKEN}&access_token={APP_ID}|{APP_SECRET}
// → Gibt Ablaufdatum, Scopes, Gültigkeit zurück

async function inspectToken(token: string): Promise<{
  isValid: boolean;
  expiresAt: number; // Unix Timestamp, 0 = never
  scopes: string[];
  userId: string;
}> {
  const response = await graphApiGet('debug_token', {
    input_token: token,
    access_token: `${config.meta.appId}|${config.meta.appSecret}`,
  }, token);
  return response.data;
}
```

### CLI für Token-Status:

```bash
# Token Status prüfen
npx tsx src/shared/token-refresh.ts --check

# Erwartete Ausgabe:
# User Token:      ✅ Valid (expires in 52 days)
# Instagram Token: ✅ Valid (expires in 52 days)
# Page Token:      ✅ Valid (permanent)

# Token refreshen
npx tsx src/shared/token-refresh.ts --refresh
```

### .env Ergänzung:

```bash
# Muss in .env ergänzt werden für Token Refresh:
META_APP_SECRET=your_app_secret_here
```

**WICHTIG:** App Secret wird für Token Refresh benötigt. Ist im Meta Developer Dashboard unter: App Settings → Basic → App Secret.

---

## T6: FACEBOOK SCOUT (3 Std)

### T6a: Facebook Place Search (1.5 Std)

#### Ort: `src/facebook-scout/place-search.ts`

#### Was es tut:
Sucht über die Graph API nach Places (Restaurants, Cafés, Bars, Hotels) in einem Radius um einen Punkt. Ähnlich wie Google Nearby Search, aber über Facebook.

#### API Endpoint:

```
GET /search?type=place&center={lat},{lng}&distance={meters}&q={query}
   &fields=name,location,phone,website,hours,category,link,fan_count,
            single_line_address,about,description,emails
   &access_token={PAGE_TOKEN}
```

**Wichtig:** Wir nutzen den **Page Token** (permanent) für Place Search, nicht den User Token.

#### Interface:

```typescript
interface FacebookPlace {
  id: string;
  name: string;
  location: {
    city: string;
    country: string;
    latitude: number;
    longitude: number;
    street: string;
    zip: string;
  };
  category: string;
  single_line_address: string;
  phone?: string;
  website?: string;
  link: string;               // Facebook URL
  fan_count?: number;
  about?: string;
  hours?: Record<string, string>;
  emails?: string[];
}

interface FacebookPlaceSearchConfig {
  city: CityConfig;
  categories: string[];      // ['restaurant', 'cafe', 'bar', 'hotel']
  radius: number;            // Meter (max 50000)
  useGrid: boolean;          // true = H3 Grid wie Google Maps, false = 1 Center Point
}
```

#### Implementierung:

```typescript
async function searchFacebookPlaces(
  lat: number,
  lng: number,
  distance: number,
  query: string
): Promise<FacebookPlace[]> {
  const fields = [
    'id', 'name', 'location', 'phone', 'website',
    'hours', 'category', 'link', 'fan_count',
    'single_line_address', 'about', 'emails',
  ].join(',');

  const data = await metaClient.get<{ data: FacebookPlace[] }>('search', {
    type: 'place',
    center: `${lat},${lng}`,
    distance: distance.toString(),
    q: query,
    fields,
  });

  return data.data || [];
}
```

#### Grid-Strategie:

Facebook Place Search hat ein Limit von ~200 Ergebnisse pro Call. Für Hoi An reicht wahrscheinlich ein einzelner Call pro Kategorie (Hoi An ist klein). Aber für größere Städte (Da Nang) nutzen wir das H3 Grid:

```typescript
async function scanCity(city: CityConfig): Promise<FacebookPlace[]> {
  const allPlaces = new Map<string, FacebookPlace>();

  const categories = ['restaurant', 'cafe', 'bar', 'hotel'];

  if (city.name === 'Hoi An') {
    // Hoi An: 1 Center Point reicht (kleine Stadt)
    for (const category of categories) {
      const places = await searchFacebookPlaces(
        15.88, 108.34, 5000, category
      );
      places.forEach(p => allPlaces.set(p.id, p));
      await sleep(RATE_LIMIT.delayBetweenCalls);
    }
  } else {
    // Größere Städte: H3 Grid nutzen
    const cells = generateScanCells(city);
    for (const cell of cells) {
      const center = getCellCenter(cell);
      for (const category of categories) {
        const places = await searchFacebookPlaces(
          center.lat, center.lng, 1000, category
        );
        places.forEach(p => allPlaces.set(p.id, p));
        await sleep(RATE_LIMIT.delayBetweenCalls);
      }
    }
  }

  return Array.from(allPlaces.values());
}
```

#### Lead Transformer:

```typescript
function transformFacebookPlace(
  place: FacebookPlace,
  city: string
): PipelineLeadInput {
  return {
    source: 'facebook',
    source_id: `fb_place_${place.id}`,
    source_url: place.link,
    name: place.name,
    address: place.single_line_address || place.location?.street || null,
    city: city,
    category_guess: mapFBCategory(place.category),
    phone: place.phone || null,
    website: place.website || null,
    facebook: place.link,
    raw_data: {
      fb_place_id: place.id,
      fb_category: place.category,
      fb_fan_count: place.fan_count,
      fb_about: place.about,
      fb_hours: place.hours,
      fb_emails: place.emails,
      fb_location: place.location,
    },
  };
}

function mapFBCategory(
  fbCategory: string
): 'restaurants' | 'bars' | 'cafes' | 'hotels' | null {
  const lower = (fbCategory || '').toLowerCase();
  if (/restaurant|food|pizza|sushi|vietnamese|asian|italian|french|dining/.test(lower))
    return 'restaurants';
  if (/coffee|cafe|café|tea|bakery|dessert/.test(lower))
    return 'cafes';
  if (/bar|pub|lounge|cocktail|night|club/.test(lower))
    return 'bars';
  if (/hotel|resort|hostel|motel|guest|lodge|boutique|accommodation/.test(lower))
    return 'hotels';
  return null;
}
```

---

### T6b: Facebook Quick-Entry CLI (30 Min)

#### Ort: `src/facebook-scout/quick-entry.ts`

#### Was es tut:
Schnelles manuelles Eintragen von Leads die du in Facebook-Gruppen findest. Enriched automatisch über Graph API.

```bash
# Usage:
npx tsx src/facebook-scout/quick-entry.ts \
  --name "Lotus Kitchen" \
  --url "https://facebook.com/lotuskitchenhoian" \
  --category restaurants \
  --group "Hoi An Expats"

# Oder Kurzform:
npx tsx src/facebook-scout/quick-entry.ts "Lotus Kitchen" "https://fb.com/lotuskitchen" restaurants
```

#### Ablauf:

```typescript
async function quickEntry(args: QuickEntryArgs): Promise<void> {
  // 1. Facebook Page ID aus URL extrahieren
  const pageId = extractPageIdFromUrl(args.url);

  // 2. Automatisch Page Details enrichen (wenn möglich)
  let pageDetails: Partial<FacebookPlace> = {};
  if (pageId) {
    try {
      pageDetails = await metaClient.get(`${pageId}`, {
        fields: 'name,location,phone,website,hours,category,link,fan_count,single_line_address,about,emails',
      });
      logger.info('facebook', `Enriched: ${pageDetails.name}, fans: ${pageDetails.fan_count}`);
    } catch (error) {
      logger.warn('facebook', `Could not enrich page ${pageId}: ${error}`);
    }
  }

  // 3. Lead erstellen (merge manual + enriched data)
  const lead: PipelineLeadInput = {
    source: 'facebook',
    source_id: pageId ? `fb_page_${pageId}` : undefined,
    source_url: args.url,
    name: pageDetails.name || args.name,
    address: pageDetails.single_line_address || null,
    city: args.city || 'Hoi An',
    category_guess: args.category || mapFBCategory(pageDetails.category || ''),
    phone: pageDetails.phone || null,
    website: pageDetails.website || null,
    facebook: args.url,
    raw_data: {
      entry_type: 'manual_quick_entry',
      found_in_group: args.group || null,
      fb_enriched: !!pageId,
      fb_details: pageDetails,
    },
  };

  // 4. An Pipeline senden
  const result = await pipelineClient.pushLead(lead);

  if (result.success) {
    logger.info('facebook', `✅ Lead "${lead.name}" pushed to pipeline`);
  } else if (result.duplicate) {
    logger.info('facebook', `⏭️ "${lead.name}" already in pipeline (duplicate)`);
  } else {
    logger.error('facebook', `❌ Failed to push "${lead.name}": ${result.error}`);
  }
}
```

#### Page ID Extraction:

```typescript
function extractPageIdFromUrl(url: string): string | null {
  // https://facebook.com/lotuskitchenhoian → 'lotuskitchenhoian'
  // https://www.facebook.com/profile.php?id=123456 → '123456'
  // https://fb.com/page/123456 → '123456'

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, '').replace(/\/$/, '');

    if (parsed.searchParams.has('id')) {
      return parsed.searchParams.get('id');
    }

    // Ignoriere generische Pfade
    if (['pages', 'groups', 'events', 'marketplace'].includes(path.split('/')[0])) {
      return path.split('/')[1] || null;
    }

    return path || null;
  } catch {
    return null;
  }
}
```

---

### T6c: Facebook Orchestrator (30 Min)

#### Ort: `src/facebook-scout/index.ts`

```bash
# CLI Interface:
npx tsx src/facebook-scout/index.ts                           # Scan Hoi An
npx tsx src/facebook-scout/index.ts --city hoi-an --dry-run   # Dry Run
npx tsx src/facebook-scout/index.ts --check-tokens            # Token Status
```

#### Ablauf:

1. Token Status prüfen → Warnung wenn < 7 Tage
2. Facebook Place Search für die Stadt
3. Delta Detection (gegen `known_places`, source: `facebook`)
4. Nur neue Places → Lead Transform → Pipeline Push
5. Neue IDs im Delta Store markieren
6. Report in `tool_runs` schreiben

---

## T7: INSTAGRAM SCOUT (4 Std)

### T7a: Instagram Hashtag Monitor (1.5 Std)

#### Ort: `src/instagram-scout/hashtag-monitor.ts`

#### Was es tut:
Sucht über die Instagram Graph API nach Posts mit bestimmten Hashtags. Findet "grand opening" und "new restaurant" Posts.

#### KRITISCHES LIMIT: 30 unique Hashtags pro 7 Tage

Das ist die wichtigste Einschränkung. Wir müssen die 30 Hashtags strategisch aufteilen.

#### Hashtag Config:

```typescript
// src/instagram-scout/config.ts

export interface HashtagConfig {
  tag: string;
  priority: 'daily' | 'weekly';
  city: string;
  categoryHint?: 'restaurants' | 'bars' | 'cafes' | 'hotels';
}

// Tier 1: Direkte "New" Hashtags (7 Stück — JEDEN Tag)
export const TIER_1_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoiannew', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoianopening', priority: 'daily', city: 'Hoi An' },
  { tag: 'newinhoian', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoian2026', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoianfoodscene', priority: 'daily', city: 'Hoi An' },
  { tag: 'hoiangrandopening', priority: 'daily', city: 'Hoi An' },
  { tag: 'newinchoian', priority: 'daily', city: 'Hoi An' },
];

// Tier 2: Kategorie-spezifisch (12 Stück — rotierend)
export const TIER_2_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoianrestaurant', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoianfood', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoiandining', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoianfoodie', priority: 'weekly', city: 'Hoi An', categoryHint: 'restaurants' },
  { tag: 'hoiancafe', priority: 'weekly', city: 'Hoi An', categoryHint: 'cafes' },
  { tag: 'hoiancoffee', priority: 'weekly', city: 'Hoi An', categoryHint: 'cafes' },
  { tag: 'hoianbrunch', priority: 'weekly', city: 'Hoi An', categoryHint: 'cafes' },
  { tag: 'hoianbar', priority: 'weekly', city: 'Hoi An', categoryHint: 'bars' },
  { tag: 'hoiannightlife', priority: 'weekly', city: 'Hoi An', categoryHint: 'bars' },
  { tag: 'hoiancocktails', priority: 'weekly', city: 'Hoi An', categoryHint: 'bars' },
  { tag: 'hoianboutiquehotel', priority: 'weekly', city: 'Hoi An', categoryHint: 'hotels' },
  { tag: 'hoianstay', priority: 'weekly', city: 'Hoi An', categoryHint: 'hotels' },
];

// Tier 3: Vietnamese (5 Stück — rotierend)
export const TIER_3_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoianquanmoi', priority: 'weekly', city: 'Hoi An' },
  { tag: 'quanmoihoian', priority: 'weekly', city: 'Hoi An' },
  { tag: 'khaitruonghoian', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianmoi', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianvietnam', priority: 'weekly', city: 'Hoi An' },
];

// Tier 4: Location-Tags (6 Stück — wöchentlich)
export const TIER_4_HASHTAGS: HashtagConfig[] = [
  { tag: 'hoianoldtown', priority: 'weekly', city: 'Hoi An' },
  { tag: 'ancienttown', priority: 'weekly', city: 'Hoi An' },
  { tag: 'anbangbeach', priority: 'weekly', city: 'Hoi An' },
  { tag: 'camnam', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianbeach', priority: 'weekly', city: 'Hoi An' },
  { tag: 'hoianriverside', priority: 'weekly', city: 'Hoi An' },
];
```

#### Rotations-Manager:

```typescript
// src/instagram-scout/hashtag-rotation.ts

interface HashtagRotation {
  // Welche Hashtags heute scannen?
  getHashtagsForToday(): HashtagConfig[];

  // Wie viele Hashtags sind diese Woche noch frei?
  getRemainingQuota(): number;

  // Hashtag als benutzt markieren
  markUsed(tag: string): void;
}

// Wochenplan:
// Mo: Tier 1 (7) + Tier 2 Restaurant (4) = 11 Hashtags (11/30)
// Di: Tier 2 Cafe (3) = 3 neue (14/30)
// Mi: Tier 2 Bar (3) + Tier 3 (2) = 5 neue (19/30)
// Do: Tier 2 Hotel (2) + Tier 3 (3) = 5 neue (24/30)
// Fr: Tier 4 (6) = 6 neue (30/30) ← Budget aufgebraucht
// Sa-So: Nur Tier 1 wiederholen (already counted, $0 quota)

// Tier 1 wird nur 1x pro Woche gezählt (7), danach gecached
// Gesamte Woche: 7 + 12 + 5 + 6 = 30 ✅
```

#### Graph API Integration:

```typescript
async function searchHashtag(
  hashtag: string
): Promise<InstagramPost[]> {
  const igUserId = config.meta.instagramUserId; // Aus Token-Inspection
  const token = config.meta.instagramToken;

  // Step 1: Hashtag ID ermitteln
  const hashtagSearch = await metaClient.get<{ data: { id: string }[] }>(
    'ig_hashtag_search',
    { q: hashtag, user_id: igUserId }
  );

  if (!hashtagSearch.data?.[0]) {
    logger.warn('instagram', `Hashtag #${hashtag} not found`);
    return [];
  }

  const hashtagId = hashtagSearch.data[0].id;

  // Step 2: Recent Media für diesen Hashtag
  const media = await metaClient.get<{ data: InstagramPost[] }>(
    `${hashtagId}/recent_media`,
    {
      user_id: igUserId,
      fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
    }
  );

  return media.data || [];
}

interface InstagramPost {
  id: string;
  caption: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
}
```

---

### T7b: Instagram Post Analyzer (1 Std)

#### Ort: `src/instagram-scout/post-analyzer.ts`

#### Was es tut:
Analysiert Instagram Posts: Ist das eine Neueröffnung? Welches Business? Welche Kategorie?

#### Interface:

```typescript
interface PostAnalysisResult {
  postId: string;
  isLikelyNewBusiness: boolean;
  confidence: number;           // 0.0 - 1.0
  signals: AnalysisSignals;
  extractedInfo: ExtractedInfo;
}

interface AnalysisSignals {
  hasOpeningKeywords: boolean;
  hasNewKeywords: boolean;
  hasLocationTag: boolean;
  hasHighEngagement: boolean;    // > 50 likes
  hasBusinessHashtags: boolean;  // #restaurant, #cafe etc.
  hasAddressInCaption: boolean;
  hasMenuMention: boolean;
  captionLanguage: 'en' | 'vi' | 'mixed';
}

interface ExtractedInfo {
  possibleName: string | null;
  possibleCategory: 'restaurants' | 'bars' | 'cafes' | 'hotels' | null;
  possibleAddress: string | null;
  possibleWebsite: string | null;
  mentionedHashtags: string[];
  instagramHandle: string | null;
}
```

#### Keyword Detection:

```typescript
const OPENING_SIGNALS = {
  en_strong: [      // +3 score
    'grand opening', 'now open', 'we are open', 'doors are open',
    'opening day', 'ribbon cutting', 'opening ceremony',
  ],
  en_medium: [      // +2 score
    'just opened', 'newly opened', 'soft opening', 'opening soon',
    'come visit us', 'first day', 'welcome to our new',
  ],
  en_weak: [        // +1 score
    'new place', 'new spot', 'new restaurant', 'new cafe', 'new bar',
    'check out', 'excited to announce',
  ],
  vi_strong: [      // +3 score
    'khai trương', 'chính thức mở cửa', 'khai trương quán',
  ],
  vi_medium: [      // +2 score
    'mới mở', 'mới khai trương', 'quán mới', 'vừa mở',
  ],
  negative: [       // -3 score
    'closed', 'closing', 'last day', 'goodbye', 'farewell',
    'throwback', 'tbt', 'memory', 'anniversary',
    'đóng cửa', 'tạm đóng',
  ],
  emojis: [         // +1 score pro Emoji
    '🎉', '🎊', '🥂', '✨', '🆕', '📍', '🏠', '🍽️', '☕', '🍸',
  ],
};

function analyzePost(post: InstagramPost): PostAnalysisResult {
  const caption = (post.caption || '').toLowerCase();
  let score = 0;
  const signals: Partial<AnalysisSignals> = {};

  // Opening Keywords
  for (const keyword of OPENING_SIGNALS.en_strong) {
    if (caption.includes(keyword)) { score += 3; signals.hasOpeningKeywords = true; }
  }
  for (const keyword of OPENING_SIGNALS.en_medium) {
    if (caption.includes(keyword)) { score += 2; signals.hasOpeningKeywords = true; }
  }
  for (const keyword of OPENING_SIGNALS.vi_strong) {
    if (caption.includes(keyword)) { score += 3; signals.hasOpeningKeywords = true; }
  }
  for (const keyword of OPENING_SIGNALS.vi_medium) {
    if (caption.includes(keyword)) { score += 2; signals.hasOpeningKeywords = true; }
  }
  for (const keyword of OPENING_SIGNALS.negative) {
    if (caption.includes(keyword)) { score -= 3; }
  }

  // Engagement Signal
  if (post.like_count > 50) { score += 1; signals.hasHighEngagement = true; }

  // Recency Signal (Post < 14 Tage alt → +1)
  const daysOld = (Date.now() - new Date(post.timestamp).getTime()) / (1000 * 60 * 60 * 24);
  if (daysOld < 14) score += 1;

  // Confidence berechnen (0-1, capped)
  const confidence = Math.min(Math.max(score / 8, 0), 1);

  return {
    postId: post.id,
    isLikelyNewBusiness: confidence >= 0.3,
    confidence,
    signals: signals as AnalysisSignals,
    extractedInfo: extractInfoFromCaption(post.caption),
  };
}
```

#### Info Extraction:

```typescript
function extractInfoFromCaption(caption: string): ExtractedInfo {
  // Versuche Name zu extrahieren
  // Pattern: "Welcome to [NAME]" oder "[NAME] is now open"
  const namePatterns = [
    /welcome to (.+?)(?:\!|\.|\n|$)/i,
    /(.+?) is now open/i,
    /introducing (.+?)(?:\!|\.|\n|$)/i,
    /khai trương (.+?)(?:\!|\.|\n|$)/i,
  ];

  let possibleName: string | null = null;
  for (const pattern of namePatterns) {
    const match = caption.match(pattern);
    if (match?.[1] && match[1].length < 60) {
      possibleName = match[1].trim();
      break;
    }
  }

  // Kategorie erraten
  const possibleCategory = guessCategory(caption);

  // Instagram Handles extrahieren (@username)
  const handles = caption.match(/@[\w.]+/g) || [];
  const instagramHandle = handles[0] || null;

  // Hashtags
  const hashtags = caption.match(/#[\w]+/g) || [];

  return {
    possibleName,
    possibleCategory,
    possibleAddress: null,  // Schwer aus Caption zu extrahieren
    possibleWebsite: extractUrl(caption),
    mentionedHashtags: hashtags,
    instagramHandle,
  };
}

function extractUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}
```

---

### T7c: Instagram Orchestrator (30 Min)

#### Ort: `src/instagram-scout/index.ts`

```bash
# CLI Interface:
npx tsx src/instagram-scout/index.ts                          # Täglicher Scan
npx tsx src/instagram-scout/index.ts --dry-run                # Nur analysieren
npx tsx src/instagram-scout/index.ts --city hoi-an
npx tsx src/instagram-scout/index.ts --quota                  # Hashtag Quota anzeigen
npx tsx src/instagram-scout/index.ts --check-tokens           # Token Status
```

#### Ablauf:

1. Token Status prüfen (Warnung wenn < 7 Tage)
2. Hashtag Rotation Manager: Welche Hashtags heute?
3. Für jeden Hashtag: Recent Media abrufen
4. Posts analysieren (Post Analyzer)
5. Posts mit `confidence >= 0.3` → Delta Store Check
6. Nur neue Posts → Lead Transform → Pipeline Push
7. Posts in Delta Store markieren (`source: 'instagram'`, `source_id: post.id`)
8. Report in `tool_runs`

#### Lead Transformer:

```typescript
function transformInstagramLead(
  post: InstagramPost,
  analysis: PostAnalysisResult,
  foundViaHashtag: string,
  city: string
): PipelineLeadInput {
  return {
    source: 'instagram',
    source_id: `ig_post_${post.id}`,
    source_url: post.permalink,
    name: analysis.extractedInfo.possibleName,
    city: city,
    category_guess: analysis.extractedInfo.possibleCategory,
    instagram: analysis.extractedInfo.instagramHandle
      ? `https://instagram.com/${analysis.extractedInfo.instagramHandle.replace('@', '')}`
      : null,
    website: analysis.extractedInfo.possibleWebsite,
    description: (post.caption || '').substring(0, 500),
    raw_data: {
      ig_post_id: post.id,
      ig_permalink: post.permalink,
      ig_media_type: post.media_type,
      ig_like_count: post.like_count,
      ig_comments_count: post.comments_count,
      ig_timestamp: post.timestamp,
      ig_caption_full: post.caption,
      ig_hashtags: analysis.extractedInfo.mentionedHashtags,
      analysis_confidence: analysis.confidence,
      analysis_signals: analysis.signals,
      found_via_hashtag: foundViaHashtag,
    },
  };
}
```

---

## DATEISTRUKTUR NACH PHASE 4

```
alles-neue-tools/
├── src/
│   ├── shared/
│   │   ├── ... (Phase 0)
│   │   ├── meta-client.ts              ← NEU (M1)
│   │   └── token-refresh.ts            ← NEU (M1)
│   │
│   ├── google-maps/                     ← Phase 2
│   ├── google-alerts/                   ← Phase 3
│   ├── sitemap-miner/                   ← Phase 3
│   ├── osm-monitor/                     ← Phase 3
│   │
│   ├── facebook-scout/                   ← Phase 4 - T6 (NEU)
│   │   ├── index.ts                     # Orchestrator
│   │   ├── place-search.ts             # Graph API Place Search
│   │   ├── quick-entry.ts              # Manual Quick-Entry CLI
│   │   ├── config.ts                    # Gruppen, Suchbegriffe
│   │   └── types.ts
│   │
│   ├── instagram-scout/                  ← Phase 4 - T7 (NEU)
│   │   ├── index.ts                     # Orchestrator
│   │   ├── hashtag-monitor.ts           # Hashtag Search via Graph API
│   │   ├── post-analyzer.ts             # Smart Post Analysis
│   │   ├── hashtag-rotation.ts          # 30/Woche Quota Manager
│   │   ├── config.ts                    # Hashtags, Keywords
│   │   └── types.ts
│   │
│   └── cli/                              ← (leer, Phase 5)
```

---

## RAILWAY CRON JOBS

```toml
# Zusätzlich zu Phase 2+3 Cron Jobs:

# Facebook Scout: Mittwochs 04:00 UTC (11:00 Vietnam)
[[services]]
name = "facebook-scout"
startCommand = "npx tsx src/facebook-scout/index.ts --city hoi-an"
cronSchedule = "0 4 * * 3"

# Instagram Scout: Täglich 05:00 UTC (12:00 Vietnam)
[[services]]
name = "instagram-scout"
startCommand = "npx tsx src/instagram-scout/index.ts --city hoi-an"
cronSchedule = "0 5 * * *"

# Token Check: Sonntags 00:00 UTC → Warnt wenn Token bald abläuft
[[services]]
name = "token-check"
startCommand = "npx tsx src/shared/token-refresh.ts --check --warn-days 10"
cronSchedule = "0 0 * * 0"
```

---

## KOSTEN-ÜBERSICHT PHASE 4

| Tool | API Kosten | Besonderheiten |
|------|-----------|----------------|
| Meta Client (shared) | $0 | Graph API ist kostenlos |
| T6 Facebook Scout | $0 | Page Token (permanent) |
| T7 Instagram Scout | $0 | 30 Hashtags/Woche Limit |
| Token Refresh | $0 | Automatisch alle 50 Tage |
| **TOTAL** | **$0/Monat** | |

---

## VALIDIERUNG: IST PHASE 4 FERTIG?

```
M1 — Meta Client:
□ meta-client.ts: Graph API GET funktioniert
□ meta-client.ts: Paginierung funktioniert
□ meta-client.ts: Rate Limiting (500ms Delay)
□ meta-client.ts: Error Handling (Token expired, Rate Limited)
□ token-refresh.ts: --check zeigt Token Status
□ token-refresh.ts: Token Refresh funktioniert
□ .env: META_APP_SECRET eingetragen

T6 — Facebook Scout:
□ place-search.ts: Findet Places in Hoi An
□ place-search.ts: 4 Kategorien gescannt
□ Delta Store: Facebook Place IDs gespeichert
□ quick-entry.ts: Manueller Lead mit Enrichment
□ index.ts: --dry-run funktioniert
□ index.ts: Pipeline Push funktioniert
□ tool_runs: Report in Supabase

T7 — Instagram Scout:
□ hashtag-monitor.ts: Hashtag Search gibt Posts zurück
□ hashtag-rotation.ts: Quota korrekt gezählt (30/Woche)
□ post-analyzer.ts: Confidence Score berechnet
□ post-analyzer.ts: Opening Keywords erkannt (EN + VN)
□ Delta Store: Instagram Post IDs gespeichert
□ index.ts: --dry-run funktioniert
□ index.ts: --quota zeigt verbleibende Hashtags
□ index.ts: Pipeline Push funktioniert
□ tool_runs: Report in Supabase
```

---

## WICHTIGE HINWEISE

### 1. Instagram User ID ermitteln

Die Instagram Graph API braucht deine Instagram User ID (nicht Username). So findest du sie:

```bash
# Mit dem Instagram Token:
curl "https://graph.facebook.com/v22.0/me?fields=id,username&access_token={IG_TOKEN}"
```

→ Die `id` in `.env` als `META_INSTAGRAM_USER_ID` speichern.

### 2. App Secret für Token Refresh

Du brauchst das App Secret aus dem Meta Developer Dashboard:
- https://developers.facebook.com → Deine App → Settings → Basic → App Secret
- In `.env` als `META_APP_SECRET` speichern

### 3. Hashtag Search Berechtigung

Die Instagram Hashtag Search braucht:
- Business oder Creator Instagram Account (verbunden mit Facebook Page)
- App muss `instagram_basic` Permission haben
- Falls noch nicht: App Review beantragen (dauert ~Tage)

Prüfe ob es funktioniert:
```bash
npx tsx src/instagram-scout/index.ts --dry-run --verbose
```

---

## PROMPT FÜR CLAUDE CODE IN CURSOR

```
Ich arbeite am Projekt "alles-neue-tools" – ein TypeScript Tool-Repo
das Discovery-Tools für newaround.com baut.

Repo-Pfad: /Users/philipp/Code/Projekte/Alles Neue Portal/alles-neue-tools

Phase 0-3 sind abgeschlossen. Shared-Module, Google Maps, Alerts,
Sitemap Miner und OSM Monitor funktionieren.

Lies die Datei /Users/philipp/Code/Projekte/Alles Neue Portal/Coworker/Tools/17_PHASE_4_PLAN.md
für den detaillierten Plan.

Wir bauen jetzt Phase 4: Social Media Tools (Facebook + Instagram).
Starte mit M1 (shared/meta-client.ts + token-refresh.ts).

Wichtig:
- Meta Graph API v22.0 verwenden
- Alle Tokens sind bereits in .env vorhanden
- Page Token ist permanent (kein Refresh nötig)
- User + Instagram Token brauchen Auto-Refresh (alle 50 Tage)
- META_APP_SECRET muss noch in .env ergänzt werden
- Instagram: 30 Hashtags pro 7 Tage Limit beachten!
- Alle Tools nutzen shared/ Module (pipeline-client, delta-store, logger)
```
