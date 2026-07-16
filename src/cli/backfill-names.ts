/**
 * Backfill name/location/category for known_places entries that were stored
 * without details (baseline/queued Google Maps IDs — name_normalized IS NULL).
 * Uses the Pro tier only (name/category/location, no rating-count) so it never
 * competes with the Enterprise budget that regular scans rely on.
 *
 * These entries are UPDATE-only — never pushed to the pipeline as leads.
 *
 * Usage:
 *   npx tsx src/cli/backfill-names.ts [--dry-run]
 */
import 'dotenv/config';
import { getSupabaseClient } from '../shared/supabase-client.js';
import { normalizeName } from '../shared/name-matcher.js';
import { getPlaceDetailsPro } from '../google-maps/places-client.js';
import { mapCategory, mapCategoryFromPrimaryType } from '../google-maps/category-mapper.js';
import { canMakeCall, incrementBudget, getBudgetStatus } from '../shared/budget-tracker.js';
import { sleep } from '../shared/utils.js';

const TOOL_SLUG = 'google-maps';
const SKU = 'place_details_pro' as const;
const PAGE_SIZE = 1000;
const BATCH_SIZE = 50;
const DELAY_MS = 100;

const dryRun = process.argv.includes('--dry-run');

interface Row {
  id: string;
  source_id: string;
}

interface UpdatePayload {
  name: string | null;
  name_normalized: string | null;
  lat: number | null;
  lng: number | null;
  category?: string;
  raw_data: Record<string, unknown>;
}

async function fetchMissingNameRows(): Promise<Row[]> {
  const db = getSupabaseClient();
  const all: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from('known_places')
      .select('id, source_id')
      .eq('source', 'google_maps')
      .is('name_normalized', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Query failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function main() {
  const rows = await fetchMissingNameRows();
  console.log(`Found ${rows.length} known_places (source=google_maps) without a name.`);

  if (rows.length === 0) return;

  const status = await getBudgetStatus(TOOL_SLUG, SKU);
  console.log(`Pro-tier budget this month: ${status.callsUsed}/${status.callsSafety} used, ${status.remaining} remaining.`);

  if (dryRun) {
    const willFetch = Math.min(rows.length, status.remaining);
    const queued = rows.length - willFetch;
    console.log(`[DRY RUN] Would fetch ${willFetch} now (within free Pro cap), ${queued} would be queued for next month.`);
    console.log(`[DRY RUN] Estimated cost: $0 (Pro tier free cap is ${status.callsSafety}/month, all calls stay under it here).`);
    return;
  }

  let fetched = 0;
  let failed = 0;
  let updated = 0;
  let budgetExhausted = false;
  const buffer: { id: string; payload: UpdatePayload }[] = [];
  const db = getSupabaseClient();

  async function flush() {
    if (buffer.length === 0) return;
    const CONCURRENCY = 10;
    for (let i = 0; i < buffer.length; i += CONCURRENCY) {
      const chunk = buffer.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(({ id, payload }) => db.from('known_places').update(payload).eq('id', id)),
      );
      updated += results.filter((r) => !r.error).length;
      const errs = results.filter((r) => r.error);
      if (errs.length > 0) {
        console.error(`  ${errs.length} DB updates failed in this batch`);
      }
    }
    buffer.length = 0;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const canCall = await canMakeCall(TOOL_SLUG, SKU);
    if (!canCall) {
      budgetExhausted = true;
      break;
    }

    try {
      const detail = await getPlaceDetailsPro(row.source_id);
      await incrementBudget(TOOL_SLUG, SKU);
      fetched++;

      const name = detail.displayName?.text ?? null;
      const category = mapCategoryFromPrimaryType(detail.primaryType) ?? mapCategory(detail.types) ?? undefined;

      buffer.push({
        id: row.id,
        payload: {
          name,
          name_normalized: name ? normalizeName(name) || null : null,
          lat: detail.location?.latitude ?? null,
          lng: detail.location?.longitude ?? null,
          category,
          raw_data: {
            tier: SKU,
            fetched_at: new Date().toISOString(),
            ...detail,
          },
        },
      });
    } catch (err) {
      failed++;
      console.error(`  Failed for ${row.source_id}: ${err instanceof Error ? err.message : err}`);
    }

    if (buffer.length >= BATCH_SIZE) {
      await flush();
      console.log(`  Progress: ${i + 1}/${rows.length} processed (${fetched} fetched, ${failed} failed, ${updated} updated)`);
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  await flush();

  console.log('\n--- Backfill Summary ---');
  console.log(`Fetched:  ${fetched}`);
  console.log(`Updated:  ${updated}`);
  console.log(`Failed:   ${failed}`);
  if (budgetExhausted) {
    const remaining = rows.length - fetched - failed;
    console.log(`Budget exhausted — ${remaining} entries left for next month. Just re-run this script then.`);
  } else {
    console.log('Done — all entries processed.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
