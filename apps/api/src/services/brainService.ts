/**
 * CentralBrain Service — Persistent Learning Layer
 *
 * Provides semantic search, CRUD, and embedding generation for lessons
 * stored in the brain_lessons PostgreSQL table with pgvector.
 *
 * Embeddings are generated via the local Ollama nomic-embed-text model.
 * Falls back gracefully if Ollama is unavailable.
 */

import { query } from '../db.js';

// ── Types ──────────────────────────────────────────────────────

export interface BrainLesson {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  agent: string;
  project_id: string;
  confidence: 'high' | 'medium' | 'low';
  related_files: string[];
  source: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  similarity?: number; // populated on search
}

export interface BrainSearchResult {
  lessons: BrainLesson[];
  total: number;
  query_embedding_time_ms: number;
  search_time_ms: number;
}

export interface BrainStats {
  total_lessons: number;
  by_agent: Record<string, number>;
  by_confidence: Record<string, number>;
  by_source: Record<string, number>;
  by_tag: Record<string, number>;
  latest_lesson: BrainLesson | null;
  oldest_lesson: BrainLesson | null;
  has_embeddings: number;
  needs_embeddings: number;
}

// ── Embedding Generation via Ollama ──────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[brain] Ollama embedding returned ${res.status}`);
      return null;
    }

    const data = await res.json() as { embedding: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) {
      console.warn('[brain] Ollama returned no embedding');
      return null;
    }

    return data.embedding;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.warn('[brain] Ollama embedding timed out');
    } else {
      console.warn('[brain] Ollama embedding failed:', err?.message ?? err);
    }
    return null;
  }
}

// ── Format helpers ───────────────────────────────────────────

function formatLesson(row: any): BrainLesson {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    summary: row.summary ?? null,
    tags: row.tags ?? [],
    agent: row.agent ?? 'superroo',
    project_id: row.project_id ?? 'workflowautomation',
    confidence: row.confidence ?? 'medium',
    related_files: row.related_files ?? [],
    source: row.source ?? 'manual',
    source_ref: row.source_ref ?? null,
    metadata: typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    similarity: row.similarity ?? undefined,
  };
}

// ── CRUD Operations ──────────────────────────────────────────

/**
 * Create a new lesson, optionally generating its embedding.
 */
export async function createLesson(data: {
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  agent?: string;
  project_id?: string;
  confidence?: 'high' | 'medium' | 'low';
  related_files?: string[];
  source?: string;
  source_ref?: string;
  metadata?: Record<string, unknown>;
}): Promise<BrainLesson> {
  const agent = data.agent ?? 'superroo';
  const projectId = data.project_id ?? 'workflowautomation';

  // Generate embedding from title + content
  const embedText = `${data.title}\n\n${data.content}`;
  const embedding = await generateEmbedding(embedText);

  const rows = await query(
    `INSERT INTO brain_lessons
       (title, content, summary, tags, agent, project_id, confidence,
        related_files, source, source_ref, metadata, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::vector)
     RETURNING *`,
    [
      data.title,
      data.content,
      data.summary ?? null,
      data.tags ?? [],
      agent,
      projectId,
      data.confidence ?? 'medium',
      data.related_files ?? [],
      data.source ?? 'manual',
      data.source_ref ?? null,
      JSON.stringify(data.metadata ?? {}),
      embedding ? JSON.stringify(embedding) : null,
    ],
  );

  return formatLesson(rows[0]);
}

/**
 * Search lessons by semantic similarity (cosine distance on embeddings).
 * Falls back to text-based search if no query embedding can be generated.
 */
export async function searchLessons(
  queryText: string,
  options: {
    limit?: number;
    offset?: number;
    tags?: string[];
    agent?: string;
    project_id?: string;
    min_confidence?: string;
    related_file?: string;
  } = {},
): Promise<BrainSearchResult> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const startTime = Date.now();

  // Try to generate embedding for the query
  const queryEmbedding = await generateEmbedding(queryText);
  const embedTime = Date.now() - startTime;

  // Build WHERE clauses
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options.project_id) {
    conditions.push(`project_id = $${idx++}`);
    params.push(options.project_id);
  }
  if (options.agent) {
    conditions.push(`agent = $${idx++}`);
    params.push(options.agent);
  }
  if (options.tags && options.tags.length > 0) {
    conditions.push(`tags && $${idx++}`);  // array overlap operator
    params.push(options.tags);
  }
  if (options.min_confidence) {
    const confOrder = { high: 3, medium: 2, low: 1 };
    const minLevel = confOrder[options.min_confidence as keyof typeof confOrder] ?? 0;
    conditions.push(`
      CASE confidence
        WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1
      END >= $${idx++}`);
    params.push(minLevel);
  }
  if (options.related_file) {
    conditions.push(`$${idx++} = ANY(related_files)`);
    params.push(options.related_file);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Try semantic search, fall back to text search
  let rows: any[];
  let totalRows: any[];

  if (queryEmbedding) {
    // Semantic search with cosine similarity
    const embeddingParam = JSON.stringify(queryEmbedding);
    rows = await query(
      `SELECT *,
              1 - (embedding <=> $${idx}::vector) AS similarity
       FROM brain_lessons
       ${whereClause}
       AND embedding IS NOT NULL
       ORDER BY embedding <=> $${idx}::vector
       LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...params, embeddingParam, limit, offset],
    );

    // Count total matching with embeddings
    totalRows = await query(
      `SELECT COUNT(*) as total FROM brain_lessons ${whereClause} AND embedding IS NOT NULL`,
      params,
    );
  } else {
    // Fallback: full-text search using ILIKE
    const searchPattern = `%${queryText}%`;
    rows = await query(
      `SELECT *,
              CASE
                WHEN title ILIKE $${idx} THEN 3
                WHEN content ILIKE $${idx} THEN 2
                WHEN summary ILIKE $${idx} THEN 2
                WHEN $${idx} = ANY(tags::text[]) THEN 1
                ELSE 0
              END AS similarity
       FROM brain_lessons
       ${whereClause}
       AND (
         title ILIKE $${idx} OR
         content ILIKE $${idx} OR
         summary ILIKE $${idx} OR
         $${idx} = ANY(tags::text[]) OR
         $${idx + 1} = ANY(related_files)
       )
       ORDER BY similarity DESC, created_at DESC
       LIMIT $${idx + 2} OFFSET $${idx + 3}`,
      [...params, searchPattern, queryText, limit, offset],
    );

    totalRows = await query(
      `SELECT COUNT(*) as total FROM brain_lessons
       ${whereClause} AND (
         title ILIKE $1 OR
         content ILIKE $1 OR
         summary ILIKE $1 OR
         $1 = ANY(tags::text[])
       )`,
      [...params, searchPattern],
    );
  }

  const searchTime = Date.now() - startTime;

  return {
    lessons: rows.map(formatLesson),
    total: parseInt(totalRows[0]?.total ?? '0', 10),
    query_embedding_time_ms: embedTime,
    search_time_ms: searchTime,
  };
}

/**
 * Get a single lesson by ID.
 */
export async function getLesson(id: string): Promise<BrainLesson | null> {
  const rows = await query(
    `SELECT *, 1 AS similarity FROM brain_lessons WHERE id = $1`,
    [id],
  );
  return rows[0] ? formatLesson(rows[0]) : null;
}

/**
 * Update a lesson. Regenerates embedding if content or title changed.
 */
export async function updateLesson(
  id: string,
  data: Partial<{
    title: string;
    content: string;
    summary: string;
    tags: string[];
    agent: string;
    project_id: string;
    confidence: 'high' | 'medium' | 'low';
    related_files: string[];
    source: string;
    source_ref: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<BrainLesson | null> {
  const fields: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (data.title !== undefined) { fields.push(`title=$${idx++}`); params.push(data.title); }
  if (data.content !== undefined) { fields.push(`content=$${idx++}`); params.push(data.content); }
  if (data.summary !== undefined) { fields.push(`summary=$${idx++}`); params.push(data.summary); }
  if (data.tags !== undefined) { fields.push(`tags=$${idx++}`); params.push(data.tags); }
  if (data.agent !== undefined) { fields.push(`agent=$${idx++}`); params.push(data.agent); }
  if (data.project_id !== undefined) { fields.push(`project_id=$${idx++}`); params.push(data.project_id); }
  if (data.confidence !== undefined) { fields.push(`confidence=$${idx++}`); params.push(data.confidence); }
  if (data.related_files !== undefined) { fields.push(`related_files=$${idx++}`); params.push(data.related_files); }
  if (data.source !== undefined) { fields.push(`source=$${idx++}`); params.push(data.source); }
  if (data.source_ref !== undefined) { fields.push(`source_ref=$${idx++}`); params.push(data.source_ref); }
  if (data.metadata !== undefined) { fields.push(`metadata=$${idx++}::jsonb`); params.push(JSON.stringify(data.metadata)); }

  // Regenerate embedding if title or content changed
  const needsEmbed = data.title !== undefined || data.content !== undefined;
  if (needsEmbed) {
    const embedTitle = data.title ?? '';
    const embedContent = data.content ?? '';
    // Need to fetch current values for fields not being updated
    if (!embedTitle || !embedContent) {
      const existing = await getLesson(id);
      if (existing) {
        const title = embedTitle || existing.title;
        const content = embedContent || existing.content;
        const embedding = await generateEmbedding(`${title}\n\n${content}`);
        if (embedding) {
          fields.push(`embedding=$${idx++}::vector`);
          params.push(JSON.stringify(embedding));
        }
      }
    } else {
      const embedding = await generateEmbedding(`${embedTitle}\n\n${embedContent}`);
      if (embedding) {
        fields.push(`embedding=$${idx++}::vector`);
        params.push(JSON.stringify(embedding));
      }
    }
  }

  if (fields.length === 0) return getLesson(id);

  params.push(id);
  const rows = await query(
    `UPDATE brain_lessons SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`,
    params,
  );

  return rows[0] ? formatLesson(rows[0]) : null;
}

/**
 * Delete a lesson.
 */
export async function deleteLesson(id: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM brain_lessons WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/**
 * List lessons with pagination.
 */
export async function listLessons(options: {
  limit?: number;
  offset?: number;
  agent?: string;
  project_id?: string;
  confidence?: string;
  tag?: string;
  sort?: 'created_at' | 'updated_at' | 'title';
  order?: 'asc' | 'desc';
} = {}): Promise<{ lessons: BrainLesson[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const sort = options.sort ?? 'created_at';
  const order = options.order ?? 'desc';

  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (options.agent) { conditions.push(`agent = $${idx++}`); params.push(options.agent); }
  if (options.project_id) { conditions.push(`project_id = $${idx++}`); params.push(options.project_id); }
  if (options.confidence) { conditions.push(`confidence = $${idx++}`); params.push(options.confidence); }
  if (options.tag) { conditions.push(`$${idx++} = ANY(tags)`); params.push(options.tag); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column to prevent SQL injection
  const validSorts = ['created_at', 'updated_at', 'title'];
  const sortCol = validSorts.includes(sort) ? sort : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const [rows, countRows] = await Promise.all([
    query(
      `SELECT * FROM brain_lessons ${whereClause} ORDER BY ${sortCol} ${sortOrder} LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    ),
    query(
      `SELECT COUNT(*) as total FROM brain_lessons ${whereClause}`,
      params,
    ),
  ]);

  return {
    lessons: rows.map(formatLesson),
    total: parseInt(countRows[0]?.total ?? '0', 10),
  };
}

/**
 * Get brain statistics.
 */
export async function getStats(): Promise<BrainStats> {
  const [totalRow, agentRow, confRow, sourceRow, tagRow, latestRow, oldestRow, embedRow] = await Promise.all([
    query(`SELECT COUNT(*) as c FROM brain_lessons`),
    query(`SELECT agent, COUNT(*) as c FROM brain_lessons GROUP BY agent ORDER BY c DESC`),
    query(`SELECT confidence, COUNT(*) as c FROM brain_lessons GROUP BY confidence ORDER BY c DESC`),
    query(`SELECT source, COUNT(*) as c FROM brain_lessons GROUP BY source ORDER BY c DESC`),
    query(`SELECT unnest(tags) as tag, COUNT(*) as c FROM brain_lessons GROUP BY tag ORDER BY c DESC LIMIT 50`),
    query(`SELECT * FROM brain_lessons ORDER BY created_at DESC LIMIT 1`),
    query(`SELECT * FROM brain_lessons ORDER BY created_at ASC LIMIT 1`),
    query(`SELECT
      COUNT(*) FILTER (WHERE embedding IS NOT NULL) as has_embeddings,
      COUNT(*) FILTER (WHERE embedding IS NULL) as needs_embeddings
    FROM brain_lessons`),
  ]);

  const toRecord = (rows: any[], key: string, val: string) =>
    Object.fromEntries(rows.map((r: any) => [r[key], parseInt(r[val], 10)]));

  return {
    total_lessons: parseInt(totalRow[0]?.c ?? '0', 10),
    by_agent: toRecord(agentRow, 'agent', 'c'),
    by_confidence: toRecord(confRow, 'confidence', 'c'),
    by_source: toRecord(sourceRow, 'source', 'c'),
    by_tag: toRecord(tagRow, 'tag', 'c'),
    latest_lesson: latestRow[0] ? formatLesson(latestRow[0]) : null,
    oldest_lesson: oldestRow[0] ? formatLesson(oldestRow[0]) : null,
    has_embeddings: parseInt(embedRow[0]?.has_embeddings ?? '0', 10),
    needs_embeddings: parseInt(embedRow[0]?.needs_embeddings ?? '0', 10),
  };
}

/**
 * Re-embed all lessons that are missing embeddings.
 * Useful for initial migration or after embedding model changes.
 */
export async function reembedMissing(limit = 50): Promise<{ processed: number; errors: number }> {
  const rows = await query(
    `SELECT id, title, content FROM brain_lessons WHERE embedding IS NULL LIMIT $1`,
    [limit],
  );

  let processed = 0;
  let errors = 0;

  for (const row of rows) {
    const embedText = `${row.title}\n\n${row.content}`;
    const embedding = await generateEmbedding(embedText);
    if (embedding) {
      await query(
        `UPDATE brain_lessons SET embedding = $1::vector WHERE id = $2`,
        [JSON.stringify(embedding), row.id],
      );
      processed++;
    } else {
      errors++;
    }
  }

  return { processed, errors };
}

/**
 * Find similar lessons to a given lesson ID using embedding similarity.
 */
export async function findSimilar(
  lessonId: string,
  limit = 5,
): Promise<BrainLesson[]> {
  const rows = await query(
    `SELECT *,
            1 - (embedding <=> (SELECT embedding FROM brain_lessons WHERE id = $1)) AS similarity
     FROM brain_lessons
     WHERE id != $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> (SELECT embedding FROM brain_lessons WHERE id = $1)
     LIMIT $2`,
    [lessonId, limit],
  );

  return rows.map(formatLesson);
}
