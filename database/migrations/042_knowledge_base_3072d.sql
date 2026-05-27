-- Migration 042: Change embedding dimensions from 768 to 3072
-- gemini-embedding-2 produces 3072-dimensional vectors, not 768.

-- Drop the IVFFlat index first (depends on the column type)
DROP INDEX IF EXISTS idx_knowledge_embeddings_embedding;

-- Alter the column to 3072 dimensions
ALTER TABLE knowledge_embeddings ALTER COLUMN embedding TYPE VECTOR(3072);

-- Recreate the index with the new dimensions
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_embedding ON knowledge_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
