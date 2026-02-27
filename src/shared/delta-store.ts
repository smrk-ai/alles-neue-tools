import { getSupabaseClient } from './supabase-client.js';
import { createLogger } from './logger.js';
import type { DeltaEntry, DeltaMarkEntry, DeltaStats } from './types.js';

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
    const rows = batch.map((e) => {
      // Omit city field entirely if undefined/null so the DB default ('Hoi An') kicks in.
      // Passing null explicitly violates the NOT NULL constraint.
      const row: Record<string, unknown> = {
        source: e.source,
        source_id: e.sourceId,
        city_id: e.cityId,
        h3_cell: e.h3Cell || null,
        name: e.name || null,
        last_seen: new Date().toISOString(),
      };
      if (e.city) row.city = e.city;
      if (e.category) row.category = e.category;
      return row;
    });

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
