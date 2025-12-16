-- Enable RLS on athletes table (if not already enabled)
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own athlete record
CREATE POLICY "Users can read own athlete data"
ON athletes
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy: Users can update their own athlete record
CREATE POLICY "Users can update own athlete data"
ON athletes
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy: Allow inserts for new users (needed for signup)
CREATE POLICY "Users can insert own athlete data"
ON athletes
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);
