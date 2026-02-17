import { BaseTool } from '../shared/tool-runner.js';
import { getCityBySlug } from '../shared/city-config.js';
import { pushLeads } from '../shared/pipeline-client.js';
import { findNew, markKnown } from '../shared/delta-store.js';
import type { CityConfig, ToolRunReport, DeltaEntry, DeltaMarkEntry } from '../shared/types.js';
import { getFeedsForCity } from './config.js';
import { fetchAllFeeds } from './rss-parser.js';
import { filterRelevant } from './relevance-filter.js';
import { extractLeads } from './lead-extractor.js';
import type { AlertsToolOptions, ParsedFeedItem } from './types.js';

const TOOL_SLUG = 'google-alerts';
const DEFAULT_MIN_SCORE = 1;

// --- Tool Class ---

class GoogleAlertsTool extends BaseTool {
  private minScore: number;

  constructor(options: AlertsToolOptions) {
    super({
      toolSlug: TOOL_SLUG,
      city: options.city,
      dryRun: options.dryRun,
    });
    this.minScore = options.minScore;
  }

  async run(_city: CityConfig): Promise<ToolRunReport> {
    const errors: string[] = [];

    // Step 1: Get feeds for this city (or all)
    const feeds = getFeedsForCity(this.city);
    const configuredFeeds = feeds.filter((f) => f.rssUrl);
    this.log.info(`Processing ${configuredFeeds.length}/${feeds.length} configured feeds for: ${this.city}`);

    // Step 2: Fetch and parse all feeds
    const allItems = await fetchAllFeeds(feeds);
    this.log.info(`Fetched ${allItems.length} total alert items`);

    if (allItems.length === 0) {
      return this.buildReport(0, 0, 0, errors);
    }

    // Step 3: Delta detection — filter to only new guids
    const deltaEntries: DeltaEntry[] = allItems.map((item) => ({
      source: 'google_alert',
      sourceId: item.guid,
    }));

    let newEntries: DeltaEntry[];
    try {
      newEntries = await findNew(deltaEntries);
    } catch (err) {
      const msg = `Delta store error: ${err instanceof Error ? err.message : String(err)}`;
      this.log.error(msg);
      errors.push(msg);
      return this.buildReport(allItems.length, 0, 0, errors);
    }

    const newGuids = new Set(newEntries.map((e) => e.sourceId));
    const newItems = allItems.filter((item) => newGuids.has(item.guid));

    this.log.info(
      `Delta: ${allItems.length} total, ${allItems.length - newItems.length} known, ${newItems.length} new`,
    );

    if (newItems.length === 0) {
      this.log.info('No new alert items. Done.');
      return this.buildReport(allItems.length, 0, 0, errors);
    }

    // Step 4: Relevance filtering
    const scoredItems = filterRelevant(newItems, this.minScore);
    this.log.info(
      `Relevance: ${newItems.length} new → ${scoredItems.length} relevant (minScore=${this.minScore})`,
    );

    for (const s of scoredItems) {
      this.log.debug(`  [${s.score}] ${s.item.title.substring(0, 80)}`, {
        signals: s.signals.join(', '),
      });
    }

    // Step 5: Extract leads
    const leads = extractLeads(scoredItems);

    // Step 6: Push to pipeline
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

    // Step 7: Mark ALL new guids as known (even irrelevant ones)
    if (!this.dryRun) {
      const markEntries: DeltaMarkEntry[] = newItems.map((item) => ({
        source: 'google_alert',
        sourceId: item.guid,
        city: item.cityName,
        name: item.title.substring(0, 100) || undefined,
      }));

      try {
        await markKnown(markEntries);
      } catch (err) {
        const msg = `markKnown error: ${err instanceof Error ? err.message : String(err)}`;
        this.log.error(msg);
        errors.push(msg);
      }
    }

    return this.buildReport(allItems.length, newItems.length, pushedCount, errors);
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

// --- CLI Entry Point ---

function parseArgs(): AlertsToolOptions {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const minScoreRaw = flagValue('--min-score');
  const minScore = minScoreRaw !== undefined ? parseInt(minScoreRaw, 10) : DEFAULT_MIN_SCORE;

  return {
    city: flagValue('--city') ?? 'all',
    dryRun: args.includes('--dry-run'),
    minScore: isNaN(minScore) ? DEFAULT_MIN_SCORE : minScore,
    verbose: args.includes('--verbose'),
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

  // BaseTool.execute() needs a CityConfig. For 'all', use a synthetic config.
  const cityConfig: CityConfig = options.city === 'all'
    ? { name: 'All Cities', slug: 'all', country: 'VN', boundary: [], resolution: 8, categories: [] }
    : getCityBySlug(options.city)!;

  const tool = new GoogleAlertsTool(options);
  const report = await tool.execute(cityConfig);

  console.log('\n--- Alerts Summary ---');
  console.log(`Status:         ${report.status}`);
  console.log(`Items fetched:  ${report.leadsFound}`);
  console.log(`New items:      ${report.leadsNew}`);
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
