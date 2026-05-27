-- Migration 042: Change embedding dimensions from 768 to 3072
-- gemini-embedding-2 produces 3072-dimensional vectors, not 768.
-- NOTE: IVFFlat index cannot be recreated because pgvector has a 2000-dimension
-- limit for IVFFlat indexes. Queries still work without the index (just slower).

-- Drop the IVFFlat index first (depends on the column type)
DROP INDEX IF EXISTS idx_knowledge_embeddings_embedding;

-- Alter the column to 3072 dimensions
ALTER TABLE knowledge_embeddings ALTER COLUMN embedding TYPE VECTOR(3072);
