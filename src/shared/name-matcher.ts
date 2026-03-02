// ===========================================
// Cross-Source Name Matching (P3)
// ===========================================

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

/**
 * Compute similarity score between two place names.
 * Returns 0..1 (1 = identical after normalization).
 */
export function matchScore(nameA: string, nameB: string): number {
  const normA = normalizeName(nameA);
  const normB = normalizeName(nameB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const jw = jaroWinkler(normA, normB);

  // Containment bonus: one name is substring of the other
  const containment = normA.includes(normB) || normB.includes(normA) ? 0.05 : 0;

  return Math.min(jw + containment, 1.0);
}

// --- Source Priority ---

// Higher number = more authoritative (preferred as canonical)
export const SOURCE_PRIORITY: Record<string, number> = {
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
}

export interface MatchResult {
  candidateId: string;
  canonicalId: string; // resolved root ID
  candidateName: string;
  candidateSource: string;
  score: number;
}

/**
 * Find the best cross-source match for a given name among candidates.
 * Returns null if no match above threshold.
 */
export function findBestMatch(
  name: string,
  candidates: MatchCandidate[],
): MatchResult | null {
  if (!name || candidates.length === 0) return null;

  const normalized = normalizeName(name);
  if (!normalized) return null;

  let bestScore = 0;
  let bestCandidate: MatchCandidate | null = null;

  for (const c of candidates) {
    const cNorm = c.nameNormalized ?? normalizeName(c.name);
    if (!cNorm) continue;

    // Exact normalized match → instant win
    if (normalized === cNorm) {
      bestScore = 1.0;
      bestCandidate = c;
      break;
    }

    const score = jaroWinkler(normalized, cNorm);
    // Add containment bonus
    const containment = normalized.includes(cNorm) || cNorm.includes(normalized) ? 0.05 : 0;
    const total = Math.min(score + containment, 1.0);

    if (total > bestScore) {
      bestScore = total;
      bestCandidate = c;
    }
  }

  if (!bestCandidate || bestScore < MATCH_THRESHOLD) return null;

  // Resolve canonical: use existing canonical_id if set, otherwise the candidate itself
  const canonicalId = bestCandidate.canonicalId ?? bestCandidate.id;

  return {
    candidateId: bestCandidate.id,
    canonicalId,
    candidateName: bestCandidate.name,
    candidateSource: bestCandidate.source,
    score: bestScore,
  };
}

/**
 * Determine which entry should be the canonical (root) based on source priority.
 * Returns true if the new source should become canonical instead.
 */
export function shouldReplaceCanonical(newSource: string, existingSource: string): boolean {
  return (SOURCE_PRIORITY[newSource] ?? 0) > (SOURCE_PRIORITY[existingSource] ?? 0);
}
