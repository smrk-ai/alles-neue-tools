import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import type { CityConfig, ToolRunReport } from '../shared/types.js';
import { scanCity } from './grid-scanner.js';
import { detectNew, markAsProcessed } from './delta-detector.js';
import { getBasicDetailsBatch } from './places-client.js';
import { transformToLead, findCellForPlace } from './lead-transformer.js';
import type { GoogleMapsToolOptions } from './types.js';

const TOOL_SLUG = 'google-maps';

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

    // Step 2: Delta detection
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
      const scanErrors = scanResult.errors.map(
        (e) => `${e.cellId.substring(0, 8)}/${e.category}: ${e.error}`,
      );
      return this.buildReport(
        scanResult.uniqueIdsFound,
        deltaResult.newCount,
        0,
        scanErrors,
      );
    }

    this.log.info(
      `Found ${deltaResult.newCount} new places. Fetching details...`,
    );

    // Step 3: Fetch details for new places (Basic tier)
    const details = await getBasicDetailsBatch(deltaResult.newIds);

    // Step 4: Filter closed, transform to leads
    const leads = details
      .filter((d) => d.businessStatus !== 'CLOSED_PERMANENTLY')
      .map((d) =>
        transformToLead(d, {
          city: city.name,
          cityId: city.id,
          h3Cell: findCellForPlace(d.id, scanResult.idsByCell),
          scanDate: deltaResult.scanDate,
          isBaseline: this.baselineOnly,
        }),
      );

    // Step 5: Push to pipeline (unless baseline-only)
    let pushedCount = 0;
    const failedPlaceIds = new Set<string>();
    if (!this.baselineOnly) {
      const results = await pushLeads(leads);
      pushedCount = results.filter((r) => r.success).length;
      if (pushedCount < leads.length) {
        this.log.warn(`${leads.length - pushedCount} pushes failed — will retry next run`);
        results.forEach((r, i) => {
          if (!r.success) failedPlaceIds.add(leads[i].source_id!);
        });
      }
    } else {
      this.log.info(
        `Baseline mode: Skipping pipeline push for ${leads.length} leads`,
      );
    }

    // Step 6: Mark new IDs as known (exclude failed pushes so they retry next run)
    const idsToMark = failedPlaceIds.size > 0
      ? deltaResult.newIds.filter((id) => !failedPlaceIds.has(id))
      : deltaResult.newIds;
    if (idsToMark.length > 0) {
      await markAsProcessed(idsToMark, city, scanResult);
    }

    // Step 7: Build report
    const scanErrors = scanResult.errors.map(
      (e) => `${e.cellId.substring(0, 8)}/${e.category}: ${e.error}`,
    );
    return this.buildReport(
      scanResult.uniqueIdsFound,
      deltaResult.newCount,
      pushedCount,
      scanErrors,
    );
  }

  private buildReport(
    found: number,
    newCount: number,
    pushed: number,
    errors: string[],
  ): ToolRunReport {
    return {
      toolSlug: TOOL_SLUG,
      city: this.city,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      leadsFound: found,
      leadsNew: newCount,
      leadsPushed: pushed,
      errors,
      status: errors.length === 0 ? 'success' : 'partial',
    };
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
