import { XMLParser } from 'fast-xml-parser';
import { createLogger } from '../shared/logger.js';
import type { AlertFeedConfig, ParsedFeedItem } from './types.js';

const log = createLogger('google-alerts');

const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10_000;

// Google Alerts uses Atom (RFC 4287), not RSS 2.0.
// Key tags: <feed>, <entry>, <id>, <title>, <summary>, <published>, <link>
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (_tagName, jPath) => jPath === 'feed.entry',
  processEntities: false,
});

// --- URL Extraction ---

/**
 * Extract the actual destination URL from Google's redirect wrapper:
 * https://www.google.com/url?rct=j&sa=t&url=ACTUAL_URL&ct=...
 */
export function extractRealUrl(googleUrl: string): string {
  try {
    const parsed = new URL(googleUrl);
    const real = parsed.searchParams.get('url');
    if (real) {
      const realParsed = new URL(real);
      if (!['http:', 'https:'].includes(realParsed.protocol)) {
        return googleUrl;
      }
      return real;
    }
  } catch {
    // not a valid URL
  }
  return googleUrl;
}

// --- HTML Strip ---

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --- Internal Atom Entry shape ---

interface RawAtomEntry {
  id?: string;
  title?: string | { '#text': string };
  summary?: string | { '#text': string };
  content?: string | { '#text': string };
  published?: string;
  updated?: string;
  link?: { '@_href': string } | Array<{ '@_href': string; '@_rel'?: string }>;
  source?: { title?: string };
}

function resolveText(val: string | { '#text': string } | undefined): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  return val['#text'];
}

// --- Single Feed Parser ---

export async function parseFeed(feed: AlertFeedConfig): Promise<ParsedFeedItem[]> {
  if (!feed.rssUrl) {
    log.debug(`Skipping unconfigured feed: ${feed.label}`);
    return [];
  }

  let rawXml: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(feed.rssUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      log.warn(`Feed fetch failed (${res.status}): ${feed.label}`);
      return [];
    }
    rawXml = await res.text();
  } catch (err) {
    log.warn(`Feed fetch error: ${feed.label}`, { error: String(err) });
    return [];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(rawXml) as Record<string, unknown>;
  } catch (err) {
    log.warn(`Feed parse error: ${feed.label}`, { error: String(err) });
    return [];
  }

  const feedRoot = parsed['feed'] as Record<string, unknown> | undefined;
  if (!feedRoot) {
    log.debug(`Feed returned no <feed> root: ${feed.label}`);
    return [];
  }

  const entries = feedRoot['entry'] as RawAtomEntry[] | undefined;
  if (!entries || entries.length === 0) {
    log.debug(`Feed has no entries: ${feed.label}`);
    return [];
  }

  const items: ParsedFeedItem[] = [];
  for (const entry of entries) {
    const item = parseEntry(entry, feed);
    if (item) items.push(item);
  }

  log.info(`Fetched ${items.length} items from: ${feed.label}`);
  return items;
}

function parseEntry(entry: RawAtomEntry, feed: AlertFeedConfig): ParsedFeedItem | null {
  const guid = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!guid) return null;

  const title = stripHtml(resolveText(entry.title) ?? '');
  const summaryHtml = resolveText(entry.summary) ?? resolveText(entry.content) ?? '';
  const snippet = stripHtml(summaryHtml);

  // <link> can be a single object or array in Atom
  const rawLink = Array.isArray(entry.link)
    ? (entry.link.find((l) => l['@_rel'] === 'alternate') ?? entry.link[0])?.['@_href']
    : entry.link?.['@_href'];

  const googleRedirectUrl = rawLink ?? guid;
  const realUrl = extractRealUrl(googleRedirectUrl);

  const publishedAt = entry.published ?? entry.updated ?? new Date().toISOString();
  const sourceTitle = typeof entry.source?.title === 'string' ? entry.source.title : undefined;

  return {
    guid,
    title,
    snippet,
    realUrl,
    feedId: feed.id,
    citySlug: feed.citySlug,
    cityName: feed.city,
    categoryHint: feed.categoryHint,
    publishedAt: String(publishedAt),
    sourceTitle,
  };
}

// --- Parallel Feed Fetcher ---

export async function fetchAllFeeds(feeds: AlertFeedConfig[]): Promise<ParsedFeedItem[]> {
  const allItems: ParsedFeedItem[] = [];

  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    const batch = feeds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(parseFeed));
    for (const items of batchResults) {
      allItems.push(...items);
    }
  }

  // Deduplicate by realUrl — same article from different feeds should only appear once.
  // Keep the first occurrence (preserves feed/city assignment from the most specific feed).
  const seen = new Set<string>();
  const deduped: ParsedFeedItem[] = [];
  for (const item of allItems) {
    if (!seen.has(item.realUrl)) {
      seen.add(item.realUrl);
      deduped.push(item);
    }
  }

  if (deduped.length < allItems.length) {
    log.info(`URL dedup: ${allItems.length} → ${deduped.length} (removed ${allItems.length - deduped.length} cross-feed duplicates)`);
  }

  return deduped;
}
