-- ============================================
-- api_budget_usage – API Budget Tracking
-- Historisch auswertbar: 1 Zeile pro Tool x SKU x Monat
-- Manuell in Supabase SQL Editor ausführen!
-- ============================================

CREATE TABLE IF NOT EXISTS api_budget_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Was wird getrackt
  tool_slug TEXT NOT NULL,               -- z.B. 'google-maps'
  sku TEXT NOT NULL,                      -- z.B. 'place_details_pro', 'place_details_essentials'
  month TEXT NOT NULL,                    -- Format: '2026-03' (Kalendermonat, Google-Billing-Zyklus)

  -- Zaehler
  calls_used INTEGER NOT NULL DEFAULT 0, -- Aktuelle Calls in diesem Monat
  calls_limit INTEGER NOT NULL,          -- Free-Tier-Limit (z.B. 5000)
  calls_safety INTEGER NOT NULL,         -- Safety Margin (z.B. 4500 = 90% von 5000)

  -- Kosten-Info (fuer historische Auswertung)
  cost_per_call NUMERIC(10, 5) DEFAULT 0, -- Kosten pro Call ueber Free Tier (z.B. 0.032)
  estimated_cost NUMERIC(10, 2) DEFAULT 0, -- Geschaetzte Kosten ueber Free Tier

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 1 Zeile pro Tool x SKU x Monat
  UNIQUE(tool_slug, sku, month)
);

-- Index fuer schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_api_budget_month ON api_budget_usage(month);
CREATE INDEX IF NOT EXISTS idx_api_budget_tool ON api_budget_usage(tool_slug, month);

-- RLS
ALTER TABLE api_budget_usage ENABLE ROW LEVEL SECURITY;

-- Service Role darf alles
DROP POLICY IF EXISTS "Service role full access on api_budget_usage" ON api_budget_usage;
CREATE POLICY "Service role full access on api_budget_usage"
  ON api_budget_usage FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Anon (Admin Dashboard) darf lesen
DROP POLICY IF EXISTS "Anon read access on api_budget_usage" ON api_budget_usage;
CREATE POLICY "Anon read access on api_budget_usage"
  ON api_budget_usage FOR SELECT
  TO anon
  USING (true);
