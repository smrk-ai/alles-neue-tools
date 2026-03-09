import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug, getCityIdBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { findNew, markKnown } from '../shared/delta-store.js';
import type { CityConfig, ToolRunReport, DeltaEntry, DeltaMarkEntry } from '../shared/types.js';
import { getWatchesForCity } from './config.js';
import { listWatches, getSnapshot } from './api-client.js';
import { parseSnapshot } from './snapshot-parser.js';
import { transformToLeads } from './lead-transformer.js';
import type { CDToolOptions, CDWatchSummary } from './types.js';

const TOOL_SLUG = 'changedetection';
const DEFAULT_LOOKBACK_HOURS = 48; // Process changes from the last 48 hours

// --- Tool Class ---

export class ChangeDetectionTool extends BaseTool {
  private forceCheck: boolean;

  constructor(options: CDToolOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.forceCheck = options.forceCheck;
  }

  async run(_city: CityConfig): Promise<ToolRunReport> {
    const errors: string[] = [];
    let totalFound = 0;
    let totalNew = 0;
    let totalPushed = 0;

    // Step 1: Get configured watches for this city
    const watches = getWatchesForCity(this.city);
    this.log.info(`Processing ${watches.length} configured watches for: ${this.city}`);

    if (watches.length === 0) {
      this.log.warn('No watches configured (UUIDs missing). Set up changedetection.io and add UUIDs to config.ts');
      return this.buildReport(0, 0, 0, errors);
    }

    // Step 2: Fetch all watch states from changedetection.io API
    let allWatchStates: Record<string, CDWatchSummary>;
    try {
      allWatchStates = await listWatches();
      this.log.info(`Got ${Object.keys(allWatchStates).length} watches from changedetection.io`);
    } catch (err) {
      const msg = `Failed to connect to changedetection.io: ${err instanceof Error ? err.message : String(err)}`;
      this.log.error(msg);
      errors.push(msg);
      return this.buildReport(0, 0, 0, errors);
    }

    const lookbackCutoff = Date.now() / 1000 - DEFAULT_LOOKBACK_HOURS * 3600;

    // Step 3: Process each watch
    for (const watchConfig of watches) {
      const watchState = allWatchStates[watchConfig.uuid];

      if (!watchState) {
        this.log.warn(`Watch UUID ${watchConfig.uuid} (${watchConfig.id}) not found in changedetection.io`);
        errors.push(`Watch not found: ${watchConfig.id}`);
        continue;
      }

      if (watchState.paused) {
        this.log.debug(`Watch ${watchConfig.id} is paused, skipping`);
        continue;
      }

      if (watchState.last_error) {
        this.log.warn(`Watch ${watchConfig.id} has error: ${watchState.last_error}`);
      }

      // Check if this watch has recent changes
      if (!this.forceCheck && watchState.last_changed < lookbackCutoff) {
        this.log.debug(`Watch ${watchConfig.id}: no changes in last ${DEFAULT_LOOKBACK_HOURS}h, skipping`);
        continue;
      }

      this.log.info(`Processing watch: ${watchConfig.label}`);

      // Step 4: Get latest snapshot
      let snapshotText: string;
      try {
        snapshotText = await getSnapshot(watchConfig.uuid, 'latest');
      } catch (err) {
        const msg = `Failed to get snapshot for ${watchConfig.id}: ${err instanceof Error ? err.message : String(err)}`;
        this.log.error(msg);
        errors.push(msg);
        continue;
      }

      if (!snapshotText) {
        this.log.debug(`No snapshot available for ${watchConfig.id}`);
        continue;
      }

      // Step 5: Parse snapshot into items
      const items = parseSnapshot(snapshotText, watchConfig.parser, watchConfig);
      this.log.info(`Parsed ${items.length} items from: ${watchConfig.label}`);
      totalFound += items.length;

      if (items.length === 0) continue;

      // Step 6: Delta detection
      const deltaEntries: DeltaEntry[] = items.map((item) => ({
        source: watchConfig.leadSource,
        sourceId: `cd:${watchConfig.id}:${item.externalId}`,
      }));

      let newEntries: DeltaEntry[];
      try {
        newEntries = await findNew(deltaEntries);
      } catch (err) {
        const msg = `Delta store error for ${watchConfig.id}: ${err instanceof Error ? err.message : String(err)}`;
        this.log.error(msg);
        errors.push(msg);
        continue;
      }

      const newIds = new Set(newEntries.map((e) => e.sourceId));
      const newItems = items.filter((item) => newIds.has(`cd:${watchConfig.id}:${item.externalId}`));

      this.log.info(
        `Delta ${watchConfig.id}: ${items.length} total, ${items.length - newItems.length} known, ${newItems.length} new`,
      );
      totalNew += newItems.length;

      if (newItems.length === 0) continue;

      // Step 7: Transform to leads and push
      const leads = transformToLeads(newItems, watchConfig);

      if (!this.dryRun && leads.length > 0) {
        const results = await pushLeads(leads);
        const pushed = results.filter((r) => r.success).length;
        totalPushed += pushed;
        this.log.info(`Pushed ${pushed}/${leads.length} leads from ${watchConfig.id}`);
      } else if (this.dryRun && leads.length > 0) {
        this.log.info(`[DRY RUN] Would push ${leads.length} leads from ${watchConfig.id}. Skipping.`);
        for (const lead of leads) {
          this.log.info(`  → ${lead.name ?? '(unnamed)'} | ${lead.category_guess ?? '?'} | ${lead.source}`);
        }
      }

      // Step 8: Mark ALL parsed items as known (not just new ones)
      if (!this.dryRun) {
        const markEntries: DeltaMarkEntry[] = items.map((item) => ({
          source: watchConfig.leadSource,
          sourceId: `cd:${watchConfig.id}:${item.externalId}`,
          city: watchConfig.city,
          cityId: getCityIdBySlug(watchConfig.citySlug)!,
          name: item.name?.substring(0, 100) || undefined,
        }));

        try {
          await markKnown(markEntries);
        } catch (err) {
          const msg = `markKnown error for ${watchConfig.id}: ${err instanceof Error ? err.message : String(err)}`;
          this.log.error(msg);
          errors.push(msg);
        }
      }
    }

    return this.buildReport(totalFound, totalNew, totalPushed, errors);
  }

}

/** Factory for orchestrator usage */
export function createTool(options: { city: string; dryRun?: boolean; forceCheck?: boolean }): ChangeDetectionTool {
  return new ChangeDetectionTool({ ...options, dryRun: options.dryRun ?? false, forceCheck: options.forceCheck ?? false, verbose: false });
}

// --- CLI Entry Point ---

function parseArgs(): CDToolOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    city: flagValue('--city') ?? 'all',
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    forceCheck: args.includes('--force-check'),
  };
}

async function main() {
  const options = parseArgs();

  // Validate city
  if (options.city !== 'all') {
    const city = getCityBySlug(options.city);
    if (!city) {
      console.error(`Unknown city: "${options.city}". Available: hoi-an, da-nang, all`);
      process.exit(1);
    }
  }

  if (options.verbose) {
    process.env.TOOL_ENV = 'development';
  }

  const cityConfig: CityConfig = options.city === 'all'
    ? { id: '', name: 'All Cities', slug: 'all', country: 'VN', boundary: [], resolution: 8, categories: [] }
    : getCityBySlug(options.city)!;

  const tool = new ChangeDetectionTool(options);
  const report = await tool.execute(cityConfig);

  console.log('\n--- ChangeDetection Summary ---');
  console.log(`Status:         ${report.status}`);
  console.log(`Items parsed:   ${report.leadsFound}`);
  console.log(`New items:      ${report.leadsNew}`);
  console.log(`Leads pushed:   ${report.leadsPushed}`);
  console.log(`Duration:       ${(report.durationMs / 1000).toFixed(1)}s`);
  if (report.errors.length > 0) {
    console.log(`Errors (${report.errors.length}):`);
    for (const e of report.errors) console.log(`  - ${e}`);
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
