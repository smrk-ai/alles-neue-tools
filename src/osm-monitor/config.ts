// ===========================================
// OSM Changeset Monitor – Configuration
// ===========================================

import type { CityConfig } from '../shared/types.js';
import type { Bbox } from './types.js';

export const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

export const AMENITY_FILTER = 'restaurant|cafe|bar|pub';
export const TOURISM_FILTER = 'hotel|guest_house|hostel|motel';

/**
 * Extract a bounding box [south, west, north, east] from a CityConfig boundary polygon.
 * The boundary uses [lng, lat] pairs (GeoJSON order).
 */
export function getBboxForCity(city: CityConfig): Bbox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const [lng, lat] of city.boundary) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  return [minLat, minLng, maxLat, maxLng];
}
