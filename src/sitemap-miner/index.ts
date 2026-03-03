import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug, getCityIdBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { markKnown, findNewWithCrossCheck, markCrossMatched } from '../shared/delta-store.js';
import type { CityConfig, ToolRunReport, DeltaMarkEntry, CrossMatchResult } from '../shared/types.js';
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
    let totalCrossMatched = 0;

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

      // Step 2b: Intra-source delta detection
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

      // Step 2c: Enrich new URLs (need names for cross-source matching)
      const enriched = enrichEntries(deltaResult.newEntries, source);

      // Step 2d: Cross-source name matching
      const cityId = getCityIdBySlug(source.citySlug)!;
      const enrichedByUrl = new Map(enriched.map((en) => [en.url, en]));
      const markEntries: DeltaMarkEntry[] = deltaResult.newEntries.map((e) => ({
        source: source.platform,
        sourceId: extractSourceId(e.loc),
        city: source.city,
        cityId,
        name: enrichedByUrl.get(e.loc)?.name || undefined,
        category: source.category,
      }));

      let trulyNewEntries: DeltaMarkEntry[];
      let crossMatches: CrossMatchResult[] = [];

      try {
        const crossResult = await findNewWithCrossCheck(markEntries);
        trulyNewEntries = crossResult.trulyNew;
        crossMatches = crossResult.crossMatched;
        totalCrossMatched += crossMatches.length;
      } catch (err) {
        const msg = `Cross-source check error for ${source.id}: ${err instanceof Error ? err.message : String(err)}`;
        this.log.warn(msg);
        // Fallback: treat all as truly new (graceful degradation)
        trulyNewEntries = markEntries;
      }

      totalNew += trulyNewEntries.length;

      // Step 2e: Build leads only for truly new entries
      const trulyNewSourceIds = new Set(trulyNewEntries.map((e) => e.sourceId));
      const trulyNewEnriched = enriched.filter((e) => {
        const sid = extractSourceId(e.url);
        return trulyNewSourceIds.has(sid);
      });
      const leads = buildLeads(trulyNewEnriched, source.id);

      // Step 2f: Push to pipeline (only truly new, not cross-matched)
      let pushResults: Awaited<ReturnType<typeof pushLeads>> = [];
      if (!this.dryRun && leads.length > 0) {
        pushResults = await pushLeads(leads);
        const pushed = pushResults.filter((r) => r.success).length;
        totalPushed += pushed;
        this.log.info(`Pushed ${pushed}/${leads.length} leads for: ${source.id}`);
        if (pushed < leads.length) {
          this.log.warn(`${leads.length - pushed} pushes failed for: ${source.id} — will retry next run`);
        }
      } else if (this.dryRun && leads.length > 0) {
        this.log.info(`[DRY RUN] Would push ${leads.length} leads for: ${source.id}`);
        for (const lead of leads) {
          this.log.info(`  → ${lead.name ?? '(unnamed)'} | ${lead.category_guess ?? '?'} | ${lead.source_url}`);
        }
      }

      if (this.dryRun && crossMatches.length > 0) {
        this.log.info(`[DRY RUN] ${crossMatches.length} cross-source matches (would skip pipeline push)`);
      }

      // Step 2g: Mark entries as known
      if (!this.dryRun) {
        // Mark truly new entries that were successfully pushed
        const entriesToMark = pushResults.length > 0
          ? trulyNewEntries.filter((_, i) => pushResults[i]?.success)
          : trulyNewEntries;

        if (entriesToMark.length > 0) {
          try {
            await markKnown(entriesToMark);
          } catch (err) {
            const msg = `markKnown error for ${source.id}: ${err instanceof Error ? err.message : String(err)}`;
            this.log.error(msg);
            errors.push(msg);
          }
        }

        // Mark cross-matched entries with canonical_id linkage
        if (crossMatches.length > 0) {
          try {
            await markCrossMatched(crossMatches);
          } catch (err) {
            const msg = `markCrossMatched error for ${source.id}: ${err instanceof Error ? err.message : String(err)}`;
            this.log.error(msg);
            errors.push(msg);
          }
        }
      }
    }

    if (totalCrossMatched > 0) {
      this.log.info(`Cross-source dedup total: ${totalCrossMatched} duplicates prevented`);
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

// Only run CLI when executed directly, not when imported as module
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''))) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
