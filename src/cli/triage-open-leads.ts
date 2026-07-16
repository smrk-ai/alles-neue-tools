/**
 * One-off triage of open pipeline leads (status='new', source=google_maps).
 *
 * Phases:
 *  A) Cluster-dedup among the open leads themselves (keep the oldest of each
 *     name-match cluster, dismiss the rest).
 *  B) Dedup against the existing stock: known_places (excluding the open
 *     leads' own rows) and published places. Strong name matches are
 *     dismissed; geo-only matches are ANNOTATED, never auto-dismissed
 *     (false positives would hide real new places).
 *  C) Rating enrichment for surviving leads without google_rating_count —
 *     minimal Enterprise mask, atomic budget reservation, stops cleanly when
 *     the free cap is reached.
 *  D) Newness gate: >MAX_REVIEWS reviews = established place → dismissed.
 *     CLOSED_PERMANENTLY → dismissed.
 *
 * Usage:
 *   npx tsx src/cli/triage-open-leads.ts --dry-run   (report only)
 *   npx tsx src/cli/triage-open-leads.ts             (apply)
 */
import 'dotenv/config';
import { getSupabaseClient } from '../shared/supabase-client.js';
import { normalizeName, findBestMatch, type MatchCandidate } from '../shared/name-matcher.js';
import { getPlaceRatingEnterprise } from '../google-maps/places-client.js';
import { reserveBudget, releaseBudget, getBudgetStatus } from '../shared/budget-tracker.js';
import { sleep } from '../shared/utils.js';

const TOOL_SLUG = 'google-maps';
const ENTERPRISE_SKU = 'place_details_enterprise' as const;
const MAX_REVIEWS = 100;
const PAGE_SIZE = 1000;
const DELAY_MS = 100;

const dryRun = process.argv.includes('--dry-run');

interface Lead {
  id: string;
  source_id: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
  city_id: string | null;
  notes: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
}

interface Dismissal {
  lead: Lead;
  reason: string;
}

interface Annotation {
  lead: Lead;
  suspect: { name: string; source: string; score: number; distance_m: number | null };
}

const today = new Date().toISOString().slice(0, 10);

function appendNote(existing: string | null, note: string): string {
  const line = `[triage ${today}] ${note}`;
  return existing && existing.trim().length > 0 ? `${existing}\n${line}` : line;
}

function toCandidate(id: string, source: string, name: string, nameNormalized: string | null, lat: number | null, lng: number | null): MatchCandidate {
  return { id, source, name, nameNormalized, canonicalId: null, lat, lng };
}

async function fetchOpenLeads(): Promise<Lead[]> {
  const db = getSupabaseClient();
  const all: Lead[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from('pipeline_leads')
      .select('id, source_id, name, lat, lng, city_id, notes, raw_data, created_at')
      .eq('status', 'new')
      .eq('source', 'google_maps')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Lead query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Lead[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function fetchStockCandidates(cityId: string, excludeSourceIds: Set<string>): Promise<MatchCandidate[]> {
  const db = getSupabaseClient();
  const candidates: MatchCandidate[] = [];

  // known_places (google_maps, this city), paginated past the 1000-row cap
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from('known_places')
      .select('source_id, name, name_normalized, lat, lng')
      .eq('source', 'google_maps')
      .eq('city_id', cityId)
      .not('name_normalized', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`known_places query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.source_id && excludeSourceIds.has(row.source_id)) continue;
      candidates.push(toCandidate(row.source_id ?? '', 'google_maps', row.name ?? '', row.name_normalized, row.lat, row.lng));
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Published places (already on the portal = definitely not a new lead)
  const { data: places, error: placesErr } = await db
    .from('places')
    .select('id, name, lat, lng')
    .eq('is_archived', false);
  if (placesErr) throw new Error(`places query failed: ${placesErr.message}`);
  for (const p of places ?? []) {
    candidates.push(toCandidate(p.id, 'portal', p.name, normalizeName(p.name) || null, p.lat, p.lng));
  }

  return candidates;
}

async function main() {
  const db = getSupabaseClient();
  const leads = await fetchOpenLeads();
  console.log(`Open google_maps leads (status=new): ${leads.length}`);
  if (leads.length === 0) return;

  const dismissals: Dismissal[] = [];
  const annotations: Annotation[] = [];

  // --- Phase A: cluster-dedup among the open leads (oldest wins) ---
  const kept: Lead[] = [];
  const keptCandidates: MatchCandidate[] = [];
  for (const lead of leads) {
    if (!lead.name) {
      kept.push(lead);
      continue;
    }
    const match = findBestMatch(lead.name, keptCandidates, { lat: lead.lat, lng: lead.lng });
    if (match && match.matchType === 'name') {
      dismissals.push({ lead, reason: `Duplikat eines offenen Leads: "${match.candidateName}" (Score ${match.score.toFixed(3)})` });
    } else {
      kept.push(lead);
      keptCandidates.push(toCandidate(lead.source_id ?? lead.id, 'open_lead', lead.name, normalizeName(lead.name) || null, lead.lat, lead.lng));
    }
  }
  console.log(`Phase A (Cluster unter offenen Leads): ${dismissals.length} Duplikate, ${kept.length} weiter`);

  // --- Phase B: dedup against known_places + published places ---
  const openSourceIds = new Set(leads.map((l) => l.source_id).filter((s): s is string => !!s));
  const byCity = new Map<string, Lead[]>();
  for (const lead of kept) {
    const key = lead.city_id ?? 'unknown';
    byCity.set(key, [...(byCity.get(key) ?? []), lead]);
  }

  const survivors: Lead[] = [];
  for (const [cityId, cityLeads] of byCity) {
    if (cityId === 'unknown') {
      survivors.push(...cityLeads);
      continue;
    }
    const stock = await fetchStockCandidates(cityId, openSourceIds);
    console.log(`Phase B: ${stock.length} Bestands-Kandidaten für City ${cityId}`);
    for (const lead of cityLeads) {
      if (!lead.name) {
        survivors.push(lead);
        continue;
      }
      const match = findBestMatch(lead.name, stock, { lat: lead.lat, lng: lead.lng });
      if (match && match.matchType === 'name') {
        const target = match.candidateSource === 'portal' ? 'veröffentlichtem Place' : 'bekanntem Place';
        dismissals.push({ lead, reason: `Duplikat von ${target} "${match.candidateName}" (Score ${match.score.toFixed(3)})` });
      } else if (match) {
        annotations.push({
          lead,
          suspect: {
            name: match.candidateName,
            source: match.candidateSource,
            score: Number(match.score.toFixed(3)),
            distance_m: match.distanceM != null ? Math.round(match.distanceM) : null,
          },
        });
        survivors.push(lead);
      } else {
        survivors.push(lead);
      }
    }
  }
  const phaseBDismissed = dismissals.length - (leads.length - kept.length);
  console.log(`Phase B (gegen Bestand): ${phaseBDismissed} Duplikate, ${annotations.length} Geo-Verdachtsfälle (nur markiert), ${survivors.length} weiter`);

  // --- Phase C: rating enrichment (Enterprise, minimal mask, atomic budget) ---
  const needsRating = survivors.filter(
    (l) => l.source_id && (l.raw_data?.google_rating_count == null),
  );
  const budget = await getBudgetStatus(TOOL_SLUG, ENTERPRISE_SKU);
  console.log(`Phase C: ${needsRating.length} Leads ohne Rating-Daten. Enterprise-Budget: ${budget.callsUsed}/${budget.callsSafety} (${budget.remaining} frei)`);

  let enriched = 0;
  let enrichFailed = 0;
  let budgetExhausted = false;
  const ratingById = new Map<string, { rating?: number; count?: number; status?: string }>();

  if (!dryRun) {
    for (const lead of needsRating) {
      const reserved = await reserveBudget(TOOL_SLUG, ENTERPRISE_SKU);
      if (!reserved) {
        budgetExhausted = true;
        console.log(`  Enterprise-Budget erschöpft nach ${enriched} Calls — Rest bleibt unbewertet.`);
        break;
      }
      try {
        const detail = await getPlaceRatingEnterprise(lead.source_id!);
        ratingById.set(lead.id, {
          rating: detail.rating,
          count: detail.userRatingCount,
          status: detail.businessStatus,
        });
        enriched++;
      } catch (err) {
        await releaseBudget(TOOL_SLUG, ENTERPRISE_SKU);
        enrichFailed++;
        console.error(`  Rating-Fetch fehlgeschlagen für ${lead.source_id}: ${err instanceof Error ? err.message : err}`);
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  } else {
    console.log(`  [DRY RUN] Würde ${Math.min(needsRating.length, budget.remaining)} Enterprise-Calls machen (0€, innerhalb Free-Cap).`);
  }

  // --- Phase D: newness gate on all survivors with rating data ---
  const finalKept: Lead[] = [];
  for (const lead of survivors) {
    const fetched = ratingById.get(lead.id);
    const count = fetched?.count ?? (lead.raw_data?.google_rating_count as number | undefined);
    const status = fetched?.status ?? (lead.raw_data?.google_business_status as string | undefined);

    if (status === 'CLOSED_PERMANENTLY') {
      dismissals.push({ lead, reason: 'Google meldet CLOSED_PERMANENTLY' });
    } else if (count != null && count > MAX_REVIEWS) {
      dismissals.push({ lead, reason: `Etablierter Laden: ${count} Google-Reviews (>${MAX_REVIEWS})` });
    } else {
      finalKept.push(lead);
    }
  }
  const phaseDDismissed = survivors.length - finalKept.length;
  console.log(`Phase D (Newness-Gate >${MAX_REVIEWS} Reviews / geschlossen): ${phaseDDismissed} aussortiert`);

  // --- Apply ---
  console.log('\n--- Triage-Zusammenfassung ---');
  console.log(`Offen vorher:        ${leads.length}`);
  console.log(`Dismissed gesamt:    ${dismissals.length}`);
  console.log(`Geo-Verdacht (Flag): ${annotations.length}`);
  console.log(`Rating nachgeladen:  ${enriched}${enrichFailed ? ` (${enrichFailed} Fehler)` : ''}${budgetExhausted ? ' — Budget-Stopp' : ''}`);
  console.log(`Bleiben offen:       ${finalKept.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Keine Änderungen geschrieben. Dismissals wären:');
    for (const d of dismissals) console.log(`  ✗ "${d.lead.name}" — ${d.reason}`);
    for (const a of annotations) console.log(`  ⚑ "${a.lead.name}" ≈ "${a.suspect.name}" (${a.suspect.score}, ${a.suspect.distance_m ?? '?'}m)`);
    return;
  }

  const now = new Date().toISOString();
  let updateErrors = 0;

  const CONCURRENCY = 10;
  async function runBatch<T>(items: T[], fn: (item: T) => PromiseLike<{ error: unknown }>) {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((item) => fn(item)));
      updateErrors += results.filter((r) => r.error).length;
    }
  }

  await runBatch(dismissals, ({ lead, reason }) => {
    const fetched = ratingById.get(lead.id);
    const rawData = fetched
      ? { ...(lead.raw_data ?? {}), google_rating: fetched.rating, google_rating_count: fetched.count, google_business_status: fetched.status, rating_enriched_at: now }
      : lead.raw_data;
    return db
      .from('pipeline_leads')
      .update({ status: 'dismissed', notes: appendNote(lead.notes, reason), reviewed_at: now, updated_at: now, raw_data: rawData })
      .eq('id', lead.id)
      .eq('status', 'new')
      ;
  });

  await runBatch(annotations, ({ lead, suspect }) => {
    const fetched = ratingById.get(lead.id);
    const rawData = {
      ...(lead.raw_data ?? {}),
      suspected_duplicate: suspect,
      ...(fetched ? { google_rating: fetched.rating, google_rating_count: fetched.count, google_business_status: fetched.status, rating_enriched_at: now } : {}),
    };
    return db
      .from('pipeline_leads')
      .update({ notes: appendNote(lead.notes, `Geo-Verdacht: evtl. Duplikat von "${suspect.name}" (${suspect.score}, ${suspect.distance_m ?? '?'}m)`), raw_data: rawData, updated_at: now })
      .eq('id', lead.id)
      ;
  });

  // Persist enrichment for kept leads that weren't annotated
  const annotatedIds = new Set(annotations.map((a) => a.lead.id));
  const enrichedKept = finalKept.filter((l) => ratingById.has(l.id) && !annotatedIds.has(l.id));
  await runBatch(enrichedKept, (lead) => {
    const fetched = ratingById.get(lead.id)!;
    const rawData = { ...(lead.raw_data ?? {}), google_rating: fetched.rating, google_rating_count: fetched.count, google_business_status: fetched.status, rating_enriched_at: now };
    return db
      .from('pipeline_leads')
      .update({ raw_data: rawData, updated_at: now })
      .eq('id', lead.id)
      ;
  });

  console.log(`\nÄnderungen geschrieben${updateErrors ? ` — ${updateErrors} Update-Fehler!` : ' — ohne Fehler.'}`);
  if (budgetExhausted) {
    console.log('Hinweis: Enterprise-Budget erschöpft — Script nächsten Monat erneut laufen lassen für die restlichen Ratings.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
