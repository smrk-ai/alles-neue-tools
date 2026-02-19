// ===========================================
// run-all.ts — Batch Runner for All Active Tools
// ===========================================
//
// Usage:
//   npm run run-all                          # All active tools
//   npm run run-all -- --city hoi-an         # All active, single city
//   npm run run-all -- --only google-maps,osm-monitor
//   npm run run-all -- --skip changedetection
//   npm run run-all -- --dry-run

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { config } from '../shared/config.js';
import { getCityBySlug } from '../shared/city-config.js';
import { createLogger } from '../shared/logger.js';
import type { CityConfig, ToolRunReport } from '../shared/types.js';
import type { BaseTool } from '../shared/tool-runner.js';

const log = createLogger('run-all');

// --- Tool Registry (same as run-tool.ts) ---

const TOOL_SLUGS = [
  'google-maps', 'facebook-scout', 'instagram-scout',
  'google-alerts', 'sitemap-miner', 'osm-monitor', 'changedetection',
];

interface ToolFactory {
  createTool: (options: { city: string; dryRun?: boolean }) => BaseTool;
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
      throw new Error(`Unknown tool slug: "${slug}"`);
  }
}

// --- Synthetic "all cities" config ---

const ALL_CITIES_CONFIG: CityConfig = {
  name: 'All Cities',
  slug: 'all',
  country: 'VN',
  boundary: [],
  resolution: 8,
  categories: [],
};

// --- Fetch active tools from DB ---

interface ToolConfigRow {
  slug: string;
  name: string;
  is_active: boolean;
  config: Record<string, unknown>;
}

async function getActiveTools(): Promise<ToolConfigRow[]> {
  const db = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  const { data, error } = await db
    .from('tool_configs')
    .select('slug, name, is_active, config')
    .eq('is_active', true)
    .order('name');

  if (error) {
    log.error('Failed to fetch tool_configs', { error: error.message });
    return [];
  }

  // Only return tools that have a createTool factory (exclude CLI-only tools)
  return (data || []).filter((t) => TOOL_SLUGS.includes(t.slug));
}

// --- CLI ---

function parseArgs() {
  const args = process.argv.slice(2);

  const flagValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    city: flagValue('--city') ?? 'all',
    only: flagValue('--only')?.split(','),
    skip: flagValue('--skip')?.split(','),
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
  };
}

async function main() {
  const opts = parseArgs();

  if (opts.verbose) {
    process.env.TOOL_ENV = 'development';
  }

  // Resolve city config
  let cityConfig: CityConfig;
  if (opts.city === 'all') {
    cityConfig = ALL_CITIES_CONFIG;
  } else {
    const city = getCityBySlug(opts.city);
    if (!city) {
      console.error(`Unknown city: "${opts.city}". Available: hoi-an, da-nang, all`);
      process.exit(1);
    }
    cityConfig = city;
  }

  // Get active tools from DB
  let tools = await getActiveTools();

  if (tools.length === 0) {
    log.warn('No active tools found in tool_configs. Nothing to run.');
    process.exit(0);
  }

  // Apply --only / --skip filters
  if (opts.only) {
    tools = tools.filter((t) => opts.only!.includes(t.slug));
  }
  if (opts.skip) {
    tools = tools.filter((t) => !opts.skip!.includes(t.slug));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  RUN ALL — ${tools.length} tools, city: ${opts.city}${opts.dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  Tools: ${tools.map((t) => t.slug).join(', ')}`);
  console.log(`${'='.repeat(50)}\n`);

  // Run tools sequentially
  const reports: Array<{ slug: string; report: ToolRunReport }> = [];
  const startedAll = Date.now();

  for (const toolConfig of tools) {
    console.log(`\n▶ [${reports.length + 1}/${tools.length}] ${toolConfig.name} (${toolConfig.slug})`);
    console.log('-'.repeat(40));

    try {
      const factory = await loadToolFactory(toolConfig.slug);
      const tool = factory.createTool({ city: opts.city, dryRun: opts.dryRun });
      const report = await tool.execute(cityConfig);
      reports.push({ slug: toolConfig.slug, report });

      console.log(`  ✓ ${report.status} — found: ${report.leadsFound}, new: ${report.leadsNew}, pushed: ${report.leadsPushed} (${(report.durationMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FATAL: ${msg}`);
      reports.push({
        slug: toolConfig.slug,
        report: {
          toolSlug: toolConfig.slug,
          city: opts.city,
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
          leadsFound: 0,
          leadsNew: 0,
          leadsPushed: 0,
          errors: [msg],
          status: 'failed',
        },
      });
    }
  }

  // Aggregated summary
  const totalDuration = Date.now() - startedAll;
  const totalFound = reports.reduce((sum, r) => sum + r.report.leadsFound, 0);
  const totalNew = reports.reduce((sum, r) => sum + r.report.leadsNew, 0);
  const totalPushed = reports.reduce((sum, r) => sum + r.report.leadsPushed, 0);
  const totalErrors = reports.reduce((sum, r) => sum + r.report.errors.length, 0);
  const failed = reports.filter((r) => r.report.status === 'failed');

  console.log(`\n${'='.repeat(50)}`);
  console.log('  AGGREGATED SUMMARY');
  console.log(`${'='.repeat(50)}`);
  console.log(`  Tools run:     ${reports.length}`);
  console.log(`  Total found:   ${totalFound}`);
  console.log(`  Total new:     ${totalNew}`);
  console.log(`  Total pushed:  ${totalPushed}`);
  console.log(`  Total errors:  ${totalErrors}`);
  console.log(`  Failed tools:  ${failed.length > 0 ? failed.map((f) => f.slug).join(', ') : 'none'}`);
  console.log(`  Duration:      ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`${'='.repeat(50)}\n`);

  // Per-tool breakdown
  for (const { slug, report } of reports) {
    const icon = report.status === 'success' ? '✓' : report.status === 'partial' ? '~' : '✗';
    console.log(`  ${icon} ${slug.padEnd(20)} ${String(report.leadsNew).padStart(4)} new  ${String(report.leadsPushed).padStart(4)} pushed  ${report.errors.length > 0 ? `(${report.errors.length} errors)` : ''}`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
