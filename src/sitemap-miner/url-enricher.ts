import type { SitemapEntry, SitemapSourceConfig, EnrichedEntry } from './types.js';

// TripAdvisor URL patterns:
// Restaurant: /Restaurant_Review-g298082-d25123456-Reviews-Lotus_Kitchen-Hoi_An.html
// Hotel:      /Hotel_Review-g298082-d25123456-Reviews-Sunrise_Hotel-Hoi_An.html

const RESTAURANT_PATTERN = /Restaurant_Review-g(\d+)-d(\d+)-Reviews-(.+?)-[^/]+\.html/;
const HOTEL_PATTERN = /Hotel_Review-g(\d+)-d(\d+)-Reviews-(.+?)-[^/]+\.html/;

function cleanSlug(slug: string): string {
  return slug.replace(/_/g, ' ').trim();
}

function enrichUrl(entry: SitemapEntry, config: SitemapSourceConfig): EnrichedEntry {
  const url = entry.loc;

  // Try restaurant pattern
  const restaurantMatch = url.match(RESTAURANT_PATTERN);
  if (restaurantMatch) {
    const [, , reviewId, nameSlug] = restaurantMatch;
    return {
      url,
      platform: 'tripadvisor',
      city: config.city,
      citySlug: config.citySlug,
      category: 'restaurants',
      name: cleanSlug(nameSlug),
      platformId: `d${reviewId}`,
    };
  }

  // Try hotel pattern
  const hotelMatch = url.match(HOTEL_PATTERN);
  if (hotelMatch) {
    const [, , reviewId, nameSlug] = hotelMatch;
    return {
      url,
      platform: 'tripadvisor',
      city: config.city,
      citySlug: config.citySlug,
      category: 'hotels',
      name: cleanSlug(nameSlug),
      platformId: `d${reviewId}`,
    };
  }

  // Fallback: use config category, no name extraction possible
  return {
    url,
    platform: 'tripadvisor',
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
