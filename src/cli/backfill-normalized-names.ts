/**
 * Backfill name_normalized for existing known_places entries.
 * Run once after deploying SQL migration 004_cross_source_dedup.
 *
 * Usage:
 *   npx tsx src/cli/backfill-normalized-names.ts [--dry-run]
 */
import 'dotenv/config';
import { getSupabaseClient } from '../shared/supabase-client.js';
import { normalizeName, findBestMatch, shouldReplaceCanonical } from '../shared/name-matcher.js';
import type { MatchCandidate } from '../shared/name-matcher.js';

const BATCH_SIZE = 200;
const PAGE_SIZE = 1000; // Supabase default limit
const dryRun = process.argv.includes('--dry-run');

interface BackfillRow { id: string; name: string }
interface CrossMatchRow { id: string; source: string; name: string; name_normalized: string | null; city_id: string; category: string | null; canonical_id: string | null }

async function fetchPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error('Query failed:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function backfillNormalized() {
  const db = getSupabaseClient();

  const entries = await fetchPaginated<BackfillRow>((from, to) =>
    db.from('known_places')
      .select('id, name')
      .not('name', 'is', null)
      .is('name_normalized', null)
      .range(from, to) as PromiseLike<{ data: BackfillRow[] | null; error: { message: string } | null }>,
  );

  if (entries.length === 0) {
    console.log('No entries to backfill.');
    return;
  }

  console.log(`Found ${entries.length} entries to normalize.`);

  let updated = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const updates = batch
      .map((e) => ({ id: e.id, name_normalized: normalizeName(e.name) }))
      .filter((u) => u.name_normalized); // skip empty normalization

    if (dryRun) {
      for (const u of updates.slice(0, 5)) {
        const orig = batch.find((e) => e.id === u.id);
        console.log(`  "${orig?.name}" → "${u.name_normalized}"`);
      }
      if (updates.length > 5) console.log(`  ... and ${updates.length - 5} more`);
      updated += updates.length;
      continue;
    }

    // Supabase doesn't support bulk update with different values per row,
    // so we use individual updates with capped concurrency
    const DB_CONCURRENCY = 10;
    const allResults: { error: unknown }[] = [];
    for (let j = 0; j < updates.length; j += DB_CONCURRENCY) {
      const chunk = updates.slice(j, j + DB_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map((u) => db.from('known_places').update({ name_normalized: u.name_normalized }).eq('id', u.id)),
      );
      allResults.push(...chunkResults);
    }
    const failed = allResults.filter((r) => r.error);
    if (failed.length > 0) {
      console.error(`${failed.length} updates failed in batch ${i / BATCH_SIZE}`);
    }
    updated += updates.length - failed.length;
  }

  console.log(`${dryRun ? '[DRY RUN] Would update' : 'Updated'} ${updated} entries.`);
}

async function crossMatchExisting() {
  const db = getSupabaseClient();

  const entries = await fetchPaginated<CrossMatchRow>((from, to) =>
    db.from('known_places')
      .select('id, source, name, name_normalized, city_id, category, canonical_id')
      .not('name_normalized', 'is', null)
      .is('canonical_id', null)
      .order('source', { ascending: true })
      .range(from, to) as PromiseLike<{ data: CrossMatchRow[] | null; error: { message: string } | null }>,
  );

  if (entries.length === 0) {
    console.log('No unmatched entries to cross-check.');
    return;
  }

  console.log(`\nCross-matching ${entries.length} unlinked entries...`);

  // Group by city_id + category
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.city_id}::${e.category ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  let matchCount = 0;

  for (const [groupKey, group] of groups) {
    // Build candidates from all entries in this group
    const candidates: MatchCandidate[] = group.map((e) => ({
      id: e.id,
      source: e.source,
      name: e.name,
      nameNormalized: e.name_normalized,
      canonicalId: e.canonical_id,
    }));

    // For each entry, find matches from OTHER sources
    for (const entry of group) {
      if (entry.canonical_id) continue; // already linked

      const otherCandidates = candidates.filter(
        (c) => c.source !== entry.source && c.id !== entry.id && !c.canonicalId,
      );

      const match = findBestMatch(entry.name, otherCandidates);
      if (!match) continue;

      // Determine canonical direction
      const entryIsCanonical = shouldReplaceCanonical(entry.source, match.candidateSource);
      const canonicalId = entryIsCanonical ? entry.id : match.candidateId;
      const linkedId = entryIsCanonical ? match.candidateId : entry.id;

      console.log(
        `  Match: ${entry.source} "${entry.name}" ↔ ${match.candidateSource} "${match.candidateName}" (${match.score.toFixed(3)}) → canonical: ${canonicalId === entry.id ? entry.source : match.candidateSource}`,
      );

      if (!dryRun) {
        await db.from('known_places').update({ canonical_id: canonicalId }).eq('id', linkedId);
      }

      // Update candidate in-memory so we don't re-match it
      const matched = candidates.find((c) => c.id === linkedId);
      if (matched) matched.canonicalId = canonicalId;

      matchCount++;
    }
  }

  console.log(`${dryRun ? '[DRY RUN] Would create' : 'Created'} ${matchCount} cross-source links.`);
}

async function main() {
  if (dryRun) console.log('=== DRY RUN MODE ===\n');

  console.log('Step 1: Backfill name_normalized...');
  await backfillNormalized();

  console.log('\nStep 2: Cross-match existing entries...');
  await crossMatchExisting();

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
