import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { sleep } from '../shared/utils.js';
import { canMakeCall, incrementBudget, getAvailableDetailTier } from '../shared/budget-tracker.js';
import type { DetailTier } from '../shared/types.js';
import type { TextSearchParams, PlaceBasicDetails } from './types.js';
import { PlacesApiError } from './types.js';

const log = createLogger('google-maps');

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

// Pro SKU base fields (5k/month free): name/category/location, no rating-count.
const PRO_FIELD_LIST = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'businessStatus',
  'googleMapsUri',
  'primaryType',
  'primaryTypeDisplayName',
  'photos.name',
] as const;

const PRO_FIELDS = PRO_FIELD_LIST.join(',');

// Enterprise SKU = Pro base + rating/userRatingCount (these two fields are exactly
// what pushes the call to the Enterprise tier). Used until the 1k/month free cap is hit.
const ENTERPRISE_FIELDS = [...PRO_FIELD_LIST, 'rating', 'userRatingCount'].join(',');

// Map a budget tier to its field mask (which in turn determines the billed SKU).
function fieldMaskForTier(tier: DetailTier): string {
  return tier === 'place_details_enterprise' ? ENTERPRISE_FIELDS : PRO_FIELDS;
}

const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;

// --- API Key ---

function getApiKey(): string {
  const key = config.google.placesApiKey;
  if (!key) {
    throw new Error(
      'Missing GOOGLE_PLACES_API_KEY environment variable. Set it in .env',
    );
  }
  return key;
}

// --- Retry Logic ---

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
): Promise<T> {
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts) throw error;

      if (error instanceof PlacesApiError && error.status === 429) {
        const delay = RETRY_DELAY_MS * (i + 1) * 2;
        log.warn(`Rate limited, retrying in ${delay}ms...`);
        await sleep(delay);
      } else if (error instanceof PlacesApiError && error.status >= 500) {
        const delay = RETRY_DELAY_MS * (i + 1);
        log.warn(`Server error ${error.status}, retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw error; // Client errors (4xx except 429) → don't retry
      }
    }
  }
  throw new Error('Unreachable');
}

// --- Text Search (IDs Only = $0, unlimited) ---
// SKU: "Text Search Essentials (IDs Only)" — kostenlos, kein Limit
// locationRestriction bei Text Search nur als Rectangle, nicht Circle!

function radiusToBoundingBox(lat: number, lng: number, radiusMeters: number) {
  // 1° latitude ≈ 111,320m everywhere
  const latDelta = radiusMeters / 111_320;
  // 1° longitude shrinks with cos(lat)
  const lngDelta = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    low: { latitude: lat - latDelta, longitude: lng - lngDelta },
    high: { latitude: lat + latDelta, longitude: lng + lngDelta },
  };
}

export async function searchTextIDs(
  params: TextSearchParams,
): Promise<string[]> {
  const apiKey = getApiKey();
  const rect = radiusToBoundingBox(params.lat, params.lng, params.radius);

  const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({
      textQuery: params.includedType,
      includedType: params.includedType,
      locationRestriction: {
        rectangle: rect,
      },
      maxResultCount: 20,
      languageCode: 'en',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new PlacesApiError(
      `Text Search failed: ${response.status}`,
      response.status,
      error,
    );
  }

  const data = await response.json();

  if (!data.places || data.places.length === 0) {
    return [];
  }

  return data.places.map((p: { id: string }) => p.id);
}

// --- Place Details (generic field mask) ---

async function getPlaceDetails(placeId: string, fieldMask: string): Promise<PlaceBasicDetails> {
  const apiKey = getApiKey();
  const response = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new PlacesApiError(
      `Place Details failed for ${placeId}: ${response.status}`,
      response.status,
      error,
    );
  }

  return response.json();
}

// --- Tiered Detail Fetching (budget-aware) ---

export interface TieredDetailResult {
  details: PlaceBasicDetails[];
  tier: DetailTier;
  queuedIds: string[];
}

export async function getTieredDetailsBatch(
  placeIds: string[],
  toolSlug: string = 'google-maps',
  delayMs: number = 100,
): Promise<TieredDetailResult> {
  const details: PlaceBasicDetails[] = [];
  const queuedIds: string[] = [];
  let currentTier = await getAvailableDetailTier(toolSlug);

  if (currentTier === 'queued') {
    log.warn(`All budget tiers exhausted — queueing all ${placeIds.length} IDs`);
    return { details: [], tier: 'queued', queuedIds: [...placeIds] };
  }

  log.info(`Starting tiered detail fetch: ${placeIds.length} places, tier: ${currentTier}`);

  for (let i = 0; i < placeIds.length; i++) {
    const placeId = placeIds[i];

    // Check budget BEFORE the API call
    const canCall = await canMakeCall(toolSlug, currentTier);

    if (!canCall) {
      // Current tier exhausted — try next tier
      log.info(`Tier ${currentTier} exhausted after ${details.length} calls, checking next tier...`);
      currentTier = await getAvailableDetailTier(toolSlug);

      if (currentTier === 'queued') {
        log.warn(`All tiers exhausted — queueing remaining ${placeIds.length - i} IDs`);
        queuedIds.push(...placeIds.slice(i));
        break;
      }
    }

    try {
      const fieldMask = fieldMaskForTier(currentTier);
      const detail = await withRetry(() => getPlaceDetails(placeId, fieldMask));
      details.push(detail);

      // Increment budget AFTER successful call
      await incrementBudget(toolSlug, currentTier);
    } catch (error) {
      log.warn(`Failed to get details for ${placeId}: ${error instanceof Error ? error.message : error}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  log.info(`Tiered fetch complete: ${details.length} fetched (${currentTier}), ${queuedIds.length} queued`);
  return { details, tier: currentTier, queuedIds };
}

// Re-export for use by grid-scanner
export { withRetry };
