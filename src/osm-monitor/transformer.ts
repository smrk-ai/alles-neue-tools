// ===========================================
// OSM Changeset Monitor – Element Transformer
// ===========================================

import type { PipelineLeadInput, CategoryGuess } from '../shared/types.js';
import type { OverpassElement } from './types.js';

/**
 * Transform an OSM Overpass element into a pipeline lead.
 */
export function transformElement(element: OverpassElement, city: string, cityId?: string): PipelineLeadInput {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;

  return {
    source: 'osm',
    source_id: `${element.type}/${element.id}`,
    source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    name: extractName(element.tags),
    address: buildAddress(element.tags),
    city,
    city_id: cityId,
    category_guess: mapCategory(element.tags),
    phone: element.tags.phone || element.tags['contact:phone'] || null,
    website: element.tags.website || element.tags['contact:website'] || null,
    google_maps_url: lat && lon ? `https://www.google.com/maps?q=${lat},${lon}` : null,
    lat: lat ?? null,
    lng: lon ?? null,
    raw_data: {
      osm_type: element.type,
      osm_id: element.id,
      osm_version: element.version ?? null,
      osm_timestamp: element.timestamp ?? null,
      osm_tags: element.tags,
      coordinates: lat && lon ? { lat, lon } : null,
      cuisine: element.tags.cuisine ?? null,
      opening_hours: element.tags.opening_hours ?? null,
    },
  };
}

function extractName(tags: Record<string, string>): string | null {
  return tags.name || tags['name:en'] || tags['name:vi'] || null;
}

function buildAddress(tags: Record<string, string>): string | null {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'] || tags['addr:suburb'],
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function mapCategory(tags: Record<string, string>): CategoryGuess | null {
  const amenity = tags.amenity;
  const tourism = tags.tourism;

  if (amenity === 'restaurant') return 'restaurants';
  if (amenity === 'cafe') return 'cafes';
  if (amenity === 'bar' || amenity === 'pub') return 'bars';
  if (tourism === 'hotel' || tourism === 'guest_house' || tourism === 'hostel' || tourism === 'motel') return 'hotels';
  return null;
}
