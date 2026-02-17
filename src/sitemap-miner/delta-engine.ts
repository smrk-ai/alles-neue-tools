import { findNew } from '../shared/delta-store.js';
import { createLogger } from '../shared/logger.js';
import type { DeltaEntry } from '../shared/types.js';
import type { SitemapEntry } from './types.js';

const log = createLogger('sitemap-miner');

// Extract a stable source ID from a URL based on the platform
export function extractSourceId(url: string): string {
  // Booking: /hotel/vn/{slug}.html → slug
  const bookingMatch = url.match(/booking\.com\/hotel\/vn\/([^.]+)\.html/);
  if (bookingMatch) return bookingMatch[1];

  // Agoda: /{slug}/hotel/{city}.html → slug
  const agodaMatch = url.match(/agoda\.com\/([^/]+)\/hotel\//);
  if (agodaMatch) return agodaMatch[1];

  // TripAdvisor (legacy): -d{id}-
  const taMatch = url.match(/-d(\d+)-/);
  if (taMatch) return `d${taMatch[1]}`;

  // Fallback: use full URL
  return url;
}

export interface DeltaResult {
  newEntries: SitemapEntry[];
  totalFound: number;
  alreadyKnown: number;
}

export async function findNewEntries(
  entries: SitemapEntry[],
  source: string,
): Promise<DeltaResult> {
  if (entries.length === 0) {
    return { newEntries: [], totalFound: 0, alreadyKnown: 0 };
  }

  // Build delta entries with stable source IDs
  const deltaEntries: DeltaEntry[] = entries.map((e) => ({
    source,
    sourceId: extractSourceId(e.loc),
  }));

  const newDelta = await findNew(deltaEntries);
  const newSourceIds = new Set(newDelta.map((d) => d.sourceId));

  // Map back to SitemapEntries
  const newEntries = entries.filter((e) =>
    newSourceIds.has(extractSourceId(e.loc)),
  );

  const totalFound = entries.length;
  const alreadyKnown = totalFound - newEntries.length;

  log.info(`Delta: ${totalFound} total, ${alreadyKnown} known, ${newEntries.length} new`);

  return { newEntries, totalFound, alreadyKnown };
}
