-- Add title column to chat_sessions for LLM-generated session summaries
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS title TEXT;
