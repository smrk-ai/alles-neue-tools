import { errorToString } from '../shared/utils.js';
import { gunzipSync } from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '../shared/logger.js';
import type { SitemapSourceConfig, SitemapEntry } from './types.js';

const log = createLogger('sitemap-miner');

const FETCH_TIMEOUT_MS = 60_000;
const SUB_SITEMAP_CONCURRENCY = 5;
const USER_AGENT = 'AllesNeueTools/1.0 (Sitemap Crawler; +https://newaround.com)';

// XML parser for sitemap index: <sitemapindex><sitemap><loc>...</loc></sitemap></sitemapindex>
const indexParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (_tagName, jPath) =>
    jPath === 'sitemapindex.sitemap',
  processEntities: false,
});

// XML parser for urlset: <urlset><url><loc>...</loc><lastmod>...</lastmod></url></urlset>
const urlsetParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (_tagName, jPath) =>
    jPath === 'urlset.url',
  processEntities: false,
});

// --- Internal types for raw XML shapes ---

interface RawSitemapIndexEntry {
  loc?: string;
  lastmod?: string;
}

interface RawUrlEntry {
  loc?: string;
  lastmod?: string;
}

// --- Sub-sitemap cache (avoids re-downloading shared files) ---

const fetchCache = new Map<string, string>();

// --- Fetch helper ---

async function fetchXml(url: string): Promise<string | null> {
  // Check cache first (Booking.com Hoi An + Da Nang share the same sub-sitemaps)
  const cached = fetchCache.get(url);
  if (cached) {
    log.debug(`Cache hit: ${url}`);
    return cached;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn(`Fetch failed (${res.status}): ${url}`);
      return null;
    }

    let xml: string;
    if (url.endsWith('.gz')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      xml = gunzipSync(buffer).toString('utf-8');
    } else {
      xml = await res.text();
    }

    fetchCache.set(url, xml);
    return xml;
  } catch (err) {
    log.warn(`Fetch error: ${url}`, { error: errorToString(err) });
    return null;
  }
}

// --- Step 1: Fetch and parse the sitemap index ---

async function fetchSitemapIndex(indexUrl: string): Promise<string[]> {
  log.info(`Fetching sitemap index: ${indexUrl}`);
  const xml = await fetchXml(indexUrl);
  if (!xml) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = indexParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    log.error(`Failed to parse sitemap index XML`, { error: errorToString(err) });
    return [];
  }

  const root = parsed['sitemapindex'] as Record<string, unknown> | undefined;
  if (!root) {
    log.warn(`No <sitemapindex> root found in index`);
    return [];
  }

  const entries = root['sitemap'] as RawSitemapIndexEntry[] | undefined;
  if (!entries || entries.length === 0) {
    log.warn(`Sitemap index has no <sitemap> entries`);
    return [];
  }

  const urls = entries
    .map((e) => e.loc)
    .filter((loc): loc is string => typeof loc === 'string' && loc.length > 0);

  log.info(`Sitemap index contains ${urls.length} sub-sitemaps`);
  return urls;
}

// --- Step 2: Fetch and parse a single sub-sitemap ---

async function fetchSubSitemap(url: string, urlPattern: RegExp): Promise<SitemapEntry[]> {
  const xml = await fetchXml(url);
  if (!xml) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = urlsetParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    log.warn(`Failed to parse sub-sitemap XML: ${url}`, { error: errorToString(err) });
    return [];
  }

  const root = parsed['urlset'] as Record<string, unknown> | undefined;
  if (!root) {
    log.debug(`No <urlset> root in: ${url}`);
    return [];
  }

  const rawUrls = root['url'] as RawUrlEntry[] | undefined;
  if (!rawUrls || rawUrls.length === 0) {
    log.debug(`No <url> entries in: ${url}`);
    return [];
  }

  // Filter to only matching URLs
  const entries: SitemapEntry[] = [];
  for (const raw of rawUrls) {
    if (!raw.loc || typeof raw.loc !== 'string') continue;
    if (!urlPattern.test(raw.loc)) continue;

    entries.push({
      loc: raw.loc,
      lastmod: typeof raw.lastmod === 'string' ? raw.lastmod : undefined,
    });
  }

  return entries;
}

// --- Main: Fetch all relevant URLs for a source config ---

export async function fetchSitemapEntries(
  sourceConfig: SitemapSourceConfig,
): Promise<SitemapEntry[]> {
  // Step 1: Get all sub-sitemap URLs from the index
  const allSubSitemapUrls = await fetchSitemapIndex(sourceConfig.sitemapIndexUrl);

  // Step 2: Filter to relevant sub-sitemaps
  const relevantUrls = allSubSitemapUrls.filter((url) =>
    sourceConfig.subSitemapPattern.test(url),
  );

  log.info(
    `Found ${relevantUrls.length}/${allSubSitemapUrls.length} relevant sub-sitemaps for: ${sourceConfig.id}`,
  );

  if (relevantUrls.length === 0) return [];

  // Step 3: Fetch sub-sitemaps in parallel batches
  const allEntries: SitemapEntry[] = [];

  for (let i = 0; i < relevantUrls.length; i += SUB_SITEMAP_CONCURRENCY) {
    const batch = relevantUrls.slice(i, i + SUB_SITEMAP_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((url) => fetchSubSitemap(url, sourceConfig.urlPattern)),
    );

    for (const entries of batchResults) {
      allEntries.push(...entries);
    }

    // Log progress for large sitemap sets (e.g. Agoda with 132 sub-sitemaps)
    if (relevantUrls.length > 10 && (i + SUB_SITEMAP_CONCURRENCY) % 20 === 0) {
      log.info(`Progress: ${Math.min(i + SUB_SITEMAP_CONCURRENCY, relevantUrls.length)}/${relevantUrls.length} sub-sitemaps fetched (${allEntries.length} matches so far)`);
    }
  }

  log.info(`Total matching URLs for ${sourceConfig.id}: ${allEntries.length}`);
  return allEntries;
}
