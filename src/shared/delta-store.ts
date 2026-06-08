import { getSupabaseClient } from './supabase-client.js';
import { createLogger } from './logger.js';
import { normalizeName, findBestMatch, shouldReplaceCanonical } from './name-matcher.js';
import type { MatchCandidate } from './name-matcher.js';
import type { DeltaEntry, DeltaMarkEntry, DeltaStats, CrossMatchResult } from './types.js';

const log = createLogger('delta-store');

const BATCH_SIZE = 100;

/**
 * Find which entries are NEW (not yet in known_places).
 * Returns only the entries that are not yet known.
 */
export async function findNew(entries: DeltaEntry[]): Promise<DeltaEntry[]> {
  if (entries.length === 0) return [];

  const db = getSupabaseClient();
  const knownSet = new Set<string>();

  // Group by source for precise queries (avoids cross-source collisions)
  const bySource = new Map<string, DeltaEntry[]>();
  for (const e of entries) {
    const list = bySource.get(e.source) || [];
    list.push(e);
    bySource.set(e.source, list);
  }

  for (const [source, sourceEntries] of bySource) {
    for (let i = 0; i < sourceEntries.length; i += BATCH_SIZE) {
      const batch = sourceEntries.slice(i, i + BATCH_SIZE);
      const sourceIds = batch.map((e) => e.sourceId);

      // A place counts as "known" once it exists in known_places — regardless of
      // raw_data. (An earlier attempt to treat raw_data IS NULL as "re-fetch" was
      // reverted: it also caught the ~4200 baseline-bestand entries, which are
      // deliberately stored without details and must NOT be re-pushed.)
      const { data, error } = await db
        .from('known_places')
        .select('source, source_id')
        .eq('source', source)
        .in('source_id', sourceIds);

      if (error) {
        log.error(`findNew query failed`, { error: error.message, source, batch: i });
        throw error;
      }

      if (data) {
        for (const row of data) {
          knownSet.add(`${row.source}::${row.source_id}`);
        }
      }
    }
  }

  return entries.filter((e) => !knownSet.has(`${e.source}::${e.sourceId}`));
}

/**
 * Mark entries as known. UPSERT – updates last_seen on conflict.
 */
export async function markKnown(entries: DeltaMarkEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const db = getSupabaseClient();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    // Omit city field entirely if undefined/null so the DB default ('Hoi An') kicks in.
    // Passing null explicitly violates the NOT NULL constraint.
    const rows = batch.map(buildKnownPlaceRow);

    const { error } = await db
      .from('known_places')
      .upsert(rows, { onConflict: 'city_id,source,source_id' });

    if (error) {
      log.error(`markKnown upsert failed`, { error: error.message, batch: i });
      throw error;
    }
  }

  log.info(`Marked ${entries.length} places as known`);
}

/**
 * Mark a known place as pushed to pipeline.
 */
export async function markPushed(
  source: string,
  sourceId: string,
  pipelineLeadId: string,
  cityId?: string
): Promise<void> {
  const db = getSupabaseClient();

  let query = db
    .from('known_places')
    .update({
      pushed_to_pipeline: true,
      pipeline_lead_id: pipelineLeadId,
    })
    .eq('source', source)
    .eq('source_id', sourceId);

  if (cityId) query = query.eq('city_id', cityId);

  const { error } = await query;

  if (error) {
    log.error(`markPushed failed`, { error: error.message, source, sourceId });
    throw error;
  }
}

/**
 * Bulk-update category for existing known_places entries.
 * Only sets category — does not touch name, last_seen, or other fields.
 */
export async function updateCategoryBulk(
  source: string,
  sourceIds: string[],
  category: string,
  cityId: string,
): Promise<number> {
  if (sourceIds.length === 0) return 0;

  const db = getSupabaseClient();
  let updated = 0;

  for (let i = 0; i < sourceIds.length; i += BATCH_SIZE) {
    const batch = sourceIds.slice(i, i + BATCH_SIZE);

    const { count, error } = await db
      .from('known_places')
      .update({ category }, { count: 'exact' })
      .eq('source', source)
      .eq('city_id', cityId)
      .in('source_id', batch)
      .neq('category', category);

    if (error) {
      log.error(`updateCategoryBulk failed`, { error: error.message, batch: i });
      throw error;
    }

    updated += count ?? 0;
  }

  if (updated > 0) {
    log.info(`Updated category to '${category}' for ${updated} entries`);
  }

  return updated;
}

// --- Cross-Source Matching (P3) ---

function buildKnownPlaceRow(e: DeltaMarkEntry): Record<string, unknown> {
  const row: Record<string, unknown> = {
    source: e.source,
    source_id: e.sourceId,
    city_id: e.cityId,
    h3_cell: e.h3Cell || null,
    name: e.name || null,
    name_normalized: e.name ? normalizeName(e.name) || null : null,
    last_seen: new Date().toISOString(),
  };
  if (e.city) row.city = e.city;
  if (e.category) row.category = e.category;
  if (e.subType) row.sub_type = e.subType;
  if (e.rawData) row.raw_data = e.rawData;
  return row;
}

/**
 * Load cross-source match candidates from known_places.
 * Returns entries from OTHER sources in the same city+category.
 */
async function getCandidates(
  cityId: string,
  category: string | undefined,
  excludeSource: string,
): Promise<MatchCandidate[]> {
  const db = getSupabaseClient();

  let query = db
    .from('known_places')
    .select('id, source, name, name_normalized, canonical_id')
    .eq('city_id', cityId)
    .neq('source', excludeSource)
    .not('name_normalized', 'is', null);

  if (category) query = query.eq('category', category);

  const { data, error } = await query;

  if (error) {
    log.error(`getCandidates failed`, { error: error.message, cityId, category, excludeSource });
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    source: row.source,
    name: row.name ?? '',
    nameNormalized: row.name_normalized,
    canonicalId: row.canonical_id,
  }));
}

/**
 * Load same-source match candidates from known_places.
 * Used to detect duplicate Place IDs that map to the same physical location.
 */
async function getIntraSourceCandidates(
  cityId: string,
  source: string,
  category: string | undefined,
): Promise<MatchCandidate[]> {
  const db = getSupabaseClient();

  let query = db
    .from('known_places')
    .select('id, source, source_id, name, name_normalized, canonical_id')
    .eq('city_id', cityId)
    .eq('source', source)
    .not('name_normalized', 'is', null);

  if (category) query = query.eq('category', category);

  const { data, error } = await query;

  if (error) {
    log.error(`getIntraSourceCandidates failed`, { error: error.message, cityId, source, category });
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.source_id, // use source_id so we can filter out self
    source: row.source,
    name: row.name ?? '',
    nameNormalized: row.name_normalized,
    canonicalId: row.canonical_id ?? row.id, // fall back to DB id as canonical
  }));
}

function buildCacheKey(entry: { cityId: string; category?: string; source: string }): string {
  return `${entry.cityId}::${entry.category ?? ''}::${entry.source}`;
}

/**
 * Run name matching against a candidate cache.
 * Returns matched entries (with canonical linkage) and unmatched entries.
 */
function runMatchingPass(
  entries: DeltaMarkEntry[],
  candidateCache: Map<string, MatchCandidate[]>,
  filterSelf: boolean,
): { matched: CrossMatchResult[]; unmatched: DeltaMarkEntry[] } {
  const matched: CrossMatchResult[] = [];
  const unmatched: DeltaMarkEntry[] = [];

  for (const entry of entries) {
    let candidates = candidateCache.get(buildCacheKey(entry)) ?? [];
    if (filterSelf) candidates = candidates.filter((c) => c.id !== entry.sourceId);

    const match = findBestMatch(entry.name!, candidates);
    if (match) {
      matched.push({
        entry,
        matchedWith: {
          id: match.candidateId,
          canonicalId: match.canonicalId,
          name: match.candidateName,
          source: match.candidateSource,
          score: match.score,
        },
      });
    } else {
      unmatched.push(entry);
    }
  }

  return { matched, unmatched };
}

/**
 * Find truly new entries by combining intra-source delta + cross-source name matching.
 * Returns entries split into "truly new" (push to pipeline) and "cross-matched" (link only).
 */
export async function findNewWithCrossCheck(
  entries: DeltaMarkEntry[],
): Promise<{ trulyNew: DeltaMarkEntry[]; crossMatched: CrossMatchResult[] }> {
  // Step 1: Intra-source ID dedup
  const newIntraSource = await findNew(entries);

  // Map back to DeltaMarkEntry (findNew returns DeltaEntry, we need the full info)
  const newSourceIds = new Set(newIntraSource.map((e) => `${e.source}::${e.sourceId}`));
  const newEntries = entries.filter((e) => newSourceIds.has(`${e.source}::${e.sourceId}`));

  const withName = newEntries.filter((e) => e.name);
  const withoutName = newEntries.filter((e) => !e.name);

  if (withName.length === 0) {
    return { trulyNew: newEntries, crossMatched: [] };
  }

  const uniqueKeys = new Map<string, { cityId: string; category: string | undefined; source: string }>();
  for (const entry of withName) {
    const key = buildCacheKey(entry);
    if (!uniqueKeys.has(key)) uniqueKeys.set(key, { cityId: entry.cityId, category: entry.category, source: entry.source });
  }

  // Step 1b: Intra-source name dedup (Google Maps assigns multiple IDs to the same physical place)
  const intraCandidateCache = new Map<string, MatchCandidate[]>();
  await Promise.all(
    [...uniqueKeys.entries()].map(([key, { cityId, category, source }]) =>
      getIntraSourceCandidates(cityId, source, category).then((c) => intraCandidateCache.set(key, c)),
    ),
  );

  const { matched: intraMatched, unmatched: afterIntraDedup } = runMatchingPass(withName, intraCandidateCache, true);

  // Step 2: Cross-source name matching (only if entries survived intra-source dedup)
  let crossMatched: CrossMatchResult[] = [];
  const trulyNew: DeltaMarkEntry[] = [...withoutName];

  if (afterIntraDedup.length > 0) {
    const crossCandidateCache = new Map<string, MatchCandidate[]>();
    await Promise.all(
      [...uniqueKeys.entries()].map(([key, { cityId, category, source }]) =>
        getCandidates(cityId, category, source).then((c) => crossCandidateCache.set(key, c)),
      ),
    );

    const crossResult = runMatchingPass(afterIntraDedup, crossCandidateCache, false);
    crossMatched = crossResult.matched;
    trulyNew.push(...crossResult.unmatched);
  } else {
    trulyNew.push(...afterIntraDedup);
  }

  const allMatched = [...intraMatched, ...crossMatched];

  if (allMatched.length > 0) {
    log.info(`Dedup: ${intraMatched.length} intra-source, ${crossMatched.length} cross-source matches. ${trulyNew.length} truly new.`);
    for (const m of allMatched) {
      log.info(
        `  ↳ ${m.entry.source} "${m.entry.name}" = ${m.matchedWith.source} "${m.matchedWith.name}" (score: ${m.matchedWith.score.toFixed(3)})`,
      );
    }
  }

  return { trulyNew, crossMatched: allMatched };
}

/**
 * Mark cross-matched entries as known with canonical_id linkage.
 * Does NOT set pushed_to_pipeline (these are duplicates, not new leads).
 */
export async function markCrossMatched(
  results: CrossMatchResult[],
): Promise<void> {
  if (results.length === 0) return;

  const db = getSupabaseClient();
  const CONCURRENCY = 10;

  for (let i = 0; i < results.length; i += CONCURRENCY) {
    const chunk = results.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async ({ entry, matchedWith }) => {
      const newEntryIsCanonical = shouldReplaceCanonical(entry.source, matchedWith.source);

      const row: Record<string, unknown> = {
        ...buildKnownPlaceRow(entry),
        pushed_to_pipeline: false,
      };
      if (!newEntryIsCanonical) {
        row.canonical_id = matchedWith.canonicalId;
      }

      const { data, error } = await db
        .from('known_places')
        .upsert(row, { onConflict: 'city_id,source,source_id' })
        .select('id')
        .single();

      if (error) {
        log.error(`markCrossMatched upsert failed`, { error: error.message, entry: entry.sourceId });
        return;
      }

      if (newEntryIsCanonical && data.id) {
        const { error: swapError } = await db
          .from('known_places')
          .update({ canonical_id: data.id })
          .eq('id', matchedWith.id);

        if (swapError) {
          log.error(`canonical swap failed`, { error: swapError.message });
        } else {
          log.info(`  ↳ Canonical swap: ${entry.source} is now canonical for ${matchedWith.source}`);
        }
      }
    }));
  }

  log.info(`Marked ${results.length} cross-source matches`);
}

/**
 * Get statistics for a city (server-side aggregation via RPC).
 */
export async function getStats(city: string, category?: string): Promise<DeltaStats> {
  const db = getSupabaseClient();

  const { data, error } = await db.rpc('get_known_places_stats', {
    p_city: city,
    p_category: category ?? null,
  });

  if (error) {
    log.error(`getStats failed`, { error: error.message, city });
    throw error;
  }

  const bySource: Record<string, number> = {};
  let total = 0;
  for (const row of data || []) {
    bySource[row.source] = Number(row.count);
    total += Number(row.count);
  }
  return { total, bySource };
}
