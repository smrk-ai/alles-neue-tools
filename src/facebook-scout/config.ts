// Facebook Place Search Queries (mapped to our 4 categories)
export const SEARCH_QUERIES: Record<string, string[]> = {
  restaurants: ['restaurant', 'food', 'dining'],
  cafes: ['cafe', 'coffee', 'bakery'],
  bars: ['bar', 'pub', 'cocktail'],
  hotels: ['hotel', 'hostel', 'resort', 'guesthouse'],
};

// Place Search fields to request
export const PLACE_FIELDS = [
  'id',
  'name',
  'location',
  'phone',
  'website',
  'hours',
  'category',
  'category_list',
  'link',
  'fan_count',
  'single_line_address',
  'about',
  'emails',
].join(',');

// Default search distance in meters
// 5km covers all of Hoi An from a single center point
export const DEFAULT_DISTANCE = 5000;

// Hoi An center coordinates
export const HOI_AN_CENTER = { lat: 15.8795, lng: 108.326 };
