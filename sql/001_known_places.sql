-- ============================================
-- known_places – Delta Store für Discovery Tools
-- Manuell in Supabase SQL Editor ausführen!
-- ============================================

CREATE TABLE IF NOT EXISTS known_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source lead_source NOT NULL,       -- uses lead_source enum for type safety
  source_id TEXT NOT NULL,           -- Google Place ID, OSM Node ID, etc.
  city TEXT NOT NULL DEFAULT 'Hoi An', -- Legacy: wird noch von RPC get_known_places_stats genutzt
  city_id UUID NOT NULL REFERENCES cities(id), -- FK für City-Filter
  h3_cell TEXT,                      -- H3 Cell ID wo gefunden
  name TEXT,                         -- Name zum Zeitpunkt der Entdeckung
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  pushed_to_pipeline BOOLEAN DEFAULT FALSE,
  pipeline_lead_id UUID REFERENCES pipeline_leads(id) ON DELETE SET NULL,

  UNIQUE(source, source_id)          -- Keine Duplikate pro Quelle
);

-- Indexes für schnelle Lookups
-- Note: (source, source_id) is already indexed by the UNIQUE constraint above
CREATE INDEX IF NOT EXISTS idx_known_places_city ON known_places(city);
CREATE INDEX IF NOT EXISTS idx_known_places_city_id ON known_places(city_id);
CREATE INDEX IF NOT EXISTS idx_known_places_first_seen ON known_places(first_seen);
CREATE INDEX IF NOT EXISTS idx_known_places_pipeline_lead
  ON known_places(pipeline_lead_id) WHERE pipeline_lead_id IS NOT NULL;

-- RLS aktivieren (nur Service Role Key hat Zugriff)
ALTER TABLE known_places ENABLE ROW LEVEL SECURITY;

-- Service Role darf alles (idempotent: drop first, then create)
DROP POLICY IF EXISTS "Service role full access on known_places" ON known_places;
CREATE POLICY "Service role full access on known_places"
  ON known_places FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
