// ===========================================
// run-tool.ts — Universal Tool Runner via Slug
// ===========================================
//
// Usage:
//   npm run run-tool -- --slug google-maps --city hoi-an
//   npm run run-tool -- --slug google-alerts --city all --dry-run
//   npm run run-tool -- --slug osm-monitor

import 'dotenv/config';
import { getCityBySlug } from '../shared/city-config.js';
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
}

async function fetchRunConfig(slug: string): Promise<RunConfig> {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('tool_configs')
      .select('config')
      .eq('slug', slug)
      .single();

    if (error || !data) {
      console.warn(`[run-tool] Could not fetch run_config for "${slug}": ${error?.message || 'not found'}`);
      return {};
    }

    const config = data.config as Record<string, unknown>;
    return (config?.run_config as RunConfig) || {};
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

// --- Synthetic "all cities" config ---

const ALL_CITIES_CONFIG: CityConfig = {
  name: 'All Cities',
  slug: 'all',
  country: 'VN',
  boundary: [],
  resolution: 8,
  categories: [],
};

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

  // Fetch run_config from DB and merge with CLI args
  // Priority: explicit CLI flags (--dry-run, --baseline-only) > DB run_config > defaults
  // For city: if CLI passes "all" (entrypoint.sh default), DB config has priority
  const dbConfig = await fetchRunConfig(opts.slug);

  const effectiveCity = (opts.city === 'all' && dbConfig.city) ? dbConfig.city : opts.city;
  const effectiveDryRun = opts.dryRun || dbConfig.mode === 'dry_run';
  const effectiveBaselineOnly = opts.baselineOnly || dbConfig.mode === 'baseline_only';

  console.log(`[run-tool] DB run_config: ${JSON.stringify(dbConfig)}`);
  console.log(`[run-tool] Effective: city=${effectiveCity}, dryRun=${effectiveDryRun}, baselineOnly=${effectiveBaselineOnly}`);

  // Resolve city config
  let cityConfig: CityConfig;
  if (effectiveCity === 'all') {
    cityConfig = ALL_CITIES_CONFIG;
  } else {
    const city = getCityBySlug(effectiveCity);
    if (!city) {
      console.error(`Unknown city: "${effectiveCity}". Available: hoi-an, da-nang, all`);
      process.exit(1);
    }
    cityConfig = city;
  }

  // Load and create tool
  const modeLabel = effectiveDryRun ? ', DRY RUN' : effectiveBaselineOnly ? ', BASELINE ONLY' : '';
  console.log(`\n▶ Running tool: ${opts.slug} (city: ${effectiveCity}${modeLabel})`);

  const factory = await loadToolFactory(opts.slug);
  const tool = factory.createTool({
    city: effectiveCity,
    dryRun: effectiveDryRun,
    baselineOnly: effectiveBaselineOnly,
  });
  const report = await tool.execute(cityConfig);

  // Print summary
  console.log(`\n--- ${opts.slug} Summary ---`);
  console.log(`Status:       ${report.status}`);
  console.log(`Found:        ${report.leadsFound}`);
  console.log(`New:          ${report.leadsNew}`);
  console.log(`Pushed:       ${report.leadsPushed}`);
  console.log(`Duration:     ${(report.durationMs / 1000).toFixed(1)}s`);
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
