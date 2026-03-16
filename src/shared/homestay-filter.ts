// ===========================================
// Homestay Filter – Pipeline Exclusion
// ===========================================
// Homestays werden in known_places gespeichert (Delta-Detection),
// aber NICHT in pipeline_leads gepusht.

// Google Places types die als Homestay gelten
// Subset der 'hotels' Einträge in google-maps/category-mapper.ts TYPE_MAPPING
// Sync: name-matcher.ts STRIP_TERMS enthält überlappende Begriffe
const HOMESTAY_GOOGLE_TYPES = new Set([
  'guest_house',
  'bed_and_breakfast',
  'private_guest_room',
  'farmstay',
  'cottage',
  'hostel',
]);

// Name-Pattern für Booking/Agoda/andere Quellen ohne strukturierte Typ-Info
// Sync: name-matcher.ts STRIP_TERMS enthält überlappende Begriffe
const HOMESTAY_NAME_PATTERN = /homestay|home\s?stay|guesthouse|guest\s?house|hostel|backpacker/i;

/**
 * Erkennt Homestay anhand Google Places primaryType + types.
 */
export function isHomestayByGoogleType(primaryType?: string, types?: string[]): boolean {
  if (primaryType && HOMESTAY_GOOGLE_TYPES.has(primaryType)) return true;
  if (types?.some((t) => HOMESTAY_GOOGLE_TYPES.has(t))) return true;
  return false;
}

/**
 * Erkennt Homestay anhand Name (für Booking/Agoda/andere Quellen).
 */
export function isHomestayByName(name?: string | null): boolean {
  if (!name) return false;
  return HOMESTAY_NAME_PATTERN.test(name);
}

/**
 * Bestimmt sub_type für eine Unterkunft.
 * Gibt den spezifischsten Google-Type zurück, oder 'homestay' bei Name-Match.
 * undefined = normales Hotel (kein sub_type).
 */
export function resolveSubType(
  primaryType?: string,
  types?: string[],
  name?: string | null,
): string | undefined {
  if (primaryType && HOMESTAY_GOOGLE_TYPES.has(primaryType)) return primaryType;
  if (types) {
    const match = types.find((t) => HOMESTAY_GOOGLE_TYPES.has(t));
    if (match) return match;
  }
  if (name && HOMESTAY_NAME_PATTERN.test(name)) return 'homestay';
  return undefined;
}
