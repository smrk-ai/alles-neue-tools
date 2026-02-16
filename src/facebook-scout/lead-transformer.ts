import type { PipelineLeadInput, CategoryGuess } from '../shared/types.js';
import type { FacebookPlace } from './types.js';

// --- Category Mapping ---

export function mapFacebookCategory(
  place: FacebookPlace,
): CategoryGuess | null {
  // Try category_list first (more structured)
  if (place.category_list?.length) {
    for (const cat of place.category_list) {
      const mapped = mapSingleCategory(cat.name);
      if (mapped) return mapped;
    }
  }

  // Fall back to category string
  if (place.category) {
    return mapSingleCategory(place.category);
  }

  return null;
}

function mapSingleCategory(category: string): CategoryGuess | null {
  const lower = category.toLowerCase();

  if (
    /restaurant|food|pizza|sushi|vietnamese|asian|italian|french|dining|bbq|grill|seafood|noodle|pho/.test(
      lower,
    )
  )
    return 'restaurants';

  if (/coffee|cafe|café|tea|bakery|dessert|pastry|brunch/.test(lower))
    return 'cafes';

  if (/bar|pub|lounge|cocktail|night|club|beer|wine/.test(lower))
    return 'bars';

  if (
    /hotel|resort|hostel|motel|guest|lodge|boutique|accommodation|homestay|villa/.test(
      lower,
    )
  )
    return 'hotels';

  return null;
}

// --- Lead Transformer ---

export function transformToLead(
  place: FacebookPlace,
  meta: { city: string; scanDate: string },
): PipelineLeadInput {
  return {
    source: 'facebook',
    source_id: place.id,
    source_url: place.link || `https://www.facebook.com/${place.id}`,
    name: place.name || null,
    address: place.single_line_address || place.location?.street || null,
    city: meta.city,
    category_guess: mapFacebookCategory(place),
    phone: place.phone || null,
    website: place.website || null,
    facebook: place.link || `https://www.facebook.com/${place.id}`,
    raw_data: {
      fb_place_id: place.id,
      fb_category: place.category,
      fb_category_list: place.category_list,
      fb_fan_count: place.fan_count,
      fb_about: place.about,
      fb_hours: place.hours,
      fb_emails: place.emails,
      fb_location: place.location,
      discovery: {
        method: 'facebook_place_search',
        scan_date: meta.scanDate,
      },
    },
  };
}
