/**
 * One-off script: Push known_places with raw_data that were never pushed to pipeline.
 * These are places collected during baseline runs that have details but were skipped.
 *
 * Usage: npx tsx src/cli/push-baseline-places.ts [--dry-run]
 */
import 'dotenv/config';
import { getSupabaseClient } from '../shared/supabase-client.js';
import { pushLead } from '../shared/pipeline-client.js';
import { mapCategory, mapCategoryFromPrimaryType } from '../google-maps/category-mapper.js';
import type { PipelineLeadInput } from '../shared/types.js';

const BATCH_SIZE = 50;

interface KnownPlaceRow {
  id: string;
  source_id: string;
  name: string | null;
  category: string | null;
  city: string | null;
  city_id: string;
  h3_cell: string | null;
  raw_data: Record<string, unknown>;
}

function transformKnownToLead(row: KnownPlaceRow): PipelineLeadInput {
  const raw = row.raw_data;

  // raw_data contains { tier, fetched_at, ...googlePlaceDetail }
  const displayName = raw.displayName as { text?: string } | undefined;
  const location = raw.location as { latitude?: number; longitude?: number } | undefined;
  const types = raw.types as string[] | undefined;
  const primaryType = raw.primaryType as string | undefined;

  return {
    source: 'google_maps',
    source_id: row.source_id,
    source_url: (raw.googleMapsUri as string) ?? null,
    name: displayName?.text ?? row.name ?? null,
    address: (raw.formattedAddress as string) ?? null,
    city: row.city ?? 'Hoi An',
    city_id: row.city_id,
    category_guess:
      mapCategoryFromPrimaryType(primaryType) ??
      mapCategory(types) ??
      (row.category as PipelineLeadInput['category_guess']) ??
      null,
    google_maps_url: (raw.googleMapsUri as string) ?? null,
    lat: location?.latitude ?? null,
    lng: location?.longitude ?? null,
    raw_data: {
      google_place_id: raw.id ?? row.source_id,
      google_types: types,
      google_primary_type: primaryType,
      google_business_status: raw.businessStatus,
      location,
      discovery: {
        method: 'baseline_backfill',
        h3_cell: row.h3_cell,
        pushed_at: new Date().toISOString(),
      },
    },
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = getSupabaseClient();

  // Fetch all unpushed known_places with raw_data
  const { data: rows, error } = await db
    .from('known_places')
    .select('id, source_id, name, category, city, city_id, h3_cell, raw_data')
    .eq('source', 'google_maps')
    .eq('pushed_to_pipeline', false)
    .not('raw_data', 'is', null)
    .returns<KnownPlaceRow[]>();

  if (error) {
    console.error('Failed to fetch known_places:', error.message);
    process.exit(1);
  }

  // Filter out permanently closed
  const open = rows.filter((r) => {
    const status = r.raw_data?.businessStatus as string | undefined;
    return status !== 'CLOSED_PERMANENTLY';
  });

  console.log(`Found ${rows.length} unpushed places with details (${rows.length - open.length} permanently closed, skipped)`);
  console.log(`Pushing ${open.length} places...${dryRun ? ' (DRY RUN)' : ''}`);

  let pushed = 0;
  let duplicates = 0;
  let failed = 0;

  for (let i = 0; i < open.length; i += BATCH_SIZE) {
    const batch = open.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (row) => {
        const lead = transformKnownToLead(row);
        const result = await pushLead(lead, { dryRun });

        if (result.success && result.duplicate) {
          return 'duplicate' as const;
        }
        if (result.success) {
          // Mark as pushed in known_places
          if (!dryRun && result.id) {
            await db
              .from('known_places')
              .update({ pushed_to_pipeline: true, pipeline_lead_id: result.id })
              .eq('id', row.id);
          }
          return 'pushed' as const;
        }
        console.error(`  Failed: ${row.name ?? row.source_id} — ${result.error}`);
        return 'failed' as const;
      }),
    );

    for (const r of results) {
      if (r === 'pushed') pushed++;
      else if (r === 'duplicate') duplicates++;
      else failed++;
    }

    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${results.length} processed`);
  }

  console.log('\n--- Push Summary ---');
  console.log(`Pushed:     ${pushed}`);
  console.log(`Duplicates: ${duplicates} (already in pipeline)`);
  console.log(`Failed:     ${failed}`);
  console.log(`Skipped:    ${rows.length - open.length} (closed)`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
