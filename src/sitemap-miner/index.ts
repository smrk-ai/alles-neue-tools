import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { markKnown } from '../shared/delta-store.js';
import type { CityConfig, ToolRunReport, DeltaMarkEntry } from '../shared/types.js';
import { getSourcesForCity, getSourceById } from './config.js';
import { fetchSitemapEntries } from './sitemap-fetcher.js';
import { findNewEntries, extractSourceId } from './delta-engine.js';
import { enrichEntries } from './url-enricher.js';
import { buildLeads } from './lead-builder.js';
import type { SitemapMinerOptions, SitemapSourceConfig } from './types.js';

const TOOL_SLUG = 'sitemap-miner';

// --- Tool Class ---

export class SitemapMinerTool extends BaseTool {
  private configId?: string;

  constructor(options: SitemapMinerOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.configId = options.configId;
  }

  async run(_city: CityConfig): Promise<ToolRunReport> {
    const errors: string[] = [];

    // Step 1: Get source configs
    let sources: SitemapSourceConfig[];
    if (this.configId) {
      const single = getSourceById(this.configId);
      if (!single) {
        return this.buildReport(0, 0, 0, [`Unknown config ID: ${this.configId}`]);
      }
      sources = [single];
    } else {
      sources = getSourcesForCity(this.city);
    }

    this.log.info(`Processing ${sources.length} sitemap source(s) for: ${this.city}`);

    let totalFound = 0;
    let totalNew = 0;
    let totalPushed = 0;

    // Step 2: Process each source config
    for (const source of sources) {
      this.log.info(`--- Processing: ${source.id} ---`);

      // Step 2a: Fetch sitemap entries
      let entries;
      try {
        entries = await fetchSitemapEntries(source);
      } catch (err) {
        const msg = `Fetch error for ${source.id}: ${err instanceof Error ? err.message : String(err)}`;
        this.log.error(msg);
        errors.push(msg);
        continue;
      }

      totalFound += entries.length;

      if (entries.length === 0) {
        this.log.info(`No matching URLs found for: ${source.id}`);
        continue;
      }

      // Step 2b: Delta detection
      let deltaResult;
      try {
        deltaResult = await findNewEntries(entries, source.platform);
      } catch (err) {
        const msg = `Delta store error for ${source.id}: ${err instanceof Error ? err.message : String(err)}`;
        this.log.error(msg);
        errors.push(msg);
        continue;
      }

      if (deltaResult.newEntries.length === 0) {
        this.log.info(`No new URLs for: ${source.id}`);
        continue;
      }

      totalNew += deltaResult.newEntries.length;

      // Step 2c: Enrich new URLs
      const enriched = enrichEntries(deltaResult.newEntries, source);

      // Step 2d: Mark new entries as known BEFORE pushing (prevents death loop on SIGTERM)
      if (!this.dryRun) {
        const markEntries: DeltaMarkEntry[] = deltaResult.newEntries.map((e) => ({
          source: source.platform,
          sourceId: extractSourceId(e.loc),
          city: source.city,
          name: enriched.find((en) => en.url === e.loc)?.name || undefined,
        }));

        try {
          await markKnown(markEntries);
        } catch (err) {
          const msg = `markKnown error for ${source.id}: ${err instanceof Error ? err.message : String(err)}`;
          this.log.error(msg);
          errors.push(msg);
        }
      }

      // Step 2e: Build leads
      const leads = buildLeads(enriched, source.id);

      // Step 2f: Push to pipeline
      if (!this.dryRun && leads.length > 0) {
        const results = await pushLeads(leads);
        const pushed = results.filter((r) => r.success).length;
        totalPushed += pushed;
        this.log.info(`Pushed ${pushed}/${leads.length} leads for: ${source.id}`);
      } else if (this.dryRun && leads.length > 0) {
        this.log.info(`[DRY RUN] Would push ${leads.length} leads for: ${source.id}`);
        for (const lead of leads) {
          this.log.info(`  → ${lead.name ?? '(unnamed)'} | ${lead.category_guess ?? '?'} | ${lead.source_url}`);
        }
      }
    }

    return this.buildReport(totalFound, totalNew, totalPushed, errors);
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
export function createTool(options: { city: string; dryRun?: boolean; configId?: string }): SitemapMinerTool {
  return new SitemapMinerTool({ ...options, dryRun: options.dryRun ?? false, verbose: false });
}

// --- CLI Entry Point ---

function parseArgs(): SitemapMinerOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    city: flagValue('--city') ?? 'all',
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    configId: flagValue('--config'),
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

  // BaseTool.execute() needs a CityConfig
  const cityConfig: CityConfig = options.city === 'all'
    ? { id: '', name: 'All Cities', slug: 'all', country: 'VN', boundary: [], resolution: 8, categories: [] }
    : getCityBySlug(options.city)!;

  const tool = new SitemapMinerTool(options);
  const report = await tool.execute(cityConfig);

  console.log('\n--- Sitemap Miner Summary ---');
  console.log(`Status:         ${report.status}`);
  console.log(`URLs found:     ${report.leadsFound}`);
  console.log(`New URLs:       ${report.leadsNew}`);
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
