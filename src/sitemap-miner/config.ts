import type { SitemapSourceConfig } from './types.js';

// TripAdvisor Location IDs:
// g298082 = Hoi An
// g298085 = Da Nang

const SITEMAP_SOURCES: SitemapSourceConfig[] = [
  // === HOI AN ===
  {
    id: 'ta-hoi-an-restaurants',
    platform: 'tripadvisor',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    category: 'restaurants',
    sitemapIndexUrl: 'https://www.tripadvisor.com/sitemap/2/en_US/sitemap_en_US_index.xml',
    subSitemapPattern: /restaurant/i,
    urlPattern: /Restaurant_Review-g298082/,
    locationId: 'g298082',
  },
  {
    id: 'ta-hoi-an-hotels',
    platform: 'tripadvisor',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    category: 'hotels',
    sitemapIndexUrl: 'https://www.tripadvisor.com/sitemap/2/en_US/sitemap_en_US_index.xml',
    subSitemapPattern: /hotel/i,
    urlPattern: /Hotel_Review-g298082/,
    locationId: 'g298082',
  },
  // === DA NANG ===
  {
    id: 'ta-da-nang-restaurants',
    platform: 'tripadvisor',
    city: 'Da Nang',
    citySlug: 'da-nang',
    category: 'restaurants',
    sitemapIndexUrl: 'https://www.tripadvisor.com/sitemap/2/en_US/sitemap_en_US_index.xml',
    subSitemapPattern: /restaurant/i,
    urlPattern: /Restaurant_Review-g298085/,
    locationId: 'g298085',
  },
  {
    id: 'ta-da-nang-hotels',
    platform: 'tripadvisor',
    city: 'Da Nang',
    citySlug: 'da-nang',
    category: 'hotels',
    sitemapIndexUrl: 'https://www.tripadvisor.com/sitemap/2/en_US/sitemap_en_US_index.xml',
    subSitemapPattern: /hotel/i,
    urlPattern: /Hotel_Review-g298085/,
    locationId: 'g298085',
  },
];

export function getSourcesForCity(citySlug: string): SitemapSourceConfig[] {
  if (citySlug === 'all') return SITEMAP_SOURCES;
  return SITEMAP_SOURCES.filter((s) => s.citySlug === citySlug);
}

export function getSourceById(id: string): SitemapSourceConfig | undefined {
  return SITEMAP_SOURCES.find((s) => s.id === id);
}

export function getAllSources(): SitemapSourceConfig[] {
  return SITEMAP_SOURCES;
}
