import type { SitemapEntry, SitemapSourceConfig, EnrichedEntry } from './types.js';

// Booking.com: https://www.booking.com/hotel/vn/{hotel-slug}.html
const BOOKING_PATTERN = /booking\.com\/hotel\/vn\/([^.]+)\.html/;

// Agoda: https://www.agoda.com/{hotel-slug}/hotel/{city}-{country}.html
const AGODA_PATTERN = /agoda\.com\/([^/]+)\/hotel\/([^.]+)\.html/;

function toTitleCase(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function enrichUrl(entry: SitemapEntry, config: SitemapSourceConfig): EnrichedEntry {
  const url = entry.loc;

  // Booking.com
  const bookingMatch = url.match(BOOKING_PATTERN);
  if (bookingMatch) {
    const [, hotelSlug] = bookingMatch;
    return {
      url,
      platform: 'booking',
      city: config.city,
      citySlug: config.citySlug,
      category: config.category,
      name: toTitleCase(hotelSlug),
      platformId: hotelSlug,
    };
  }

  // Agoda
  const agodaMatch = url.match(AGODA_PATTERN);
  if (agodaMatch) {
    const [, hotelSlug] = agodaMatch;
    return {
      url,
      platform: 'agoda',
      city: config.city,
      citySlug: config.citySlug,
      category: config.category,
      name: toTitleCase(hotelSlug),
      platformId: hotelSlug,
    };
  }

  // Fallback: use config values, no name extraction
  return {
    url,
    platform: config.platform,
    city: config.city,
    citySlug: config.citySlug,
    category: config.category,
    name: null,
    platformId: null,
  };
}

export function enrichEntries(
  entries: SitemapEntry[],
  config: SitemapSourceConfig,
): EnrichedEntry[] {
  return entries.map((e) => enrichUrl(e, config));
}
