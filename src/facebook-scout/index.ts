import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { findNew, markKnown } from '../shared/delta-store.js';
import { checkAllTokens } from '../shared/token-refresh.js';
import type { CityConfig, ToolRunReport } from '../shared/types.js';
import { scanCity } from './place-search.js';
import { transformToLead } from './lead-transformer.js';
import type { FacebookToolOptions, FacebookPlace } from './types.js';

const TOOL_SLUG = 'facebook-scout';

// --- Tool Class ---

export class FacebookScoutTool extends BaseTool {
  private checkTokens: boolean;

  constructor(options: FacebookToolOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.checkTokens = options.checkTokens;
  }

  async run(city: CityConfig): Promise<ToolRunReport> {
    // Step 1: Check tokens (optional)
    if (this.checkTokens) {
      const statuses = await checkAllTokens();
      for (const s of statuses) {
        if (s.warning) {
          this.log.warn(`${s.name}: ${s.warning}`);
        }
      }
    }

    // Step 2: Scan city for Facebook Places
    const scanResult = await scanCity(city);

    if (scanResult.places.length === 0) {
      this.log.info('No places found. Done.');
      return this.buildReport(0, 0, 0, scanResult.errors);
    }

    // Step 3: Delta detection
    const entries = scanResult.places.map((p) => ({
      source: 'facebook' as const,
      sourceId: p.id,
    }));

    const newEntries = await findNew(entries);
    const newIds = new Set(newEntries.map((e) => e.sourceId));
    const newPlaces = scanResult.places.filter((p) => newIds.has(p.id));

    this.log.info(
      `Delta: ${scanResult.places.length} scanned, ` +
        `${scanResult.places.length - newPlaces.length} known, ` +
        `${newPlaces.length} NEW`,
    );

    if (newPlaces.length === 0) {
      this.log.info('No new places. Done.');
      return this.buildReport(scanResult.places.length, 0, 0, scanResult.errors);
    }

    // Step 4: Dry-run check
    if (this.dryRun) {
      this.log.info(
        `Dry run: ${newPlaces.length} new places found. ` +
          `Would transform and push to pipeline.`,
      );
      return this.buildReport(
        scanResult.places.length,
        newPlaces.length,
        0,
        scanResult.errors,
      );
    }

    // Step 5: Transform to leads
    const scanDate = new Date().toISOString();
    const leads = newPlaces.map((p) =>
      transformToLead(p, { city: city.name, cityId: city.id, scanDate }),
    );

    // Step 6: Push to pipeline
    const results = await pushLeads(leads);
    const pushedCount = results.filter((r) => r.success).length;
    if (pushedCount < leads.length) {
      this.log.warn(`${leads.length - pushedCount} pushes failed — will retry next run`);
    }

    // Step 7: Mark as known in delta store (exclude failed pushes so they retry
    // next run instead of being silently lost — leads/newPlaces are index-aligned)
    const failedIds = new Set(
      results.flatMap((r, i) => (r.success ? [] : [newPlaces[i].id])),
    );
    const toMark = newPlaces.filter((p) => !failedIds.has(p.id));
    await markKnown(
      toMark.map((p) => ({
        source: 'facebook' as const,
        sourceId: p.id,
        city: city.name,
        cityId: city.id,
        name: p.name,
        lat: p.location?.latitude,
        lng: p.location?.longitude,
      })),
    );

    // Step 8: Build report
    return this.buildReport(
      scanResult.places.length,
      newPlaces.length,
      pushedCount,
      scanResult.errors,
    );
  }

}

/** Factory for orchestrator usage */
export function createTool(options: { city: string; dryRun?: boolean }): FacebookScoutTool {
  return new FacebookScoutTool({ ...options, dryRun: options.dryRun ?? false, checkTokens: false, verbose: false });
}

// --- CLI Entry Point ---

function parseArgs(): FacebookToolOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    city: flagValue('--city') ?? 'hoi-an',
    dryRun: args.includes('--dry-run'),
    checkTokens: args.includes('--check-tokens'),
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

  const tool = new FacebookScoutTool(options);
  const report = await tool.execute(city);

  console.log('\n--- Facebook Scout Summary ---');
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
