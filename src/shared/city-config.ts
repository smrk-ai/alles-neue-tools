import { getSupabaseClient } from './supabase-client.js';
import { createLogger } from './logger.js';
import type { CityConfig, Hotspot } from './types.js';

const log = createLogger('city-config');

// Module-level cache — populated by loadCities()
let citiesCache: CityConfig[] = [];

/**
 * Load cities from Supabase into module cache.
 * Must be called once before any getter is used.
 * Idempotent — second call is a no-op.
 */
export async function loadCities(): Promise<void> {
  if (citiesCache.length > 0) return;

  const db = getSupabaseClient();
  const { data, error } = await db
    .from('cities')
    .select('id, slug, name, country, boundary, config')
    .eq('is_active', true)
    .order('name');

  if (error) {
    log.error('Failed to load cities from Supabase', { error: error.message });
    throw new Error(`Failed to load cities: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new Error('No active cities found in Supabase');
  }

  citiesCache = data.map(rowToConfig);
  log.info(`Loaded ${citiesCache.length} cities: ${citiesCache.map((c) => c.slug).join(', ')}`);
}

/**
 * Transform a Supabase cities row into CityConfig.
 * Extracts coordinates from GeoJSON Polygon boundary.
 */
function rowToConfig(row: Record<string, unknown>): CityConfig {
  const config = (row.config as Record<string, unknown>) || {};
  const boundary = row.boundary as { type?: string; coordinates?: number[][][] } | null;

  // Extract outer ring from GeoJSON Polygon → [lng, lat][]
  let coords: [number, number][] = [];
  if (boundary?.type === 'Polygon' && boundary.coordinates?.[0]) {
    coords = boundary.coordinates[0] as [number, number][];
  }

  // Transform hotspots: only include those with polygon boundaries
  let hotspots: Hotspot[] | undefined;
  const rawHotspots = config.hotspots as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rawHotspots)) {
    const valid = rawHotspots.filter(
      (h) => Array.isArray(h.boundary) && (h.boundary as unknown[]).length >= 3,
    );
    if (valid.length > 0) {
      hotspots = valid.map((h) => ({
        name: h.name as string,
        boundary: h.boundary as [number, number][],
        resolution: (h.resolution as number) ?? 10,
      }));
    }
  }

  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    country: row.country as string,
    boundary: coords,
    resolution: (config.resolution as number) ?? 8,
    categories: (config.categories as string[]) ?? ['restaurant', 'cafe', 'bar', 'lodging'],
    hotspots,
  };
}

// --- Synchronous getters (unchanged API for all import sites) ---

function ensureLoaded(): void {
  if (citiesCache.length === 0) {
    throw new Error('Cities not loaded. Call loadCities() before using city getters.');
  }
}

export function getCityBySlug(slug: string): CityConfig | undefined {
  ensureLoaded();
  return citiesCache.find((c) => c.slug === slug);
}

export function getAllCities(): CityConfig[] {
  ensureLoaded();
  return citiesCache;
}

export function getCityIdBySlug(slug: string): string | undefined {
  ensureLoaded();
  return citiesCache.find((c) => c.slug === slug)?.id;
}

export function getCityIdByName(name: string): string | undefined {
  ensureLoaded();
  return citiesCache.find((c) => c.name === name)?.id;
}
