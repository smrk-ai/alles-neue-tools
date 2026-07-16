import distance from '@turf/distance';

/**
 * Great-circle distance between two coordinates, in meters.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return distance([lng1, lat1], [lng2, lat2], { units: 'meters' });
}
