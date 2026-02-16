import type { CityConfig } from './types.js';
import { getAllScanCells, generateScanCells, getHotspotCells, getCellCenter } from './h3-grid.js';

export const CITIES: Record<string, CityConfig> = {
  hoi_an: {
    name: 'Hoi An',
    slug: 'hoi-an',
    country: 'VN',
    boundary: [
      [108.310, 15.860], [108.360, 15.860],
      [108.360, 15.900], [108.310, 15.900],
      [108.310, 15.860],
    ],
    resolution: 8,
    categories: ['restaurant', 'cafe', 'bar', 'lodging'],
    hotspots: [
      {
        name: 'Altstadt',
        boundary: [
          [108.325, 15.875], [108.340, 15.875],
          [108.340, 15.885], [108.325, 15.885],
          [108.325, 15.875],
        ],
        resolution: 10,
      },
    ],
  },
  da_nang: {
    name: 'Da Nang',
    slug: 'da-nang',
    country: 'VN',
    boundary: [
      [108.150, 16.010], [108.250, 16.010],
      [108.250, 16.100], [108.150, 16.100],
      [108.150, 16.010],
    ],
    resolution: 8,
    categories: ['restaurant', 'cafe', 'bar', 'lodging'],
  },
};

export function getCityBySlug(slug: string): CityConfig | undefined {
  return Object.values(CITIES).find((c) => c.slug === slug);
}

// Self-test when run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ''))) {
  console.log('--- City Config Self-Test ---\n');

  for (const [key, city] of Object.entries(CITIES)) {
    const mainCells = generateScanCells(city);
    const allCells = getAllScanCells(city);
    const hotspotCount = allCells.length - mainCells.length + (city.hotspots?.length ? mainCells.length - allCells.length + allCells.length - mainCells.length : 0);

    console.log(`${city.name} (${key}):`);
    console.log(`  Main cells (res ${city.resolution}): ${mainCells.length}`);

    if (city.hotspots) {
      for (const hs of city.hotspots) {
        const hsCells = getHotspotCells(hs);
        console.log(`  Hotspot "${hs.name}" (res ${hs.resolution}): ${hsCells.length} cells`);
      }
    }

    console.log(`  Total scan points: ${allCells.length}`);

    // Show first few cell centers as sample
    const sample = allCells.slice(0, 3).map(getCellCenter);
    console.log(`  Sample centers: ${sample.map((c) => `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`).join(' | ')}`);
    console.log();
  }
}
