import type { SitemapSourceConfig } from './types.js';

const SITEMAP_SOURCES: SitemapSourceConfig[] = [
  // === BOOKING.COM ===
  {
    id: 'booking-hoi-an-hotels',
    platform: 'booking',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    category: 'hotels',
    sitemapIndexUrl: 'https://www.booking.com/sitembk-hotel-index.xml',
    subSitemapPattern: /sitembk-hotel-en-us\.00(69|70)\.xml\.gz/,
    urlPattern: /\/hotel\/vn\/.*(?:hoi-an|hoian)/i,
    gzip: true,
  },
  {
    id: 'booking-da-nang-hotels',
    platform: 'booking',
    city: 'Da Nang',
    citySlug: 'da-nang',
    category: 'hotels',
    sitemapIndexUrl: 'https://www.booking.com/sitembk-hotel-index.xml',
    subSitemapPattern: /sitembk-hotel-en-us\.00(69|70)\.xml\.gz/,
    urlPattern: /\/hotel\/vn\/.*(?:da-nang|danang)/i,
    gzip: true,
  },
  // === AGODA ===
  {
    id: 'agoda-hoi-an-hotels',
    platform: 'agoda',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    category: 'hotels',
    sitemapIndexUrl: 'https://www.agoda.com/sitemaps.xml',
    subSitemapPattern: /pagetype_7/,
    urlPattern: /\/hotel\/hoi-an-vn\.html/,
  },
  {
    id: 'agoda-da-nang-hotels',
    platform: 'agoda',
    city: 'Da Nang',
    citySlug: 'da-nang',
    category: 'hotels',
    sitemapIndexUrl: 'https://www.agoda.com/sitemaps.xml',
    subSitemapPattern: /pagetype_7/,
    urlPattern: /\/hotel\/da-nang-vn\.html/,
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
