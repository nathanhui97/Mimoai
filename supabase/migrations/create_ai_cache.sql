-- Create ai_cache table for caching AI responses
CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  response_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Create index on expires_at for efficient cleanup
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at ON ai_cache(expires_at);

-- Enable Row Level Security
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations (this is a cache table, no sensitive data)
-- In production, you might want to restrict this based on user authentication
CREATE POLICY "Allow all operations on ai_cache"
  ON ai_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_ai_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM ai_cache
  WHERE expires_at < NOW();
END;
$$;

-- Optional: Create a scheduled job to run cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-ai-cache', '0 * * * *', 'SELECT cleanup_expired_ai_cache()');








