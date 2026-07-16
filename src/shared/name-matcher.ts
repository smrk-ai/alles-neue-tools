// ===========================================
// Cross-Source Name Matching (P3)
// ===========================================

import type { LeadSource } from './types.js';
import { haversineMeters } from './geo.js';

// --- Jaro-Winkler Implementation ---

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
  const jaroScore = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaroScore + prefix * prefixScale * (1 - jaroScore);
}

// --- Name Normalization ---

// Suffixes/prefixes that indicate place type, not unique identity
const STRIP_TERMS = [
  'hotel', 'resort', 'villa', 'villas', 'homestay', 'hostel',
  'guest house', 'guesthouse', 'khach san', 'nha nghi',
  'boutique', 'spa', 'residence', 'suites', 'lodge',
  'apartment', 'apartments', 'inn', 'motel',
];

/**
 * Normalize a place name for cross-source matching.
 * Strips diacritics, common suffixes, and special characters.
 */
export function normalizeName(name: string): string {
  let n = name.toLowerCase();

  // Strip HTML tags (Google Alerts wraps keywords in <b>)
  n = n.replace(/<[^>]*>/g, '');

  // Unicode NFD decomposition + strip combining marks (removes diacritics)
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Special case: Đ/đ → d (NFD doesn't decompose this)
  n = n.replace(/[đĐ]/g, 'd');

  // Strip special characters
  n = n.replace(/[-–—&'.,:;!?()[\]{}"/\\]/g, ' ');

  // Collapse whitespace
  n = n.replace(/\s+/g, ' ').trim();

  // Strip common type terms (only if ≥2 words remain after stripping)
  const words = n.split(' ');
  const filtered = words.filter((w) => !STRIP_TERMS.includes(w));
  if (filtered.length >= 2) {
    // Also try multi-word terms
    n = filtered.join(' ');
    for (const term of STRIP_TERMS) {
      if (term.includes(' ')) {
        n = n.replace(new RegExp(`\\b${term}\\b`, 'g'), '').trim();
      }
    }
    n = n.replace(/\s+/g, ' ').trim();
  }

  return n;
}

// --- Scoring ---

export const MATCH_THRESHOLD = 0.92;

// A weaker name score is accepted as a match if the two places are also
// physically close together — catches cases like "Cafe Sông" vs "Song Cafe"
// (name drift) that would otherwise miss the 0.92 name-only threshold.
export const GEO_MATCH_THRESHOLD = 0.70;
export const GEO_MATCH_DISTANCE_M = 75;

// Tokens that carry no identity on their own: place-type words, drinks/food
// staples, and local area names shared by many venues (Tra Que, Cam Thanh, …).
// Jaro-Winkler weights common prefixes heavily, so "Ca Phe ABC" vs "Ca Phe XYZ"
// scores ~0.8 purely on the generic prefix — the geo fallback must therefore
// require at least one shared *significant* token between the two names.
const GENERIC_TOKENS = new Set([
  // place types (beyond STRIP_TERMS, which only strips lodging terms)
  'restaurant', 'quan', 'nha', 'hang', 'cafe', 'coffee', 'ca', 'phe', 'tra',
  'bar', 'pub', 'club', 'bistro', 'eatery', 'kitchen', 'house', 'garden',
  'shop', 'store', 'food', 'foods', 'drink', 'drinks', 'juice', 'smoothie',
  'bbq', 'grill', 'buffet', 'bakery', 'banh', 'mi', 'pho', 'com', 'bun',
  'sua', 'an', 'am', 'thuc',
  // local area names shared by many venues in/around Hoi An
  'hoi', 'que', 'cam', 'thanh', 'chau', 'minh', 'hai', 'ba', 'le', 'cua',
  'dai', 'beach', 'riverside', 'river', 'old', 'town', 'ancient', 'village',
  // filler
  'the', 'la', 'de', 'and', 'by', 'at',
]);

/**
 * Tokens of a normalized name that actually identify the place
 * (everything that is not a generic type/area/filler word).
 */
export function getSignificantTokens(normalizedName: string): Set<string> {
  return new Set(
    normalizedName
      .split(' ')
      .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t)),
  );
}

function hasSignificantOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const t of a) {
    if (b.has(t)) return true;
  }
  return false;
}

function isTokenSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size > b.size) return false;
  for (const t of a) {
    if (!b.has(t)) return false;
  }
  return true;
}

function scoreNormalized(normA: string, normB: string): number {
  const jw = jaroWinkler(normA, normB);
  // Containment bonus on TOKEN level only — substring containment produced
  // false positives like "azuMI COFFEE" ⊃ "mi coffee". Capped at 0.999 so a
  // bonus can never fake an exact match (score 1.0 = strictly equal names).
  const tokensA = new Set(normA.split(' '));
  const tokensB = new Set(normB.split(' '));
  const containment = isTokenSubset(tokensA, tokensB) || isTokenSubset(tokensB, tokensA) ? 0.05 : 0;
  return Math.min(jw + containment, 0.999);
}

/**
 * Compute similarity score between two place names.
 * Returns 0..1 (1 = identical after normalization).
 */
export function matchScore(nameA: string, nameB: string): number {
  const normA = normalizeName(nameA);
  const normB = normalizeName(nameB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  return scoreNormalized(normA, normB);
}

// --- Source Priority ---

// Higher number = more authoritative (preferred as canonical)
export const SOURCE_PRIORITY: Partial<Record<LeadSource, number>> = {
  google_maps: 100,
  osm: 80,
  facebook: 60,
  booking: 40,
  agoda: 35,
  tripadvisor: 30,
  google_alert: 20,
  instagram: 15,
  foursquare: 10,
  manual: 5,
  other: 0,
};

// --- Cross-Source Matching ---

export interface MatchCandidate {
  id: string;
  source: string;
  name: string;
  nameNormalized: string | null;
  canonicalId: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface MatchEntryGeo {
  lat?: number | null;
  lng?: number | null;
}

export interface MatchResult {
  candidateId: string;
  canonicalId: string; // resolved root ID
  candidateName: string;
  candidateSource: string;
  score: number;
  /**
   * 'name' — score cleared MATCH_THRESHOLD on its own (safe to auto-dedup).
   * 'geo'  — only matched via proximity + weaker name score (flag, don't
   *          silently suppress: false positives would hide real new places).
   */
  matchType: 'name' | 'geo';
  /** Distance in meters, when both sides have coordinates. */
  distanceM?: number;
}

/**
 * Find the best cross-source match for a given name among candidates.
 * A candidate matches if either (a) the name score clears MATCH_THRESHOLD on
 * its own, or (b) the two places are within GEO_MATCH_DISTANCE_M of each
 * other AND the name score clears the weaker GEO_MATCH_THRESHOLD AND the two
 * names share at least one significant (non-generic) token — otherwise dense
 * clusters of "Ca Phe …"/"Quan Pho …" venues cross-match on prefix alone.
 * Names consisting ONLY of generic tokens ("Coffee", "Ca Phe") carry no
 * identity at all: they match solely on exact equality PLUS proximity.
 * Among matching candidates, geo-confirmed ones are preferred on near-ties.
 * Returns null if no candidate matches.
 */
export function findBestMatch(
  name: string,
  candidates: MatchCandidate[],
  entryGeo?: MatchEntryGeo,
): MatchResult | null {
  if (!name || candidates.length === 0) return null;

  const normalized = normalizeName(name);
  if (!normalized) return null;

  const entryTokens = getSignificantTokens(normalized);
  const entryIsGeneric = entryTokens.size === 0;
  const hasEntryGeo = entryGeo?.lat != null && entryGeo?.lng != null;

  let best: MatchCandidate | null = null;
  let bestScore = 0;
  let bestRank = -1;
  let bestGeo = false;
  let bestDistance: number | undefined;

  let bestExact = false;

  for (const c of candidates) {
    const cNorm = c.nameNormalized ?? normalizeName(c.name);
    if (!cNorm) continue;

    const exact = normalized === cNorm;
    const score = exact ? 1.0 : scoreNormalized(normalized, cNorm);

    const hasCandidateGeo = c.lat != null && c.lng != null;
    const distanceM =
      hasEntryGeo && hasCandidateGeo
        ? haversineMeters(entryGeo!.lat!, entryGeo!.lng!, c.lat!, c.lng!)
        : undefined;
    const withinGeoRange = distanceM !== undefined && distanceM < GEO_MATCH_DISTANCE_M;

    let isMatch: boolean;
    const candidateIsGeneric = getSignificantTokens(cNorm).size === 0;
    if (entryIsGeneric || candidateIsGeneric) {
      // A generic name on EITHER side carries no identity ("Ca Phe", "Quán Phở"
      // exist dozens of times) — only identical name AT the same location counts.
      isMatch = exact && withinGeoRange;
    } else {
      const nameMatch = score >= MATCH_THRESHOLD;
      const geoMatch =
        withinGeoRange &&
        score >= GEO_MATCH_THRESHOLD &&
        hasSignificantOverlap(entryTokens, getSignificantTokens(cNorm));
      isMatch = nameMatch || geoMatch;
    }
    if (!isMatch) continue;

    // Tiny bonus so a geo-confirmed candidate wins ties against a same-score
    // candidate without coordinates — doesn't change which candidates qualify.
    const rank = score + (withinGeoRange ? 0.001 : 0);
    if (rank > bestRank) {
      best = c;
      bestScore = score;
      bestRank = rank;
      bestGeo = withinGeoRange;
      bestDistance = distanceM;
      bestExact = exact;
    }
  }

  if (!best) return null;

  // Resolve canonical: use existing canonical_id if set, otherwise the candidate itself
  const canonicalId = best.canonicalId ?? best.id;

  // 'name' (= safe to auto-dedup) requires exact equality OR a strong score
  // WITH geo confirmation. A high Jaro-Winkler score alone is not safe:
  // prefix-heavy Vietnamese names score 0.92+ for genuinely different venues
  // ("Bún Bò Lan" vs "Bún Bò Sen" ≈ 0.92, "Cô Gió" vs "Cô Bạn" ≈ 0.93).
  // Everything else is a 'geo'/suspect match — flagged, never auto-dismissed.
  const matchType: MatchResult['matchType'] =
    bestExact || (bestScore >= MATCH_THRESHOLD && bestGeo) ? 'name' : 'geo';

  return {
    candidateId: best.id,
    canonicalId,
    candidateName: best.name,
    candidateSource: best.source,
    score: bestScore,
    matchType,
    distanceM: bestDistance,
  };
}

/**
 * Determine which entry should be the canonical (root) based on source priority.
 * Returns true if the new source should become canonical instead.
 */
export function shouldReplaceCanonical(newSource: string, existingSource: string): boolean {
  return (SOURCE_PRIORITY[newSource as LeadSource] ?? 0) > (SOURCE_PRIORITY[existingSource as LeadSource] ?? 0);
}
