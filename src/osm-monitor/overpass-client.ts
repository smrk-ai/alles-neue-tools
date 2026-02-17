// ===========================================
// OSM Changeset Monitor – Overpass API Client
// ===========================================

import { createLogger } from '../shared/logger.js';
import { OVERPASS_API, AMENITY_FILTER, TOURISM_FILTER } from './config.js';
import type { OverpassElement, OverpassQueryConfig } from './types.js';

const log = createLogger('osm-overpass');

/**
 * Build an Overpass QL query for amenity/tourism elements
 * created or modified within the given time window.
 */
export function buildQuery(config: OverpassQueryConfig): string {
  const [south, west, north, east] = config.bbox;

  const since = new Date();
  since.setDate(since.getDate() - config.daysBack);
  const sinceISO = since.toISOString().split('.')[0] + 'Z';

  const versionFilter = config.onlyNew ? '(if:version()==1)' : '';

  return `
[out:json][timeout:60];
(
  node["amenity"~"${AMENITY_FILTER}"](${south},${west},${north},${east})(newer:"${sinceISO}")${versionFilter};
  way["amenity"~"${AMENITY_FILTER}"](${south},${west},${north},${east})(newer:"${sinceISO}")${versionFilter};
  node["tourism"~"${TOURISM_FILTER}"](${south},${west},${north},${east})(newer:"${sinceISO}")${versionFilter};
  way["tourism"~"${TOURISM_FILTER}"](${south},${west},${north},${east})(newer:"${sinceISO}")${versionFilter};
);
out center meta;
  `.trim();
}

/**
 * Execute an Overpass QL query and return the resulting elements.
 * Handles rate-limiting (429) with a single retry after 60s.
 */
export async function queryOverpass(query: string, retryCount = 0): Promise<OverpassElement[]> {
  log.debug('Executing Overpass query', { queryLength: query.length, retry: retryCount });

  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (response.status === 429 && retryCount < 1) {
    log.warn('Overpass rate limit (429). Waiting 60s before retry...');
    await new Promise((r) => setTimeout(r, 60_000));
    return queryOverpass(query, retryCount + 1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Overpass API error ${response.status}: ${body.substring(0, 200)}`);
  }

  const data = (await response.json()) as { elements?: OverpassElement[] };
  const elements = data.elements ?? [];

  log.info(`Overpass returned ${elements.length} elements`);
  return elements;
}
