// ===========================================
// OSM Changeset Monitor – Orchestrator + CLI
// ===========================================

import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { findNew, markKnown } from '../shared/delta-store.js';
import type { CityConfig, ToolRunReport, DeltaEntry, DeltaMarkEntry } from '../shared/types.js';
import { getBboxForCity } from './config.js';
import { buildQuery, queryOverpass } from './overpass-client.js';
import { transformElement } from './transformer.js';
import type { OsmMonitorOptions } from './types.js';

const TOOL_SLUG = 'osm-monitor';
const DEFAULT_DAYS = 7;

// --- Tool Class ---

export class OsmMonitorTool extends BaseTool {
  private days: number;
  private onlyNew: boolean;

  constructor(options: OsmMonitorOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.days = options.days;
    this.onlyNew = options.onlyNew;
  }

  async run(city: CityConfig): Promise<ToolRunReport> {
    const errors: string[] = [];

    // Step 1: Build bbox from city boundary
    const bbox = getBboxForCity(city);
    this.log.info(`Querying Overpass for ${city.name}`, {
      bbox: bbox.join(', '),
      daysBack: this.days,
      onlyNew: this.onlyNew,
    });

    // Step 2: Build and execute Overpass query
    const query = buildQuery({ bbox, daysBack: this.days, onlyNew: this.onlyNew });
    this.log.debug('Overpass query', { query });

    let elements;
    try {
      elements = await queryOverpass(query);
    } catch (err) {
      const msg = `Overpass query failed: ${err instanceof Error ? err.message : String(err)}`;
      this.log.error(msg);
      errors.push(msg);
      return this.buildReport(0, 0, 0, errors);
    }

    this.log.info(`Overpass returned ${elements.length} elements`);

    if (elements.length === 0) {
      return this.buildReport(0, 0, 0, errors);
    }

    // Step 3: Delta detection — find new elements
    const deltaEntries: DeltaEntry[] = elements.map((el) => ({
      source: 'osm',
      sourceId: `${el.type}/${el.id}`,
    }));

    let newEntries: DeltaEntry[];
    try {
      newEntries = await findNew(deltaEntries);
    } catch (err) {
      const msg = `Delta store error: ${err instanceof Error ? err.message : String(err)}`;
      this.log.error(msg);
      errors.push(msg);
      return this.buildReport(elements.length, 0, 0, errors);
    }

    const newIds = new Set(newEntries.map((e) => e.sourceId));
    const newElements = elements.filter((el) => newIds.has(`${el.type}/${el.id}`));

    this.log.info(
      `Delta: ${elements.length} total, ${elements.length - newElements.length} known, ${newElements.length} new`,
    );

    if (newElements.length === 0) {
      this.log.info('No new OSM elements. Done.');
      return this.buildReport(elements.length, 0, 0, errors);
    }

    // Step 4: Transform new elements to pipeline leads
    const leads = newElements.map((el) => transformElement(el, city.name));

    for (const lead of leads) {
      this.log.debug(`  New: ${lead.name ?? '(unnamed)'} | ${lead.category_guess ?? '?'} | ${lead.source_id}`);
    }

    // Step 5: Push to pipeline
    let pushedCount = 0;
    if (!this.dryRun && leads.length > 0) {
      const results = await pushLeads(leads);
      pushedCount = results.filter((r) => r.success).length;
      this.log.info(`Pushed ${pushedCount}/${leads.length} leads to pipeline`);
    } else if (this.dryRun && leads.length > 0) {
      this.log.info(`[DRY RUN] Would push ${leads.length} leads. Skipping.`);
      for (const lead of leads) {
        this.log.info(`  → ${lead.name ?? '(unnamed)'} | ${lead.category_guess ?? '?'} | ${lead.source_url}`);
      }
    }

    // Step 6: Mark all new elements as known in delta store
    if (!this.dryRun) {
      const markEntries: DeltaMarkEntry[] = newElements.map((el) => ({
        source: 'osm',
        sourceId: `${el.type}/${el.id}`,
        city: city.name,
        cityId: city.id,
        name: el.tags.name || el.tags['name:en'] || el.tags['name:vi'] || undefined,
      }));

      try {
        await markKnown(markEntries);
      } catch (err) {
        const msg = `markKnown error: ${err instanceof Error ? err.message : String(err)}`;
        this.log.error(msg);
        errors.push(msg);
      }
    }

    return this.buildReport(elements.length, newElements.length, pushedCount, errors);
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
export function createTool(options: { city: string; dryRun?: boolean; days?: number }): OsmMonitorTool {
  return new OsmMonitorTool({ ...options, dryRun: options.dryRun ?? false, days: options.days ?? DEFAULT_DAYS, onlyNew: false, verbose: false });
}

// --- CLI Entry Point ---

function parseArgs(): OsmMonitorOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const daysRaw = flagValue('--days');
  const days = daysRaw !== undefined ? parseInt(daysRaw, 10) : DEFAULT_DAYS;

  return {
    city: flagValue('--city') ?? 'hoi-an',
    dryRun: args.includes('--dry-run'),
    days: isNaN(days) ? DEFAULT_DAYS : days,
    onlyNew: args.includes('--only-new'),
    verbose: args.includes('--verbose'),
  };
}

async function main() {
  const options = parseArgs();

  const city = getCityBySlug(options.city);
  if (!city) {
    console.error(`Unknown city: "${options.city}". Available: hoi-an, da-nang`);
    process.exit(1);
  }

  if (options.verbose) {
    process.env.TOOL_ENV = 'development';
  }

  const tool = new OsmMonitorTool(options);
  const report = await tool.execute(city);

  console.log('\n--- OSM Monitor Summary ---');
  console.log(`Status:         ${report.status}`);
  console.log(`Elements found: ${report.leadsFound}`);
  console.log(`New elements:   ${report.leadsNew}`);
  console.log(`Leads pushed:   ${report.leadsPushed}`);
  console.log(`Duration:       ${(report.durationMs / 1000).toFixed(1)}s`);
  if (report.errors.length > 0) {
    console.log(`Errors (${report.errors.length}):`);
    for (const e of report.errors) console.log(`  - ${e}`);
  }

  process.exit(report.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
