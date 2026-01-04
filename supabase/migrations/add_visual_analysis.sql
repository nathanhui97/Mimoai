-- Migration: Add Visual Analysis Tables
-- Phase 4: Human-like visual understanding support

-- Table: correction_memory
-- Stores user corrections with visual context for learning
CREATE TABLE IF NOT EXISTS correction_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- Original context
  original_selector TEXT NOT NULL,
  original_visual_context TEXT, -- Base64 screenshot (optional)
  original_description TEXT,
  
  -- User correction
  corrected_selector TEXT NOT NULL,
  corrected_element JSONB, -- Element details (tag, text, attributes)
  
  -- Page context
  page_url TEXT NOT NULL,
  page_domain TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN position('//' IN page_url) > 0 THEN 
        split_part(split_part(page_url, '//', 2), '/', 1)
      ELSE page_url
    END
  ) STORED,
  page_type TEXT, -- form, dashboard, data_table, etc.
  
  -- Learning data
  learned_pattern JSONB, -- Pattern extracted from correction
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  
  -- User ID (for future multi-user support)
  user_id TEXT
);

-- Index for finding similar corrections
CREATE INDEX IF NOT EXISTS idx_correction_memory_domain ON correction_memory(page_domain);
CREATE INDEX IF NOT EXISTS idx_correction_memory_page_type ON correction_memory(page_type);
CREATE INDEX IF NOT EXISTS idx_correction_memory_success ON correction_memory(success_count DESC);

-- Table: visual_patterns
-- Stores learned visual patterns per page type
CREATE TABLE IF NOT EXISTS visual_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- Pattern identification
  pattern_type TEXT NOT NULL, -- selector_transform, visual_match, text_match, position_based
  page_type TEXT, -- form, dashboard, data_table, etc.
  domain TEXT, -- Optional domain restriction
  
  -- Pattern conditions
  conditions JSONB NOT NULL, -- When to apply this pattern
  
  -- Pattern rule
  rule JSONB NOT NULL, -- The transformation/matching rule
  
  -- Statistics
  confidence DECIMAL(3, 2) DEFAULT 0.5, -- 0-1 based on success rate
  usage_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  
  -- User ID
  user_id TEXT
);

-- Index for finding applicable patterns
CREATE INDEX IF NOT EXISTS idx_visual_patterns_type ON visual_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_visual_patterns_page_type ON visual_patterns(page_type);
CREATE INDEX IF NOT EXISTS idx_visual_patterns_confidence ON visual_patterns(confidence DESC);

-- Table: workflow_intents
-- Stores analyzed workflow intents
CREATE TABLE IF NOT EXISTS workflow_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- Workflow reference
  workflow_id TEXT NOT NULL,
  workflow_name TEXT,
  step_count INTEGER,
  
  -- Intent analysis
  primary_goal TEXT,
  sub_goals JSONB, -- Array of sub-goals
  expected_outcome TEXT,
  visual_confirmation TEXT,
  
  -- Failure patterns
  failure_patterns JSONB, -- Array of failure patterns
  
  -- Confidence
  confidence DECIMAL(3, 2),
  
  -- User ID
  user_id TEXT
);

-- Index for finding workflow intents
CREATE INDEX IF NOT EXISTS idx_workflow_intents_workflow ON workflow_intents(workflow_id);

-- Extend ai_cache table with visual analysis fields (if not exists)
ALTER TABLE ai_cache ADD COLUMN IF NOT EXISTS cache_type TEXT DEFAULT 'general';
ALTER TABLE ai_cache ADD COLUMN IF NOT EXISTS page_type TEXT;

-- Index for visual cache queries
CREATE INDEX IF NOT EXISTS idx_ai_cache_type ON ai_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_ai_cache_page_type ON ai_cache(page_type);

-- Function: Update timestamp on modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_correction_memory_updated_at ON correction_memory;
CREATE TRIGGER update_correction_memory_updated_at
  BEFORE UPDATE ON correction_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_visual_patterns_updated_at ON visual_patterns;
CREATE TRIGGER update_visual_patterns_updated_at
  BEFORE UPDATE ON visual_patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function: Calculate pattern confidence
CREATE OR REPLACE FUNCTION calculate_pattern_confidence(success_count INTEGER, failure_count INTEGER)
RETURNS DECIMAL(3, 2) AS $$
BEGIN
  IF success_count + failure_count = 0 THEN
    RETURN 0.5; -- Default confidence for new patterns
  END IF;
  RETURN ROUND(success_count::DECIMAL / (success_count + failure_count)::DECIMAL, 2);
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update pattern confidence
CREATE OR REPLACE FUNCTION update_pattern_confidence()
RETURNS TRIGGER AS $$
BEGIN
  NEW.confidence = calculate_pattern_confidence(NEW.success_count, NEW.failure_count);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_visual_patterns_confidence ON visual_patterns;
CREATE TRIGGER update_visual_patterns_confidence
  BEFORE UPDATE OF success_count, failure_count ON visual_patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_pattern_confidence();

-- RLS Policies (disabled by default, enable when user auth is added)
-- ALTER TABLE correction_memory ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE visual_patterns ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE workflow_intents ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE correction_memory IS 'Stores user corrections for element finding to enable learning';
COMMENT ON TABLE visual_patterns IS 'Stores learned visual patterns that can be applied to improve element finding';
COMMENT ON TABLE workflow_intents IS 'Stores analyzed workflow intents for smarter execution';










