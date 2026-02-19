-- 002_tool_configs_seed.sql
-- Replace mock tool_configs with real tool definitions
-- Run: npx tsx scripts/seed-tool-configs.ts  OR  execute directly in Supabase SQL Editor

-- Step 1: Delete old mock entries (wrong slugs)
DELETE FROM tool_configs
WHERE slug IN ('facebook-scanner', 'instagram-tracker', 'google-maps-monitor');

-- Step 2: Upsert real tool configs (idempotent via slug)
INSERT INTO tool_configs (name, slug, description, source_type, is_active, config, schedule)
VALUES
  (
    'Google Maps Discovery',
    'google-maps',
    'Grid-basierter Scan neuer Businesses auf Google Maps via H3-Zellen und Places API',
    'google_maps',
    true,
    '{"cities":["hoi-an","da-nang"],"categories":["restaurant","cafe","bar","lodging"],"resolution":8}',
    '0 6 * * *'
  ),
  (
    'Facebook Places Scanner',
    'facebook-scout',
    'Findet neue Businesses via Facebook Graph API Place-Search im Umkreis der Stadt',
    'facebook',
    false,
    '{"cities":["hoi-an","da-nang"],"note":"Meta tokens expired - auskommentiert in .env"}',
    NULL
  ),
  (
    'Instagram Hashtag Monitor',
    'instagram-scout',
    'Überwacht lokale Hashtags auf Instagram für neue Business-Posts mit Confidence-Scoring',
    'instagram',
    false,
    '{"cities":["hoi-an"],"quotaPerWeek":30,"note":"Meta tokens expired - auskommentiert in .env"}',
    NULL
  ),
  (
    'Google Alerts Aggregator',
    'google-alerts',
    'Aggregiert 24 Google Alerts RSS-Feeds (EN+VI) für neue Restaurant/Cafe/Bar/Hotel Erwähnungen',
    'google_alert',
    true,
    '{"cities":["hoi-an","da-nang"],"minScore":8,"feedCount":24,"languages":["en","vi"]}',
    '0 */6 * * *'
  ),
  (
    'Booking/Agoda Sitemap Miner',
    'sitemap-miner',
    'Crawlt Sitemaps von Booking.com und Agoda für neue Hotel-Listings',
    'other',
    true,
    '{"cities":["hoi-an","da-nang"],"sources":["booking-hoi-an-hotels","booking-da-nang-hotels","agoda-hoi-an-hotels","agoda-da-nang-hotels"]}',
    '0 3 * * 0'
  ),
  (
    'OSM Changeset Monitor',
    'osm-monitor',
    'Überwacht OpenStreetMap-Änderungen via Overpass API für neue POIs in der Region',
    'other',
    true,
    '{"cities":["hoi-an","da-nang"],"lookbackDays":7,"onlyNew":false}',
    '0 4 * * 0'
  ),
  (
    'Website Change Monitor',
    'changedetection',
    'Überwacht 12 Websites (TripAdvisor, Foody, Booking, Job-Portale) via changedetection.io',
    'other',
    false,
    '{"cities":["hoi-an","da-nang"],"watches":12,"platforms":["tripadvisor","foody","booking","vietnamworks","topcv","cvr","dotproperty"],"note":"Docker changedetection.io Setup nötig"}',
    '0 5 * * *'
  ),
  (
    'Quick Manual Entry',
    'quick-entry',
    'CLI-Tool für schnellen manuellen Eintrag einzelner Businesses in die Pipeline',
    'manual',
    true,
    '{"type":"cli","command":"npm run q","interactive":true}',
    NULL
  ),
  (
    'Bulk JSON Import',
    'prompt-import',
    'CLI-Tool für Bulk-Import von Leads aus JSON-Dateien (z.B. LLM-Output)',
    'manual',
    true,
    '{"type":"cli","command":"npm run import","formats":["array","results","leads","data","strings"]}',
    NULL
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  source_type = EXCLUDED.source_type,
  is_active = EXCLUDED.is_active,
  config = EXCLUDED.config,
  schedule = EXCLUDED.schedule,
  updated_at = NOW();
