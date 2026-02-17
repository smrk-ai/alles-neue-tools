import { findNew } from '../shared/delta-store.js';
import { createLogger } from '../shared/logger.js';
import type { DeltaEntry } from '../shared/types.js';
import type { SitemapEntry } from './types.js';

const log = createLogger('sitemap-miner');

// Extract TripAdvisor review ID from URL (e.g. 'd25123456')
const TA_ID_PATTERN = /-d(\d+)-/;

export function extractSourceId(url: string): string {
  const match = url.match(TA_ID_PATTERN);
  if (match) return `d${match[1]}`;
  // Fallback: use URL as source ID
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
