-- Create skills table for storing user-taught skills
-- Used by the AI orchestrator for intent matching and execution

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  usage_context TEXT,
  steps JSONB NOT NULL DEFAULT '[]',
  variables JSONB DEFAULT '[]',
  synonyms TEXT[] DEFAULT '{}',
  required_context TEXT[] DEFAULT '{}',
  prerequisites JSONB DEFAULT '[]',
  provides TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used TIMESTAMPTZ,
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  examples JSONB DEFAULT '[]'
);

-- Index for fast user-based queries
CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);

-- Index for searching by name
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

-- Index for sorting by last used
CREATE INDEX IF NOT EXISTS idx_skills_last_used ON skills(last_used DESC NULLS LAST);

-- Enable Row Level Security
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own skills (or public skills with null user_id)
CREATE POLICY "Users can view own skills" ON skills
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Policy: Users can insert their own skills
CREATE POLICY "Users can insert own skills" ON skills
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Policy: Users can update their own skills
CREATE POLICY "Users can update own skills" ON skills
  FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Policy: Users can delete their own skills
CREATE POLICY "Users can delete own skills" ON skills
  FOR DELETE
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Grant access to service role (for edge functions)
GRANT ALL ON skills TO service_role;
