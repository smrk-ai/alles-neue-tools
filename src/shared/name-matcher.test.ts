import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  matchScore,
  findBestMatch,
  MATCH_THRESHOLD,
  GEO_MATCH_DISTANCE_M,
  type MatchCandidate,
} from './name-matcher.js';
import { haversineMeters } from './geo.js';

describe('normalizeName', () => {
  test('strips Vietnamese diacritics', () => {
    assert.equal(normalizeName('Phở'), 'pho');
    assert.equal(normalizeName('Bánh Mì'), 'banh mi');
  });

  test('maps Đ/đ to d (NFD does not decompose it)', () => {
    assert.equal(normalizeName('Đà Nẵng'), 'da nang');
    assert.equal(normalizeName('nhà nghỉ đẹp'), 'dep'); // 'nha nghi' is a strip term
  });

  test('strips HTML tags (Google Alerts wraps keywords in <b>)', () => {
    assert.equal(normalizeName('<b>Cafe</b> Sông'), 'cafe song');
  });

  test('strips common type suffixes when >= 2 words remain', () => {
    assert.equal(normalizeName('Hoi An Boutique'), 'hoi an');
    assert.equal(normalizeName('Khach San Thanh Binh'), 'thanh binh');
  });

  test('does not strip the only word (would leave empty result)', () => {
    // "Hotel" alone must survive — stripping requires >=2 words after filtering
    assert.equal(normalizeName('Hotel'), 'hotel');
  });

  test('collapses whitespace and special characters', () => {
    assert.equal(normalizeName('  Pho -- Ha!!  '), 'pho ha');
  });
});

describe('matchScore thresholds', () => {
  test('near-identical names score above MATCH_THRESHOLD', () => {
    assert.ok(matchScore('Phở Hà Nội', 'Pho Ha Noi') >= MATCH_THRESHOLD); // diacritics only
    assert.ok(matchScore('Faifo Coffee', 'Faifo Cofee') >= MATCH_THRESHOLD); // typo
    assert.ok(matchScore('Reaching Out Tea House', 'Reaching Out Teahouse') >= MATCH_THRESHOLD); // spacing
  });

  test('clearly different names stay below MATCH_THRESHOLD', () => {
    // Same first word, different second word — must NOT be treated as the same place
    assert.ok(matchScore('Pho Ha', 'Pho Hien') < MATCH_THRESHOLD);
    assert.ok(matchScore('Blue Dragon Cafe', 'Red Phoenix Cafe') < MATCH_THRESHOLD);
  });
});

describe('findBestMatch — name only', () => {
  function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
      id: 'cand-1',
      source: 'osm',
      name: 'Cafe Sông',
      nameNormalized: normalizeName('Cafe Sông'),
      canonicalId: null,
      ...overrides,
    };
  }

  test('matches above MATCH_THRESHOLD without any geo data', () => {
    const result = findBestMatch('Cafe Song', [candidate()]);
    assert.ok(result);
    assert.equal(result?.candidateId, 'cand-1');
  });

  test('returns null when no candidate clears the threshold', () => {
    const result = findBestMatch('Pho Hien', [candidate({ name: 'Pho Ha', nameNormalized: normalizeName('Pho Ha') })]);
    assert.equal(result, null);
  });

  test('resolves canonicalId: falls back to candidate id when unset', () => {
    const result = findBestMatch('Cafe Song', [candidate({ canonicalId: null })]);
    assert.equal(result?.canonicalId, 'cand-1');
  });

  test('resolves canonicalId: uses existing canonical_id when set', () => {
    const result = findBestMatch('Cafe Song', [candidate({ id: 'cand-2', canonicalId: 'root-id' })]);
    assert.equal(result?.canonicalId, 'root-id');
  });

  test('picks the highest-scoring candidate among several eligible ones', () => {
    const candidates = [
      candidate({ id: 'close', name: 'Cafe Sang', nameNormalized: normalizeName('Cafe Sang') }), // ~0.96
      candidate({ id: 'exact', name: 'Cafe Song', nameNormalized: normalizeName('Cafe Song') }), // 1.0
    ];
    const result = findBestMatch('Cafe Song', candidates);
    assert.equal(result?.candidateId, 'exact');
  });
});

describe('findBestMatch — geo-assisted matching', () => {
  // Hoi An reference point; ~0.0003° latitude ≈ 33m, ~0.001° ≈ 111m.
  const base = { lat: 15.8801, lng: 108.3380 };
  const near = { lat: 15.8801 + 0.0003, lng: 108.3380 }; // ~33m away
  const far = { lat: 15.8801 + 0.001, lng: 108.3380 }; // ~111m away

  function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
      id: 'cand-1',
      source: 'booking',
      name: 'Sunrise Homestay',
      nameNormalized: normalizeName('Sunrise Homestay'),
      canonicalId: null,
      lat: base.lat,
      lng: base.lng,
      ...overrides,
    };
  }

  test('weak name score alone (below GEO_MATCH_THRESHOLD) never matches, even close by', () => {
    // matchScore('Totally Different Place', 'Sunrise Homestay') ≈ 0.48 — well under 0.70
    const result = findBestMatch('Totally Different Place', [candidate()], near);
    assert.equal(result, null);
  });

  test('weak-but-plausible name score + within 75m => match', () => {
    // matchScore('Sun Homestay', 'Sunrise Homestay') ≈ 0.88 — between GEO_MATCH_THRESHOLD
    // and MATCH_THRESHOLD, so on its own it wouldn't match; geo proximity tips it over.
    const result = findBestMatch('Sun Homestay', [candidate()], near);
    assert.ok(result, 'expected a geo-assisted match');
  });

  test('same weak-but-plausible name score + beyond 75m => no match', () => {
    const result = findBestMatch('Sun Homestay', [candidate()], far);
    assert.equal(result, null);
  });

  test('candidate without coordinates falls back to name-only matching', () => {
    const result = findBestMatch('Sun Homestay', [candidate({ lat: null, lng: null })], near);
    assert.equal(result, null); // name score alone isn't enough, and no geo data to help
  });

  test('strong name match wins even without geo data', () => {
    const result = findBestMatch('Sunrise Homestay', [candidate({ lat: null, lng: null })], near);
    assert.ok(result);
  });

  test('matchType is "name" for strong scores, "geo" for proximity-assisted', () => {
    const strong = findBestMatch('Sunrise Homestay', [candidate()], near);
    assert.equal(strong?.matchType, 'name');

    const geoAssisted = findBestMatch('Sun Homestay', [candidate()], near);
    assert.equal(geoAssisted?.matchType, 'geo');
    assert.ok(geoAssisted?.distanceM !== undefined && geoAssisted.distanceM < GEO_MATCH_DISTANCE_M);
  });
});

describe('findBestMatch — generic-name guard', () => {
  const base = { lat: 15.8801, lng: 108.3380 };
  const near = { lat: 15.8801 + 0.0003, lng: 108.3380 }; // ~33m away

  function candidateNamed(name: string): MatchCandidate {
    return {
      id: 'cand-generic',
      source: 'google_maps',
      name,
      nameNormalized: normalizeName(name),
      canonicalId: null,
      lat: base.lat,
      lng: base.lng,
    };
  }

  test('generic prefix alone must not geo-match two different venues', () => {
    // JW rewards the shared "ca phe" prefix — the score clears GEO_MATCH_THRESHOLD,
    // but the significant tokens ("muoi" vs "sua da") share nothing.
    assert.ok(matchScore('Ca Phe Muoi', 'Ca Phe Sua Da') >= 0.70, 'premise: prefix-inflated score');
    const result = findBestMatch('Ca Phe Muoi', [candidateNamed('Ca Phe Sua Da')], near);
    assert.equal(result, null);
  });

  test('quan-pho cluster: different shops with generic prefixes stay separate', () => {
    const result = findBestMatch('Quan Pho Ba Lan', [candidateNamed('Quan Pho Ong Hai')], near);
    assert.equal(result, null);
  });

  test('purely generic name only matches on exact equality AND proximity', () => {
    // Same generic name, co-located → same place (name-grade evidence).
    const colocated = findBestMatch('Coffee', [candidateNamed('Coffee')], near);
    assert.ok(colocated);
    assert.equal(colocated.matchType, 'name');

    // Same generic name, no entry coordinates → cannot verify, no match.
    const noGeo = findBestMatch('Coffee', [candidateNamed('Coffee')]);
    assert.equal(noGeo, null);

    // Similar-but-not-equal generic names never match.
    const similar = findBestMatch('Ca Phe', [candidateNamed('Coffee')], near);
    assert.equal(similar, null);
  });

  test('shared significant token still allows the intended geo assist', () => {
    // Token-subset containment lifts the score above MATCH_THRESHOLD; combined
    // with proximity that is name-grade evidence (safe to auto-dedup).
    const result = findBestMatch(
      'Madam Khanh Banh Mi',
      [candidateNamed('Madam Khanh The Banh Mi Queen')],
      near,
    );
    assert.ok(result, 'expected geo-assisted match via shared significant token');
    assert.equal(result.matchType, 'name');
  });

  test('strong score WITHOUT geo confirmation is only a suspect, not safe', () => {
    // "Bún Bò Lan" vs "Bún Bò Sen" — genuinely different venues, JW ≈0.92 via
    // the shared prefix. Without co-location this must never auto-dedup.
    const result = findBestMatch('Bún Bò Lan', [candidateNamed('Bún Bò Sen')]);
    if (result) assert.equal(result.matchType, 'geo');
  });

  test('substring containment no longer inflates unrelated names', () => {
    // "azuMI COFFEE" contains "mi coffee" as a substring but not on token level.
    assert.ok(matchScore('Azumi Coffee', 'Mi Coffee') < 0.92);
  });

  test('generic CANDIDATE name is guarded symmetrically', () => {
    // Candidate "Ca Phe" is purely generic — a specific entry must not be
    // dismissed against it, no matter how high the prefix score is.
    const result = findBestMatch('Cà phê 119', [candidateNamed('Ca Phe')], near);
    assert.equal(result, null);
  });
});

describe('haversineMeters', () => {
  test('~111.32km for one degree of latitude at the equator', () => {
    const distance = haversineMeters(0, 0, 1, 0);
    assert.ok(Math.abs(distance - 111_320) < 200, `expected ~111320m, got ${distance}`);
  });

  test('zero distance for identical coordinates', () => {
    assert.equal(haversineMeters(15.88, 108.33, 15.88, 108.33), 0);
  });

  test('GEO_MATCH_DISTANCE_M boundary: ~33m is within range, ~111m is not', () => {
    const near = haversineMeters(15.8801, 108.3380, 15.8801 + 0.0003, 108.3380);
    const far = haversineMeters(15.8801, 108.3380, 15.8801 + 0.001, 108.3380);
    assert.ok(near < GEO_MATCH_DISTANCE_M);
    assert.ok(far >= GEO_MATCH_DISTANCE_M);
  });
});
