-- ============================================
-- known_places – Delta Store für Discovery Tools
-- Manuell in Supabase SQL Editor ausführen!
-- ============================================

CREATE TABLE IF NOT EXISTS known_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,              -- 'google_maps', 'osm', 'foursquare', etc.
  source_id TEXT NOT NULL,           -- Google Place ID, OSM Node ID, etc.
  city TEXT NOT NULL DEFAULT 'Hoi An',
  h3_cell TEXT,                      -- H3 Cell ID wo gefunden
  name TEXT,                         -- Name zum Zeitpunkt der Entdeckung
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  pushed_to_pipeline BOOLEAN DEFAULT FALSE,
  pipeline_lead_id UUID REFERENCES pipeline_leads(id),

  UNIQUE(source, source_id)          -- Keine Duplikate pro Quelle
);

-- Indexes für schnelle Lookups
CREATE INDEX idx_known_places_source_id ON known_places(source, source_id);
CREATE INDEX idx_known_places_city ON known_places(city);
CREATE INDEX idx_known_places_first_seen ON known_places(first_seen);

-- RLS aktivieren (nur Service Role Key hat Zugriff)
ALTER TABLE known_places ENABLE ROW LEVEL SECURITY;

-- Service Role darf alles
CREATE POLICY "Service role full access on known_places"
  ON known_places FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
