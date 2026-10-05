-- Migrations for Aksara Sunda OCR

-- 1. Table for OCR Results
CREATE TABLE ocr_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    result_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own OCR results"
    ON ocr_results FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own OCR results"
    ON ocr_results FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own OCR results"
    ON ocr_results FOR DELETE
    USING (auth.uid() = user_id);

-- 2. Table for Rate Limiting
CREATE TABLE rate_limits (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, date)
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Note: Edge Functions using the service role or user's JWT can bypass or use RLS. 
-- Since the edge function uses the user's JWT, it needs permissions to read/upsert here.
CREATE POLICY "Users can view their own rate limits"
    ON rate_limits FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/update their own rate limits"
    ON rate_limits FOR INSERT
    WITH CHECK (auth.uid() = user_id);
    
CREATE POLICY "Users can update their own rate limits"
    ON rate_limits FOR UPDATE
    USING (auth.uid() = user_id);