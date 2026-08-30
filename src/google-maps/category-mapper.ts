import type { CategoryGuess } from '../shared/types.js';

// Google Places types → our 4 categories
const TYPE_MAPPING: Record<string, CategoryGuess> = {
  // Restaurants
  restaurant: 'restaurants',
  meal_delivery: 'restaurants',
  meal_takeaway: 'restaurants',
  food: 'restaurants',
  bakery: 'restaurants',
  steak_house: 'restaurants',
  seafood_restaurant: 'restaurants',
  pizza_restaurant: 'restaurants',
  sushi_restaurant: 'restaurants',
  vietnamese_restaurant: 'restaurants',
  italian_restaurant: 'restaurants',
  japanese_restaurant: 'restaurants',
  korean_restaurant: 'restaurants',
  indian_restaurant: 'restaurants',
  thai_restaurant: 'restaurants',
  chinese_restaurant: 'restaurants',
  mexican_restaurant: 'restaurants',
  american_restaurant: 'restaurants',
  french_restaurant: 'restaurants',
  vegan_restaurant: 'restaurants',
  vegetarian_restaurant: 'restaurants',
  brunch_restaurant: 'restaurants',
  breakfast_restaurant: 'restaurants',
  ramen_restaurant: 'restaurants',
  hamburger_restaurant: 'restaurants',
  sandwich_shop: 'restaurants',
  ice_cream_shop: 'restaurants',

  // Bars
  bar: 'bars',
  night_club: 'bars',
  pub: 'bars',
  wine_bar: 'bars',
  cocktail_bar: 'bars',
  beer_hall: 'bars',
  beer_garden: 'bars',

  // Cafes
  cafe: 'cafes',
  coffee_shop: 'cafes',
  tea_house: 'cafes',
  espresso_bar: 'cafes',

  // Hotels
  lodging: 'hotels',
  hotel: 'hotels',
  motel: 'hotels',
  resort_hotel: 'hotels',
  guest_house: 'hotels',
  hostel: 'hotels',
  bed_and_breakfast: 'hotels',
  cottage: 'hotels',
  extended_stay_hotel: 'hotels',
  farmstay: 'hotels',
  private_guest_room: 'hotels',
  rv_park: 'hotels',
  campground: 'hotels',
};

/**
 * Map a Google Places types array to our category.
 * Returns the first match (types are ordered by relevance).
 */
export function mapCategory(types?: string[]): CategoryGuess | null {
  if (!types) return null;
  for (const type of types) {
    if (TYPE_MAPPING[type]) return TYPE_MAPPING[type];
  }
  return null;
}

/**
 * Map a single Google primaryType to our category.
 */
export function mapCategoryFromPrimaryType(
  primaryType?: string,
): CategoryGuess | null {
  if (!primaryType) return null;
  return TYPE_MAPPING[primaryType] || null;
}
