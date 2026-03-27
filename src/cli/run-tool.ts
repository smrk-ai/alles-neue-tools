// ===========================================
// run-tool.ts — Universal Tool Runner via Slug
// ===========================================
//
// Usage:
//   npm run run-tool -- --slug google-maps --city hoi-an
//   npm run run-tool -- --slug google-alerts --city all --dry-run
//   npm run run-tool -- --slug osm-monitor

import 'dotenv/config';
import { getCityBySlug, getAllCities, loadCities } from '../shared/city-config.js';
import { getSupabaseClient } from '../shared/supabase-client.js';
import type { CityConfig, ToolRunReport } from '../shared/types.js';
import { BaseTool } from '../shared/tool-runner.js';

// --- Tool Registry ---

interface ToolFactory {
  createTool: (options: { city: string; dryRun?: boolean; baselineOnly?: boolean }) => BaseTool;
}

// --- DB Run Config ---

interface RunConfig {
  city?: string;
  mode?: string; // 'normal' | 'dry_run' | 'baseline_only'
  isActive?: boolean;
}

async function fetchRunConfig(slug: string): Promise<RunConfig> {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('tool_configs')
      .select('config, is_active')
      .eq('slug', slug)
      .single();

    if (error || !data) {
      console.warn(`[run-tool] Could not fetch run_config for "${slug}": ${error?.message || 'not found'}`);
      return {};
    }

    const config = data.config as Record<string, unknown>;
    const runConfig = (config?.run_config as RunConfig) || {};
    return { ...runConfig, isActive: data.is_active };
  } catch (err) {
    console.warn(`[run-tool] Failed to fetch run_config:`, err);
    return {};
  }
}

async function loadToolFactory(slug: string): Promise<ToolFactory> {
  switch (slug) {
    case 'google-maps':
      return await import('../google-maps/index.js');
    case 'facebook-scout':
      return await import('../facebook-scout/index.js');
    case 'instagram-scout':
      return await import('../instagram-scout/index.js');
    case 'google-alerts':
      return await import('../google-alerts/index.js');
    case 'sitemap-miner':
      return await import('../sitemap-miner/index.js');
    case 'osm-monitor':
      return await import('../osm-monitor/index.js');
    case 'changedetection':
      return await import('../changedetection/index.js');
    default:
      throw new Error(`Unknown tool slug: "${slug}". Available: google-maps, facebook-scout, instagram-scout, google-alerts, sitemap-miner, osm-monitor, changedetection`);
  }
}

const AVAILABLE_SLUGS = [
  'google-maps', 'facebook-scout', 'instagram-scout',
  'google-alerts', 'sitemap-miner', 'osm-monitor', 'changedetection',
];

// --- CLI ---

function parseArgs() {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    slug: flagValue('--slug'),
    city: flagValue('--city') ?? 'all',
    dryRun: args.includes('--dry-run'),
    baselineOnly: args.includes('--baseline-only'),
    verbose: args.includes('--verbose'),
  };
}

async function main() {
  const opts = parseArgs();

  if (!opts.slug) {
    console.error('Usage: npm run run-tool -- --slug <tool-slug> [--city <city>] [--dry-run] [--baseline-only]');
    console.error(`Available tools: ${AVAILABLE_SLUGS.join(', ')}`);
    process.exit(1);
  }

  if (opts.verbose) {
    process.env.TOOL_ENV = 'development';
  }

  // Load cities from Supabase before resolving city slugs
  await loadCities();

  // Per-city configs use suffixed slugs (e.g. "google-maps-hoi-an"); "all" uses the base slug
  const configSlug = opts.city !== 'all' ? `${opts.slug}-${opts.city}` : opts.slug;
  const dbConfig = await fetchRunConfig(configSlug);

  if (dbConfig.isActive === false) {
    console.log(`[run-tool] Tool "${opts.slug}" is deactivated (is_active=false). Exiting.`);
    process.exit(0);
  }

  const effectiveCity = (opts.city === 'all' && dbConfig.city) ? dbConfig.city : opts.city;
  const effectiveDryRun = opts.dryRun || dbConfig.mode === 'dry_run';
  const effectiveBaselineOnly = opts.baselineOnly || dbConfig.mode === 'baseline_only';

  console.log(`[run-tool] DB run_config: ${JSON.stringify(dbConfig)}`);
  console.log(`[run-tool] Effective: city=${effectiveCity}, dryRun=${effectiveDryRun}, baselineOnly=${effectiveBaselineOnly}`);

  // Resolve cities to run
  const modeLabel = effectiveDryRun ? ', DRY RUN' : effectiveBaselineOnly ? ', BASELINE ONLY' : '';
  const factory = await loadToolFactory(opts.slug);

  let cities: CityConfig[];
  if (effectiveCity === 'all') {
    cities = getAllCities();
    console.log(`\n▶ Running tool: ${opts.slug} (all cities: ${cities.map((c) => c.slug).join(', ')}${modeLabel})`);
  } else {
    const city = getCityBySlug(effectiveCity);
    if (!city) {
      console.error(`Unknown city: "${effectiveCity}". Available: ${getAllCities().map((c) => c.slug).join(', ')}, all`);
      process.exit(1);
    }
    cities = [city];
    console.log(`\n▶ Running tool: ${opts.slug} (city: ${effectiveCity}${modeLabel})`);
  }

  // Run tool for each city and aggregate reports
  const reports: ToolRunReport[] = [];
  for (const cityConfig of cities) {
    console.log(`\n  → ${cityConfig.name}`);
    const tool = factory.createTool({
      city: cityConfig.slug,
      dryRun: effectiveDryRun,
      baselineOnly: effectiveBaselineOnly,
    });
    const report = await tool.execute(cityConfig);
    reports.push(report);
  }

  // Aggregate
  const aggregated: ToolRunReport = {
    toolSlug: opts.slug,
    city: effectiveCity,
    startedAt: reports[0]?.startedAt ?? new Date(),
    finishedAt: reports[reports.length - 1]?.finishedAt ?? new Date(),
    durationMs: reports.reduce((sum, r) => sum + r.durationMs, 0),
    leadsFound: reports.reduce((sum, r) => sum + r.leadsFound, 0),
    leadsNew: reports.reduce((sum, r) => sum + r.leadsNew, 0),
    leadsPushed: reports.reduce((sum, r) => sum + r.leadsPushed, 0),
    errors: reports.flatMap((r) => r.errors),
    status: reports.every((r) => r.status === 'failed') ? 'failed'
      : reports.some((r) => r.status === 'failed') ? 'partial'
      : 'success',
  };

  // Print summary
  console.log(`\n--- ${opts.slug} Summary ---`);
  console.log(`Status:       ${aggregated.status}`);
  console.log(`Found:        ${aggregated.leadsFound}`);
  console.log(`New:          ${aggregated.leadsNew}`);
  console.log(`Pushed:       ${aggregated.leadsPushed}`);
  console.log(`Duration:     ${(aggregated.durationMs / 1000).toFixed(1)}s`);
  if (aggregated.errors.length > 0) {
    console.log(`Errors (${aggregated.errors.length}):`);
    for (const e of aggregated.errors) console.log(`  - ${e}`);
  }

  process.exit(aggregated.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
