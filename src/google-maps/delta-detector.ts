import { findNew, markKnown } from '../shared/delta-store.js';
import { createLogger } from '../shared/logger.js';
import type { CategoryGuess, CityConfig } from '../shared/types.js';
import { findCellForPlace } from './lead-transformer.js';
import type { DeltaResult, GridScanResult } from './types.js';

const log = createLogger('google-maps');

/**
 * Compare scanned Place IDs against known_places.
 * Returns only the NEW (previously unseen) IDs.
 */
export async function detectNew(
  scanResult: GridScanResult,
  city: CityConfig,
): Promise<DeltaResult> {
  const allScannedIds = scanResult.allUniqueIds;

  const entries = allScannedIds.map((id) => ({
    source: 'google_maps' as const,
    sourceId: id,
  }));

  const newEntries = await findNew(entries);
  const newIds = newEntries.map((e) => e.sourceId);

  log.info(
    `Delta: ${allScannedIds.length} scanned, ` +
      `${allScannedIds.length - newIds.length} known, ` +
      `${newIds.length} NEW`,
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

/**
 * Mark new Place IDs as known in the delta store.
 * Includes H3 cell assignment for tracking.
 */
export async function markAsProcessed(
  newIds: string[],
  city: CityConfig,
  scanResult: GridScanResult,
  nameById?: Map<string, string>,
  categoryById?: Map<string, CategoryGuess>,
  rawDataById?: Map<string, Record<string, unknown>>,
  subTypeById?: Map<string, string>,
): Promise<void> {
  const entries = newIds.map((id) => ({
    source: 'google_maps' as const,
    sourceId: id,
    city: city.name,
    cityId: city.id,
    h3Cell: findCellForPlace(id, scanResult.idsByCell),
    name: nameById?.get(id),
    category: categoryById?.get(id),
    subType: subTypeById?.get(id),
    rawData: rawDataById?.get(id),
  }));

  await markKnown(entries);
  log.info(`Marked ${entries.length} places as known`);
}
