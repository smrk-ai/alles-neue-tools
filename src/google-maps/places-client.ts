import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { sleep } from '../shared/utils.js';
import { canMakeCall, incrementBudget, getAvailableDetailTier } from '../shared/budget-tracker.js';
import type { DetailTier } from '../shared/types.js';
import type { NearbySearchParams, PlaceBasicDetails } from './types.js';
import { PlacesApiError } from './types.js';

const log = createLogger('google-maps');

const PLACES_API_BASE = 'https://places.googleapis.com/v1';

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

const ESSENTIALS_FIELDS = [
  'id',
  'formattedAddress',
  'location',
  'types',
  'addressComponents',
].join(',');

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

// --- Nearby Search (IDs Only = FREE) ---

export async function searchNearbyIDs(
  params: NearbySearchParams,
): Promise<string[]> {
  const apiKey = getApiKey();

  const response = await fetch(`${PLACES_API_BASE}/places:searchNearby`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id',
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
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      languageCode: 'en',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new PlacesApiError(
      `Nearby Search failed: ${response.status}`,
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

// --- Place Details (Basic Fields = Pro Tier) ---

export async function getBasicDetails(
  placeId: string,
): Promise<PlaceBasicDetails> {
  const apiKey = getApiKey();

  const response = await fetch(`${PLACES_API_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': BASIC_FIELDS,
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

// --- Batch Details (sequential with delay) ---

export async function getBasicDetailsBatch(
  placeIds: string[],
  delayMs: number = 100,
): Promise<PlaceBasicDetails[]> {
  const results: PlaceBasicDetails[] = [];

  for (const placeId of placeIds) {
    try {
      const detail = await withRetry(() => getBasicDetails(placeId));
      results.push(detail);
    } catch (error) {
      log.warn(
        `Failed to get details for ${placeId}: ${error instanceof Error ? error.message : error}`,
      );
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return results;
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
      const fieldMask = currentTier === 'place_details_essentials' ? ESSENTIALS_FIELDS : BASIC_FIELDS;
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
