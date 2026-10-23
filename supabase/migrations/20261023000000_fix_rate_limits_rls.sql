-- Fix: tambah WITH CHECK pada policy UPDATE rate_limits agar upsert berfungsi

ALTER POLICY "Users can update their own rate limits"
    ON rate_limits
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
