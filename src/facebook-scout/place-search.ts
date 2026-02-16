import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { graphApiGetPaginated, withRetry } from '../shared/meta-client.js';
import { getAllScanCells, getCellCenter } from '../shared/h3-grid.js';
import type { CityConfig } from '../shared/types.js';
import type { FacebookPlace, FacebookScanResult } from './types.js';
import { SEARCH_QUERIES, PLACE_FIELDS, DEFAULT_DISTANCE, HOI_AN_CENTER } from './config.js';

const log = createLogger('facebook-scout');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Place Search ---

function getPageToken(): string {
  const token = config.meta.pageToken;
  if (!token) {
    throw new Error(
      'Missing META_PAGE_ACCESS_TOKEN. Set it in .env',
    );
  }
  return token;
}

async function searchPlaces(
  lat: number,
  lng: number,
  distance: number,
  query: string,
): Promise<FacebookPlace[]> {
  const token = getPageToken();

  return withRetry(() =>
    graphApiGetPaginated<FacebookPlace>(
      'search',
      {
        type: 'place',
        center: `${lat},${lng}`,
        distance: distance.toString(),
        q: query,
        fields: PLACE_FIELDS,
      },
      token,
      3, // max 3 pages
    ),
  );
}

// --- City Scan ---

export async function scanCity(city: CityConfig): Promise<FacebookScanResult> {
  const allPlaces = new Map<string, FacebookPlace>();
  const errors: string[] = [];
  let totalSearches = 0;

  const categories = Object.entries(SEARCH_QUERIES);

  if (city.slug === 'hoi-an') {
    // Hoi An: single center point per category (small city)
    for (const [category, queries] of categories) {
      for (const query of queries) {
        try {
          log.debug(`Searching: ${query} at center`, {
            lat: HOI_AN_CENTER.lat,
            lng: HOI_AN_CENTER.lng,
          });
          const places = await searchPlaces(
            HOI_AN_CENTER.lat,
            HOI_AN_CENTER.lng,
            DEFAULT_DISTANCE,
            query,
          );
          places.forEach((p) => allPlaces.set(p.id, p));
          totalSearches++;
          log.debug(`${query}: found ${places.length} places`);
        } catch (error) {
          const msg = `${category}/${query}: ${error instanceof Error ? error.message : error}`;
          log.warn(msg);
          errors.push(msg);
        }
      }
    }
  } else {
    // Larger cities: use H3 grid
    const cells = getAllScanCells(city);
    log.info(`Scanning ${cells.length} H3 cells for ${city.name}`);

    for (const cellId of cells) {
      const center = getCellCenter(cellId);

      for (const [category, queries] of categories) {
        // Use first query per category for grid scan (faster)
        const query = queries[0];
        try {
          const places = await searchPlaces(
            center.lat,
            center.lng,
            1000, // smaller radius for grid cells
            query,
          );
          places.forEach((p) => allPlaces.set(p.id, p));
          totalSearches++;
        } catch (error) {
          const msg = `${cellId.substring(0, 8)}/${category}: ${error instanceof Error ? error.message : error}`;
          log.warn(msg);
          errors.push(msg);
        }
      }
    }
  }

  log.info(
    `Scan complete: ${allPlaces.size} unique places from ${totalSearches} searches`,
  );

  return {
    places: Array.from(allPlaces.values()),
    totalSearches,
    errors,
  };
}
