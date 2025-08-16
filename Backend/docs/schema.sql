-- Notenscan Backend schema additions

-- PDF task processing table
CREATE TABLE IF NOT EXISTS pdf_tasks (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL,
  num_pages INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Helpful index for listing per user ordered by created_at
CREATE INDEX IF NOT EXISTS idx_pdf_tasks_user_created_at
  ON pdf_tasks (user_id, created_at DESC);
