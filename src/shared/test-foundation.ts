import { config } from './config.js';
import { createLogger } from './logger.js';
import { pushLead } from './pipeline-client.js';
import { loadCities, getCityBySlug } from './city-config.js';
import { getAllScanCells, getCellCenter } from './h3-grid.js';
import { findNew, markKnown, getStats } from './delta-store.js';

const log = createLogger('test');

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` – ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  console.log('\n🔧 Phase 0 Foundation Test\n');

  // Load cities from Supabase before any city-dependent tests
  await loadCities();

  // --- 1. Config ---
  console.log('1. Config');
  check('PIPELINE_API_URL loaded', !!config.pipeline.apiUrl);
  check('PIPELINE_API_KEY loaded', !!config.pipeline.apiKey);
  check('TOOL_RUNS_API_URL loaded', !!config.toolRuns.apiUrl);
  check('TOOL_API_KEY loaded', !!config.toolRuns.apiKey);
  check('SUPABASE_URL loaded', !!config.supabase.url);
  check('SUPABASE_SERVICE_ROLE_KEY loaded', !!config.supabase.serviceRoleKey);
  check('TOOL_ENV is development', config.env === 'development');

  // --- 2. H3 Grid ---
  console.log('\n2. H3 Grid');
  const hoiAn = getCityBySlug('hoi-an')!;
  const hoiAnCells = getAllScanCells(hoiAn);
  check(`Hoi An scan cells: ${hoiAnCells.length}`, hoiAnCells.length >= 20 && hoiAnCells.length <= 60);

  const daNang = getCityBySlug('da-nang')!;
  const daNangCells = getAllScanCells(daNang);
  check(`Da Nang scan cells: ${daNangCells.length}`, daNangCells.length >= 80 && daNangCells.length <= 200);

  const center = getCellCenter(hoiAnCells[0]);
  check(`Cell center valid: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`,
    center.lat > 15 && center.lat < 16 && center.lng > 108 && center.lng < 109);

  // --- 3. Logger ---
  console.log('\n3. Logger');
  log.info('Test info message');
  log.warn('Test warn message', { key: 'value' });
  log.debug('Test debug message (should appear in dev)');
  check('Logger output works', true);

  // --- 4. Pipeline Client (dry run) ---
  console.log('\n4. Pipeline Client (dry run)');
  const result = await pushLead({
    source: 'manual',
    name: 'Test Foundation Lead',
    city: 'Hoi An',
    description: 'Automated test – should not appear in production',
  }, { dryRun: true });
  check('Dry run succeeded', result.success);
  check('Dry run returned id', result.id === 'dry-run');

  // --- 5. Delta Store ---
  console.log('\n5. Delta Store');
  try {
    const testEntries = [
      { source: 'test', sourceId: 'test-foundation-001' },
      { source: 'test', sourceId: 'test-foundation-002' },
    ];

    // Should be new (not yet known)
    const newEntries = await findNew(testEntries);
    check(`findNew returned ${newEntries.length} entries`, newEntries.length === 2);

    // Mark as known
    await markKnown([
      { source: 'test', sourceId: 'test-foundation-001', city: 'Hoi An', cityId: '42990773-34b1-486f-8824-c0e61039fd6c', name: 'Test Place 1', category: 'restaurants' },
      { source: 'test', sourceId: 'test-foundation-002', city: 'Hoi An', cityId: '42990773-34b1-486f-8824-c0e61039fd6c', name: 'Test Place 2', category: 'restaurants' },
    ]);
    check('markKnown succeeded', true);

    // Should now be known
    const afterMark = await findNew(testEntries);
    check(`After markKnown, findNew returns ${afterMark.length} (expected 0)`, afterMark.length === 0);

    // Stats
    const stats = await getStats('Hoi An');
    check(`Stats for Hoi An: ${stats.total} total, ${JSON.stringify(stats.bySource)}`, stats.total >= 2);

    // Cleanup test entries
    const { getSupabaseClient } = await import('./supabase-client.js');
    const db = getSupabaseClient();
    await db.from('known_places').delete().eq('source', 'test');
    check('Test entries cleaned up', true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check('Delta Store', false, msg);
    console.log('  ⚠️  Make sure known_places table exists in Supabase (run sql/001_known_places.sql)');
  }

  // --- 6. Tool Runner (structure check) ---
  console.log('\n6. Tool Runner');
  const { BaseTool } = await import('./tool-runner.js');
  check('BaseTool class importable', typeof BaseTool === 'function');

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
