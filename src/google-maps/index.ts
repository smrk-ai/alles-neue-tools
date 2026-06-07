import { errorToString } from '../shared/utils.js';
import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { updateCategoryBulk, findNewWithCrossCheck, markCrossMatched, markKnown } from '../shared/delta-store.js';
import type { CategoryGuess, CityConfig, ToolRunReport, DeltaMarkEntry } from '../shared/types.js';
import { scanCity } from './grid-scanner.js';
import { detectNew, markAsProcessed } from './delta-detector.js';
import { getTieredDetailsBatch } from './places-client.js';
import { transformToLead, buildCellLookup } from './lead-transformer.js';
import { mapCategory, mapCategoryFromPrimaryType } from './category-mapper.js';
import { resolveSubType } from '../shared/homestay-filter.js';
import type { GoogleMapsToolOptions, GridScanResult } from './types.js';

const TOOL_SLUG = 'google-maps';

function formatScanErrors(scanResult: GridScanResult): string[] {
  return scanResult.errors.map(
    (e) => `${e.cellId.substring(0, 8)}/${e.category}: ${e.error}`,
  );
}

// --- Tool Class ---

export class GoogleMapsTool extends BaseTool {
  private baselineOnly: boolean;

  constructor(options: GoogleMapsToolOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.baselineOnly = options.baselineOnly;
  }

  async run(city: CityConfig): Promise<ToolRunReport> {
    // Step 1: Grid scan (IDs Only = free)
    const scanResult = await scanCity(city);

    // Step 2: Sync categories for ALL known entries based on scan data
    await this.syncCategories(scanResult, city);

    // Step 3: Delta detection
    const deltaResult = await detectNew(scanResult, city);

    if (deltaResult.newCount === 0) {
      this.log.info('No new places found. Done.');
      return this.buildReport(scanResult.uniqueIdsFound, 0, 0, []);
    }

    // Dry-run: skip detail fetching, pipeline push, and delta marking
    if (this.dryRun) {
      this.log.info(
        `Dry run: ${deltaResult.newCount} new places found. ` +
          `Would fetch details and push to pipeline.`,
      );
      return this.buildReport(
        scanResult.uniqueIdsFound,
        deltaResult.newCount,
        0,
        formatScanErrors(scanResult),
      );
    }

    // Baseline: only register IDs as known (free), no detail fetching
    if (this.baselineOnly) {
      this.log.info(
        `Baseline mode: Marking ${deltaResult.newCount} new IDs as known (no details, no cost)`,
      );
      await markAsProcessed(deltaResult.newIds, city, scanResult);
      return this.buildReport(
        scanResult.uniqueIdsFound,
        deltaResult.newCount,
        0,
        formatScanErrors(scanResult),
      );
    }

    this.log.info(
      `Found ${deltaResult.newCount} new places. Fetching details in chunks...`,
    );

    // Build reverse lookup once: placeId → cellId (avoids O(n*m) per-place scan)
    const cellLookup = buildCellLookup(scanResult.idsByCell);

    // Step 4-8: process new IDs in chunks. Each chunk is fully persisted (pushed +
    // marked known) before the next starts, so a hard timeout mid-run never loses
    // completed work — the next run skips already-known IDs via delta detection and
    // resumes where this one stopped.
    const CHUNK_SIZE = 100;
    const newIds = deltaResult.newIds;
    const chunkTotal = Math.ceil(newIds.length / CHUNK_SIZE);
    let totalPushed = 0;

    for (let offset = 0; offset < newIds.length; offset += CHUNK_SIZE) {
      const chunk = newIds.slice(offset, offset + CHUNK_SIZE);
      const chunkNum = Math.floor(offset / CHUNK_SIZE) + 1;

      const { pushed, budgetExhausted } = await this.processChunk(
        chunk,
        scanResult,
        deltaResult.scanDate,
        cellLookup,
        city,
      );
      totalPushed += pushed;
      this.log.info(`Chunk ${chunkNum}/${chunkTotal}: +${pushed} pushed (total ${totalPushed})`);

      if (budgetExhausted) {
        // All detail tiers exhausted — queue the remaining IDs for next month and stop.
        const remaining = newIds.slice(offset + CHUNK_SIZE);
        if (remaining.length > 0) {
          await this.markQueued(remaining, city, cellLookup);
          this.log.info(`Budget exhausted — queued ${remaining.length} remaining IDs for next month`);
        }
        break;
      }
    }

    // Step 9: Build report
    return this.buildReport(
      scanResult.uniqueIdsFound,
      deltaResult.newCount,
      totalPushed,
      formatScanErrors(scanResult),
    );
  }

  /**
   * Process one chunk of new place IDs end-to-end: fetch details → cross-source
   * dedup → filter → push leads → mark as known. Persisting per chunk makes the
   * run resumable — a hard timeout only loses the in-flight chunk, not prior ones.
   * Returns the push count and whether all budget tiers are exhausted (caller stops).
   */
  private async processChunk(
    chunk: string[],
    scanResult: GridScanResult,
    scanDate: string,
    cellLookup: Map<string, string>,
    city: CityConfig,
  ): Promise<{ pushed: number; budgetExhausted: boolean }> {
    // Step 4: Fetch details for this chunk (tiered, budget-aware)
    const { details, tier, queuedIds } = await getTieredDetailsBatch(chunk);

    if (queuedIds.length > 0) {
      await this.markQueued(queuedIds, city, cellLookup);
    }

    // tier 'queued' means all budget tiers are exhausted → signal caller to stop
    if (tier === 'queued') {
      return { pushed: 0, budgetExhausted: true };
    }
    if (details.length === 0) {
      return { pushed: 0, budgetExhausted: false };
    }

    // Build name + category + subType + rawData lookups for the delta store
    const nameById = new Map<string, string>();
    const categoryById = new Map<string, CategoryGuess>();
    const subTypeById = new Map<string, string>();
    const rawDataById = new Map<string, Record<string, unknown>>();
    for (const d of details) {
      if (d.displayName?.text) nameById.set(d.id, d.displayName.text);
      const cat = mapCategoryFromPrimaryType(d.primaryType) ?? mapCategory(d.types);
      if (cat) categoryById.set(d.id, cat);
      const st = resolveSubType(d.primaryType, d.types, d.displayName?.text);
      if (st) subTypeById.set(d.id, st);
      rawDataById.set(d.id, {
        tier,
        fetched_at: new Date().toISOString(),
        ...d,
      });
    }

    // Step 5: Cross-source name matching
    const crossCheckEntries: DeltaMarkEntry[] = details
      .filter((d) => d.businessStatus !== 'CLOSED_PERMANENTLY')
      .map((d) => ({
        source: 'google_maps' as const,
        sourceId: d.id,
        city: city.name,
        cityId: city.id,
        h3Cell: cellLookup.get(d.id),
        name: d.displayName?.text,
        category: categoryById.get(d.id),
        subType: subTypeById.get(d.id),
      }));

    let trulyNewIds: Set<string>;
    try {
      const { trulyNew, crossMatched } = await findNewWithCrossCheck(crossCheckEntries);
      trulyNewIds = new Set(trulyNew.map((e) => e.sourceId));

      if (crossMatched.length > 0) {
        await markCrossMatched(crossMatched);
        this.log.info(`Cross-source dedup: ${crossMatched.length} matches, ${trulyNew.length} truly new`);
      }
    } catch (err) {
      this.log.warn(`Cross-source check failed, proceeding without: ${errorToString(err)}`);
      trulyNewIds = new Set(chunk);
    }

    // Step 6: Filter closed + homestays, transform to leads (only truly new)
    // subTypeById has an entry iff the place is a homestay-type — reuse instead of re-calling filter
    const homestayCount = [...trulyNewIds].filter((id) => subTypeById.has(id)).length;
    if (homestayCount > 0) {
      this.log.info(`Skipping ${homestayCount} homestays (kept in known_places, not pushed to pipeline)`);
    }

    const leads = details
      .filter((d) =>
        d.businessStatus !== 'CLOSED_PERMANENTLY' &&
        trulyNewIds.has(d.id) &&
        !subTypeById.has(d.id),
      )
      .map((d) =>
        transformToLead(d, {
          city: city.name,
          cityId: city.id,
          h3Cell: cellLookup.get(d.id),
          scanDate,
          isBaseline: this.baselineOnly,
        }),
      );

    // Step 7: Push to pipeline
    let pushedCount = 0;
    const failedPlaceIds = new Set<string>();
    const results = await pushLeads(leads);
    pushedCount = results.filter((r) => r.success).length;
    if (pushedCount < leads.length) {
      this.log.warn(`${leads.length - pushedCount} pushes failed — will retry next run`);
      results.forEach((r, i) => {
        if (!r.success) failedPlaceIds.add(leads[i].source_id!);
      });
    }

    // Step 8: Mark new IDs as known (exclude failed pushes so they retry next run)
    const idsToMark = failedPlaceIds.size > 0
      ? [...trulyNewIds].filter((id) => !failedPlaceIds.has(id))
      : [...trulyNewIds];
    if (idsToMark.length > 0) {
      await markAsProcessed(idsToMark, city, scanResult, nameById, categoryById, rawDataById, subTypeById);
    }

    return { pushed: pushedCount, budgetExhausted: false };
  }

  /**
   * Mark IDs as known without detail data (queued for next month).
   */
  private async markQueued(
    ids: string[],
    city: CityConfig,
    cellLookup: Map<string, string>,
  ): Promise<void> {
    const entries = ids.map((id) => ({
      source: 'google_maps' as const,
      sourceId: id,
      city: city.name,
      cityId: city.id,
      h3Cell: cellLookup.get(id),
    }));
    await markKnown(entries);
    this.log.info(`Marked ${ids.length} IDs as queued (pending details)`);
  }

  /**
   * Sync categories for ALL known entries using scan search types.
   * If an ID was found via 'lodging' search, it's a hotel — update known_places accordingly.
   * Processes categories in priority order: restaurant < cafe < bar < lodging.
   */
  private async syncCategories(scanResult: GridScanResult, city: CityConfig): Promise<void> {
    const CATEGORY_PRIORITY: [string, CategoryGuess][] = [
      ['restaurant', 'restaurants'],
      ['cafe', 'cafes'],
      ['bar', 'bars'],
      ['lodging', 'hotels'],
    ];

    const results = await Promise.all(
      CATEGORY_PRIORITY
        .filter(([searchType]) => {
          const ids = scanResult.idSetsByCategory[searchType];
          return ids && ids.length > 0;
        })
        .map(async ([searchType, internalCategory]) => {
          const ids = scanResult.idSetsByCategory[searchType];
          const updated = await updateCategoryBulk('google_maps', ids, internalCategory, city.id);
          if (updated > 0) {
            this.log.info(`Category sync: ${updated} entries → '${internalCategory}'`);
          }
          return updated;
        }),
    );

    const totalUpdated = results.reduce((sum, n) => sum + n, 0);
    if (totalUpdated > 0) {
      this.log.info(`Category sync complete: ${totalUpdated} entries updated`);
    }
  }

}

/** Factory for orchestrator usage */
export function createTool(options: { city: string; dryRun?: boolean; baselineOnly?: boolean }): GoogleMapsTool {
  return new GoogleMapsTool({ ...options, dryRun: options.dryRun ?? false, baselineOnly: options.baselineOnly ?? false, verbose: false });
}

// --- CLI Entry Point ---

function parseArgs(): GoogleMapsToolOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    city: flagValue('--city') ?? 'hoi-an',
    dryRun: args.includes('--dry-run'),
    baselineOnly: args.includes('--baseline-only'),
    verbose: args.includes('--verbose'),
  };
}

async function main() {
  const options = parseArgs();

  const { loadCities } = await import('../shared/city-config.js');
  await loadCities();

  const city = getCityBySlug(options.city);
  if (!city) {
    console.error(
      `Unknown city: "${options.city}". Available: hoi-an, da-nang`,
    );
    process.exit(1);
  }

  if (options.verbose) {
    process.env.TOOL_ENV = 'development';
  }

  const tool = new GoogleMapsTool(options);
  const report = await tool.execute(city);

  console.log('\n--- Scan Summary ---');
  console.log(`Status:       ${report.status}`);
  console.log(`Places found: ${report.leadsFound}`);
  console.log(`New places:   ${report.leadsNew}`);
  console.log(`Leads pushed: ${report.leadsPushed}`);
  console.log(`Duration:     ${(report.durationMs / 1000).toFixed(1)}s`);
  if (report.errors.length > 0) {
    console.log(`Errors:       ${report.errors.length}`);
  }

  process.exit(report.status === 'failed' ? 1 : 0);
}

// Only run CLI when executed directly, not when imported as module
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''))) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
