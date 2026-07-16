import { getSupabaseClient } from './supabase-client.js';
import { createLogger } from './logger.js';
import { normalizeName, findBestMatch, shouldReplaceCanonical } from './name-matcher.js';
import type { MatchCandidate } from './name-matcher.js';
import type { DeltaEntry, DeltaMarkEntry, DeltaStats, CrossMatchResult } from './types.js';

const log = createLogger('delta-store');

const BATCH_SIZE = 100;
const PAGE_SIZE = 1000; // PostgREST default row cap — must paginate past it

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
  if (e.lat != null) row.lat = e.lat;
  if (e.lng != null) row.lng = e.lng;
  return row;
}

/**
 * Fetch all rows of a query, paginating past PostgREST's 1000-row default cap.
 * Stops once a page comes back shorter than PAGE_SIZE (last page).
 */
async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  context: Record<string, unknown>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery(offset, offset + PAGE_SIZE - 1);
    if (error) {
      log.error('fetchAllPages failed', { error: error.message, offset, ...context });
      throw new Error(error.message);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

/**
 * Load cross-source match candidates from known_places.
 * Returns entries from OTHER sources in the same city+category (paginated —
 * without .range() PostgREST silently caps at 1000 rows, which used to hide
 * the majority of hotel/restaurant candidates).
 */
async function getCandidates(
  cityId: string,
  category: string | undefined,
  excludeSource: string,
): Promise<MatchCandidate[]> {
  const db = getSupabaseClient();

  const data = await fetchAllPages<{
    id: string; source: string; name: string | null; name_normalized: string | null;
    canonical_id: string | null; lat: number | null; lng: number | null;
  }>(
    (from, to) => {
      let query = db
        .from('known_places')
        .select('id, source, name, name_normalized, canonical_id, lat, lng')
        .eq('city_id', cityId)
        .neq('source', excludeSource)
        .not('name_normalized', 'is', null)
        .range(from, to);
      if (category) query = query.eq('category', category);
      return query;
    },
    { cityId, category, excludeSource },
  );

  log.info(`getCandidates: ${data.length} candidates (city=${cityId}, category=${category ?? 'any'}, exclude=${excludeSource})`);

  return data.map((row) => ({
    id: row.id,
    source: row.source,
    name: row.name ?? '',
    nameNormalized: row.name_normalized,
    canonicalId: row.canonical_id,
    lat: row.lat,
    lng: row.lng,
  }));
}

/**
 * Load same-source match candidates from known_places.
 * Used to detect duplicate Place IDs that map to the same physical location.
 * Paginated for the same reason as getCandidates().
 */
async function getIntraSourceCandidates(
  cityId: string,
  source: string,
  category: string | undefined,
): Promise<MatchCandidate[]> {
  const db = getSupabaseClient();

  const data = await fetchAllPages<{
    id: string; source: string; source_id: string; name: string | null; name_normalized: string | null;
    canonical_id: string | null; lat: number | null; lng: number | null;
  }>(
    (from, to) => {
      let query = db
        .from('known_places')
        .select('id, source, source_id, name, name_normalized, canonical_id, lat, lng')
        .eq('city_id', cityId)
        .eq('source', source)
        .not('name_normalized', 'is', null)
        .range(from, to);
      if (category) query = query.eq('category', category);
      return query;
    },
    { cityId, source, category },
  );

  log.info(`getIntraSourceCandidates: ${data.length} candidates (city=${cityId}, source=${source}, category=${category ?? 'any'})`);

  return data.map((row) => ({
    id: row.source_id, // use source_id so we can filter out self
    source: row.source,
    name: row.name ?? '',
    nameNormalized: row.name_normalized,
    canonicalId: row.canonical_id ?? row.id, // fall back to DB id as canonical
    lat: row.lat,
    lng: row.lng,
  }));
}

function buildCacheKey(entry: { cityId: string; category?: string; source: string }): string {
  return `${entry.cityId}::${entry.category ?? ''}::${entry.source}`;
}

function toCrossMatchResult(entry: DeltaMarkEntry, match: NonNullable<ReturnType<typeof findBestMatch>>): CrossMatchResult {
  return {
    entry,
    matchedWith: {
      id: match.candidateId,
      canonicalId: match.canonicalId,
      name: match.candidateName,
      source: match.candidateSource,
      score: match.score,
      matchType: match.matchType,
      distanceM: match.distanceM,
    },
  };
}

/**
 * Run name+geo matching against a candidate cache (grouped by city+category+source).
 * Entries that don't match under their own category get one retry against the
 * whole city without a category filter — Google frequently re-categorizes
 * places between scans, which otherwise makes the matcher blind to real
 * duplicates that changed category at the source.
 */
async function matchEntriesAgainstCandidates(
  entries: DeltaMarkEntry[],
  fetchCandidates: (cityId: string, category: string | undefined, source: string) => Promise<MatchCandidate[]>,
  filterSelf: boolean,
): Promise<{ matched: CrossMatchResult[]; geoSuspects: CrossMatchResult[]; unmatched: DeltaMarkEntry[] }> {
  const groups = new Map<string, { cityId: string; category: string | undefined; source: string }>();
  for (const entry of entries) {
    const key = buildCacheKey(entry);
    if (!groups.has(key)) groups.set(key, { cityId: entry.cityId, category: entry.category, source: entry.source });
  }

  const candidateCache = new Map<string, MatchCandidate[]>();
  await Promise.all(
    [...groups.entries()].map(([key, { cityId, category, source }]) =>
      fetchCandidates(cityId, category, source).then((c) => candidateCache.set(key, c)),
    ),
  );

  // Geo-only matches are kept OUT of `matched`: a false positive there would
  // silently suppress a real new place. They are reported as suspects instead
  // (the caller pushes the lead anyway, annotated with the suspicion).
  const matched: CrossMatchResult[] = [];
  const geoSuspects: CrossMatchResult[] = [];
  const firstPassUnmatched: DeltaMarkEntry[] = [];

  for (const entry of entries) {
    let candidates = candidateCache.get(buildCacheKey(entry)) ?? [];
    if (filterSelf) candidates = candidates.filter((c) => c.id !== entry.sourceId);

    const match = findBestMatch(entry.name!, candidates, { lat: entry.lat, lng: entry.lng });
    if (match && match.matchType === 'name') {
      matched.push(toCrossMatchResult(entry, match));
    } else if (match) {
      geoSuspects.push(toCrossMatchResult(entry, match));
    } else {
      firstPassUnmatched.push(entry);
    }
  }

  // Category-loosening fallback — only entries that had a category filter applied
  // in the first pass are worth retrying without one.
  const retryable = firstPassUnmatched.filter((e) => e.category);
  const unmatched = firstPassUnmatched.filter((e) => !e.category);

  if (retryable.length > 0) {
    const fallbackGroups = new Map<string, { cityId: string; source: string }>();
    for (const entry of retryable) {
      const key = `${entry.cityId}::${entry.source}`;
      if (!fallbackGroups.has(key)) fallbackGroups.set(key, { cityId: entry.cityId, source: entry.source });
    }

    const fallbackCache = new Map<string, MatchCandidate[]>();
    await Promise.all(
      [...fallbackGroups.entries()].map(([key, { cityId, source }]) =>
        fetchCandidates(cityId, undefined, source).then((c) => fallbackCache.set(key, c)),
      ),
    );

    let fallbackHits = 0;
    for (const entry of retryable) {
      let candidates = fallbackCache.get(`${entry.cityId}::${entry.source}`) ?? [];
      if (filterSelf) candidates = candidates.filter((c) => c.id !== entry.sourceId);

      const match = findBestMatch(entry.name!, candidates, { lat: entry.lat, lng: entry.lng });
      if (match && match.matchType === 'name') {
        matched.push(toCrossMatchResult(entry, match));
        fallbackHits++;
      } else if (match) {
        geoSuspects.push(toCrossMatchResult(entry, match));
      } else {
        unmatched.push(entry);
      }
    }

    if (fallbackHits > 0) {
      log.info(`Category-fallback dedup: ${fallbackHits} matches found without category filter`);
    }
  }

  return { matched, geoSuspects, unmatched };
}

/**
 * Find truly new entries by combining intra-source delta + cross-source name matching.
 * Returns entries split into "truly new" (push to pipeline) and "cross-matched" (link only).
 */
export async function findNewWithCrossCheck(
  entries: DeltaMarkEntry[],
): Promise<{ trulyNew: DeltaMarkEntry[]; crossMatched: CrossMatchResult[]; geoSuspects: CrossMatchResult[] }> {
  // Step 1: Intra-source ID dedup
  const newIntraSource = await findNew(entries);

  // Map back to DeltaMarkEntry (findNew returns DeltaEntry, we need the full info)
  const newSourceIds = new Set(newIntraSource.map((e) => `${e.source}::${e.sourceId}`));
  const newEntries = entries.filter((e) => newSourceIds.has(`${e.source}::${e.sourceId}`));

  const withName = newEntries.filter((e) => e.name);
  const withoutName = newEntries.filter((e) => !e.name);

  if (withName.length === 0) {
    return { trulyNew: newEntries, crossMatched: [], geoSuspects: [] };
  }

  // Step 1b: Intra-source name dedup (Google Maps assigns multiple IDs to the same physical place)
  const intraResult = await matchEntriesAgainstCandidates(
    withName,
    (cityId, category, source) => getIntraSourceCandidates(cityId, source, category),
    true,
  );
  const intraMatched = intraResult.matched;

  // Geo-suspects are NOT suppressed: they continue through the pipeline as
  // leads, annotated with the suspicion (flag mode until thresholds are proven).
  const geoSuspects: CrossMatchResult[] = [...intraResult.geoSuspects];
  const afterIntraDedup = [
    ...intraResult.unmatched,
    ...intraResult.geoSuspects.map((s) => s.entry),
  ];

  // Step 2: Cross-source name matching (only if entries survived intra-source dedup)
  let crossMatched: CrossMatchResult[] = [];
  const trulyNew: DeltaMarkEntry[] = [...withoutName];

  if (afterIntraDedup.length > 0) {
    const crossResult = await matchEntriesAgainstCandidates(
      afterIntraDedup,
      (cityId, category, source) => getCandidates(cityId, category, source),
      false,
    );
    crossMatched = crossResult.matched;
    // An entry can be suspect in both passes — keep the first (intra) suspicion.
    const alreadySuspect = new Set(geoSuspects.map((s) => s.entry.sourceId));
    geoSuspects.push(...crossResult.geoSuspects.filter((s) => !alreadySuspect.has(s.entry.sourceId)));
    trulyNew.push(...crossResult.unmatched);
    trulyNew.push(...crossResult.geoSuspects.map((s) => s.entry));
  } else {
    trulyNew.push(...afterIntraDedup);
  }

  const allMatched = [...intraMatched, ...crossMatched];

  if (allMatched.length > 0 || geoSuspects.length > 0) {
    log.info(
      `Dedup: ${intraMatched.length} intra-source, ${crossMatched.length} cross-source matches, ` +
        `${geoSuspects.length} geo-suspects (flagged, not suppressed). ${trulyNew.length} continue as new.`,
    );
    for (const m of allMatched) {
      log.info(
        `  ↳ ${m.entry.source} "${m.entry.name}" = ${m.matchedWith.source} "${m.matchedWith.name}" (score: ${m.matchedWith.score.toFixed(3)})`,
      );
    }
    for (const s of geoSuspects) {
      log.info(
        `  ⚑ suspect: "${s.entry.name}" ≈ "${s.matchedWith.name}" (score: ${s.matchedWith.score.toFixed(3)}, ${s.matchedWith.distanceM?.toFixed(0) ?? '?'}m)`,
      );
    }
  }

  return { trulyNew, crossMatched: allMatched, geoSuspects };
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
