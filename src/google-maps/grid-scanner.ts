import { getResolution } from 'h3-js';
import { getAllScanCells, getCellCenter, getChildCells } from '../shared/h3-grid.js';
import { createLogger } from '../shared/logger.js';
import type { CityConfig } from '../shared/types.js';
import { searchNearbyIDs, withRetry } from './places-client.js';
import type { GridScanResult, ScanError } from './types.js';

const log = createLogger('google-maps');

const RADIUS_BY_RESOLUTION: Record<number, number> = {
  8: 500,
  9: 200,
  10: 100,
  11: 30,
};
const DEFAULT_RADIUS = 300;
const MAX_SUBDIVISION_RESOLUTION = 10;
const API_RESULT_CAP = 20;
const DELAY_BETWEEN_CATEGORIES_MS = 200;
const DELAY_BETWEEN_CELLS_MS = 200;

function getRadiusForCell(cellId: string): number {
  const res = getResolution(cellId);
  return RADIUS_BY_RESOLUTION[res] ?? DEFAULT_RADIUS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Subdivision tracking (reset per scan)
let subdivisionCount = 0;
let maxCapCount = 0;

/**
 * Scan a single cell/category combo, subdividing recursively if the API cap is hit.
 * Returns all found place IDs (deduplicated across parent + children).
 */
async function scanCellCategory(
  cellId: string,
  category: string,
  cellLabel: string,
): Promise<string[]> {
  const center = getCellCenter(cellId);
  const ids = await withRetry(() =>
    searchNearbyIDs({
      lat: center.lat,
      lng: center.lng,
      radius: getRadiusForCell(cellId),
      includedTypes: [category],
    }),
  );

  await sleep(DELAY_BETWEEN_CATEGORIES_MS);

  if (ids.length < API_RESULT_CAP) {
    return ids;
  }

  // Cap hit — check if we can subdivide deeper
  const res = getResolution(cellId);
  if (res >= MAX_SUBDIVISION_RESOLUTION) {
    maxCapCount++;
    log.debug(
      `${cellLabel} | ${category}: cap hit at max res ${res} — accepting ${ids.length} as best effort`,
    );
    return ids;
  }

  // Subdivide into 7 children
  const childRes = res + 1;
  const children = getChildCells(cellId);
  subdivisionCount++;
  log.debug(
    `${cellLabel} | ${category}: cap hit (${ids.length}), subdividing to res ${childRes} (${children.length} children)`,
  );

  // Keep parent IDs as a head start, add children's IDs on top
  const allIds = new Set(ids);
  for (const child of children) {
    const childIds = await scanCellCategory(child, category, cellLabel);
    childIds.forEach((id) => allIds.add(id));
  }

  return Array.from(allIds);
}

/**
 * Scan all H3 cells of a city for Google Places IDs.
 * Returns deduplicated IDs across all cells and categories.
 */
export async function scanCity(city: CityConfig): Promise<GridScanResult> {
  const startTime = Date.now();
  const allIds = new Map<string, Set<string>>(); // category → Set<placeId>
  const idsByCell = new Map<string, string[]>();
  const errors: ScanError[] = [];

  // Reset subdivision counters
  subdivisionCount = 0;
  maxCapCount = 0;

  const cells = getAllScanCells(city);
  const categories = city.categories;

  log.info(
    `Scanning ${cells.length} cells × ${categories.length} categories for ${city.name}`,
  );

  for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
    const cell = cells[cellIdx];
    const cellIds: string[] = [];
    const cellLabel = `Cell ${cellIdx + 1}/${cells.length}`;

    for (const category of categories) {
      try {
        const ids = await scanCellCategory(cell, category, cellLabel);

        ids.forEach((id) => cellIds.push(id));

        if (!allIds.has(category)) allIds.set(category, new Set());
        ids.forEach((id) => allIds.get(category)!.add(id));

        log.debug(`${cellLabel} | ${category}: ${ids.length} IDs`);
      } catch (error) {
        errors.push({
          cellId: cell,
          category,
          error: error instanceof Error ? error.message : String(error),
          retried: true,
        });
        log.warn(
          `Error scanning cell ${cellIdx + 1} for ${category}: ${error}`,
        );
      }
    }

    // Deduplicate within cell
    idsByCell.set(cell, [...new Set(cellIds)]);

    // Progress log every 10 cells
    if ((cellIdx + 1) % 10 === 0 || cellIdx === cells.length - 1) {
      const pct = Math.round(((cellIdx + 1) / cells.length) * 100);
      log.info(`Progress: ${cellIdx + 1}/${cells.length} cells (${pct}%)`);
    }

    await sleep(DELAY_BETWEEN_CELLS_MS);
  }

  // Global deduplication
  const uniqueIds = new Set<string>();
  allIds.forEach((ids) => ids.forEach((id) => uniqueIds.add(id)));

  const result: GridScanResult = {
    city: city.name,
    cellsScanned: cells.length,
    totalIdsFound: Array.from(allIds.values()).reduce(
      (sum, s) => sum + s.size,
      0,
    ),
    uniqueIdsFound: uniqueIds.size,
    idsByCategory: Object.fromEntries(
      Array.from(allIds.entries()).map(([k, v]) => [k, v.size]),
    ),
    idSetsByCategory: Object.fromEntries(
      Array.from(allIds.entries()).map(([k, v]) => [k, Array.from(v)]),
    ),
    idsByCell: Object.fromEntries(idsByCell),
    allUniqueIds: Array.from(uniqueIds),
    durationMs: Date.now() - startTime,
    errors,
  };

  log.info(
    `Scan complete: ${result.uniqueIdsFound} unique IDs in ${result.cellsScanned} cells (${result.durationMs}ms)`,
    { categories: result.idsByCategory, errors: errors.length },
  );

  if (subdivisionCount > 0) {
    log.info(
      `Subdivisions: ${subdivisionCount} cells subdivided, ${maxCapCount} at max resolution`,
    );
  }

  return result;
}
