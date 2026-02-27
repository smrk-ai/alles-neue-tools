import type { PipelineLeadInput } from '../shared/types.js';
import type { PlaceBasicDetails } from './types.js';
import { mapCategory, mapCategoryFromPrimaryType } from './category-mapper.js';

interface TransformMeta {
  city: string;
  cityId: string;
  h3Cell?: string;
  scanDate: string;
  isBaseline: boolean;
}

/**
 * Transform a Google Place into a Pipeline Lead.
 */
export function transformToLead(
  place: PlaceBasicDetails,
  meta: TransformMeta,
): PipelineLeadInput {
  return {
    source: 'google_maps',
    source_id: place.id,
    source_url: place.googleMapsUri ?? null,
    name: place.displayName?.text ?? null,
    address: place.formattedAddress ?? null,
    city: meta.city,
    city_id: meta.cityId,
    category_guess:
      mapCategoryFromPrimaryType(place.primaryType) ??
      mapCategory(place.types) ??
      null,
    google_maps_url: place.googleMapsUri ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    raw_data: {
      google_place_id: place.id,
      google_types: place.types,
      google_primary_type: place.primaryType,
      google_primary_type_display: place.primaryTypeDisplayName?.text,
      google_business_status: place.businessStatus,
      location: place.location,
      display_name_language: place.displayName?.languageCode,
      discovery: {
        method: 'h3_grid_scan',
        h3_cell: meta.h3Cell,
        scan_date: meta.scanDate,
        is_baseline: meta.isBaseline,
      },
    },
  };
}

/**
 * Find which H3 cell a place was discovered in.
 */
export function findCellForPlace(
  placeId: string,
  idsByCell: Record<string, string[]>,
): string | undefined {
  for (const [cellId, ids] of Object.entries(idsByCell)) {
    if (ids.includes(placeId)) return cellId;
  }
  return undefined;
}
