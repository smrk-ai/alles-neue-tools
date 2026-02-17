import type { WatchConfig } from './types.js';

// UUIDs werden nach dem Setup in changedetection.io eingetragen.
// 1. Docker starten: docker compose -f docker/docker-compose.changedetection.yml up -d
// 2. http://localhost:5000 oeffnen → Watches erstellen
// 3. UUID aus URL-Leiste kopieren → hier eintragen

export const WATCH_CONFIGS: WatchConfig[] = [
  // === TRIPADVISOR ===
  {
    uuid: '', // ← Nach Setup eintragen
    id: 'tripadvisor-restaurants-hoian',
    label: 'TripAdvisor Restaurants Hoi An',
    url: 'https://www.tripadvisor.com/Restaurants-g298082-Hoi_An_Quang_Nam_Province_Central_Vietnam.html',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    categoryHint: 'restaurants',
    leadSource: 'tripadvisor',
    parser: 'tripadvisor_listing',
    checkIntervalHours: 6,
  },
  {
    uuid: '',
    id: 'tripadvisor-hotels-hoian',
    label: 'TripAdvisor Hotels Hoi An',
    url: 'https://www.tripadvisor.com/Hotels-g298082-Hoi_An_Quang_Nam_Province_Central_Vietnam-Hotels.html',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    categoryHint: 'hotels',
    leadSource: 'tripadvisor',
    parser: 'tripadvisor_listing',
    checkIntervalHours: 6,
  },

  // === FOODY.VN ===
  {
    uuid: '',
    id: 'foody-restaurants-hoian',
    label: 'Foody.vn Hoi An Restaurants (Newest)',
    url: 'https://www.foody.vn/hoi-an/an-uong?CategoryGroup=food&o=2',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    categoryHint: 'restaurants',
    leadSource: 'foody',
    parser: 'foody_listing',
    checkIntervalHours: 4,
  },
  {
    uuid: '',
    id: 'foody-cafes-hoian',
    label: 'Foody.vn Hoi An Cafes (Newest)',
    url: 'https://www.foody.vn/hoi-an/cafe-tiem-banh?o=2',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    categoryHint: 'cafes',
    leadSource: 'foody',
    parser: 'foody_listing',
    checkIntervalHours: 4,
  },
  {
    uuid: '',
    id: 'foody-bars-hoian',
    label: 'Foody.vn Hoi An Bars (Newest)',
    url: 'https://www.foody.vn/hoi-an/bar-pub?o=2',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    categoryHint: 'bars',
    leadSource: 'foody',
    parser: 'foody_listing',
    checkIntervalHours: 4,
  },

  // === BOOKING.COM ===
  {
    uuid: '',
    id: 'booking-hotels-hoian',
    label: 'Booking.com Hoi An',
    url: 'https://www.booking.com/searchresults.html?ss=Hoi+An&order=date_a',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    categoryHint: 'hotels',
    leadSource: 'other',
    parser: 'booking_listing',
    checkIntervalHours: 12,
  },

  // === JOB PORTALE ===
  {
    uuid: '',
    id: 'vietnamworks-fb-quangnam',
    label: 'VietnamWorks F&B Jobs Quang Nam',
    url: 'https://www.vietnamworks.com/tim-viec-lam/nha-hang-khach-san-du-lich?q=&l=71',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    leadSource: 'job_posting',
    parser: 'job_listing',
    checkIntervalHours: 12,
  },
  {
    uuid: '',
    id: 'topcv-fb-quangnam',
    label: 'TopCV F&B Jobs Quang Nam',
    url: 'https://www.topcv.vn/viec-lam-nha-hang-khach-san-du-lich-tai-quang-nam',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    leadSource: 'job_posting',
    parser: 'job_listing',
    checkIntervalHours: 12,
  },

  // === GEWERBERAUM-PORTALE ===
  {
    uuid: '',
    id: 'cvr-commercial-hoian',
    label: 'CVR Commercial Spaces Hoi An',
    url: 'https://cvr.com.vn/for-rent/hoi-an/',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    leadSource: 'other',
    parser: 'commercial_listing',
    checkIntervalHours: 24,
  },
  {
    uuid: '',
    id: 'dotproperty-commercial-hoian',
    label: 'DotProperty Commercial Hoi An',
    url: 'https://dotproperty.com.vn/for-rent/hoi-an',
    city: 'Hoi An',
    citySlug: 'hoi-an',
    leadSource: 'other',
    parser: 'commercial_listing',
    checkIntervalHours: 24,
  },
];

/**
 * Get configured watches for a city. Only returns watches with UUID set.
 */
export function getWatchesForCity(citySlug: string): WatchConfig[] {
  if (citySlug === 'all') return WATCH_CONFIGS.filter((w) => w.uuid);
  return WATCH_CONFIGS.filter((w) => w.citySlug === citySlug && w.uuid);
}

/**
 * Get a watch by its human-readable ID.
 */
export function getWatchById(id: string): WatchConfig | undefined {
  return WATCH_CONFIGS.find((w) => w.id === id);
}
