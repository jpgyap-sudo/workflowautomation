import { query } from '../db.js';
import { readFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

// ── Configuration ──────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const EMBEDDING_MODEL = process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'text-embedding-004';
const EMBEDDING_DIMENSIONS = parseInt(process.env.KNOWLEDGE_EMBEDDING_DIMENSIONS ?? '768', 10);
const CHUNK_SIZE = parseInt(process.env.KNOWLEDGE_CHUNK_SIZE ?? '1000', 10);
const CHUNK_OVERLAP = parseInt(process.env.KNOWLEDGE_CHUNK_OVERLAP ?? '200', 10);
const EMBEDDING_TIMEOUT_MS = parseInt(process.env.KNOWLEDGE_EMBEDDING_TIMEOUT_MS ?? '30000', 10);

// ── Types ──────────────────────────────────────────────────────────────

export interface KnowledgeDocument {
  id?: string;
  title: string;
  content: string;
  source: string;
  source_url: string | null;
  doc_type: string;
  tags: string[];
  checksum: string | null;
}

export interface IngestionResult {
  status: 'completed' | 'failed';
  documents_added: number;
  documents_updated: number;
  documents_removed: number;
  error_message: string | null;
}

// ── Source Definitions ─────────────────────────────────────────────────

interface KnowledgeSource {
  name: string;
  type: string;
  path: string;
  url: string | null;
  tags: string[];
}

const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  { name: 'CHANGELOG', type: 'markdown', path: 'docs/CHANGELOG.md', url: null, tags: ['changelog', 'updates'] },
  { name: 'UPDATE_LOG', type: 'markdown', path: 'docs/UPDATE_LOG.md', url: null, tags: ['updates', 'work-tracking'] },
  { name: 'BUG_LOG', type: 'markdown', path: 'docs/BUG_LOG.md', url: null, tags: ['bugs', 'troubleshooting'] },
  { name: 'Architecture', type: 'markdown', path: 'docs/architecture.md', url: null, tags: ['architecture', 'system-design'] },
  { name: 'Workflow', type: 'markdown', path: 'docs/workflow.md', url: null, tags: ['workflow', 'process'] },
  { name: 'Features Reference', type: 'markdown', path: 'docs/features.md', url: null, tags: ['features', 'reference', 'how-to'] },
  { name: 'Guides Page', type: 'code', path: 'apps/dashboard/src/app/guides/page.tsx', url: '/guides', tags: ['guides', 'tutorials'] },
  { name: 'Quotation Checker Agent', type: 'agent-md', path: 'agents/quotation-checker/agent.md', url: null, tags: ['agent', 'quotation'] },
  { name: 'Purchasing Agent', type: 'agent-md', path: 'agents/purchasing-agent/agent.md', url: null, tags: ['agent', 'purchasing'] },
  { name: 'Inventory Agent', type: 'agent-md', path: 'agents/inventory-agent/agent.md', url: null, tags: ['agent', 'inventory'] },
  { name: 'Delivery Agent', type: 'agent-md', path: 'agents/delivery-agent/agent.md', url: null, tags: ['agent', 'delivery'] },
  { name: 'Collection Agent', type: 'agent-md', path: 'agents/collection-agent/agent.md', url: null, tags: ['agent', 'collection'] },
  { name: 'Escalation Agent', type: 'agent-md', path: 'agents/escalation-agent/agent.md', url: null, tags: ['agent', 'escalation'] },
  { name: 'Tutorial Agent', type: 'agent-md', path: 'agents/tutorial-agent/agent.md', url: null, tags: ['agent', 'tutorial', 'chatbot'] },
];

// ── Text Chunking ──────────────────────────────────────────────────────

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to break at a natural boundary (double newline, then single newline, then space)
    if (end < text.length) {
      const searchStart = Math.max(start, end - overlap);
      const segment = text.slice(searchStart, end);

      // Prefer paragraph breaks
      const paraBreak = segment.lastIndexOf('\n\n');
      if (paraBreak > segment.length / 2) {
        end = searchStart + paraBreak + 2;
      } else {
        // Prefer line breaks
        const lineBreak = segment.lastIndexOf('\n');
        if (lineBreak > segment.length / 2) {
          end = searchStart + lineBreak + 1;
        } else {
          // Fall back to space
          const spaceBreak = segment.lastIndexOf(' ');
          if (spaceBreak > segment.length / 2) {
            end = searchStart + spaceBreak + 1;
          }
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter((c) => c.length > 0);
}

// ── Embedding Generation ───────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[knowledgeBase] No GEMINI_API_KEY set — skipping embedding generation');
    return null;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[knowledgeBase] Gemini embedding error ${response.status}: ${errorText}`);
        return null;
      }

      const data = await response.json() as any;
      return data.embedding?.values as number[] ?? null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    console.error(`[knowledgeBase] Failed to generate embedding: ${err.message}`);
    return null;
  }
}

// ── Document Loading ───────────────────────────────────────────────────

async function loadSourceDocument(source: KnowledgeSource): Promise<{ title: string; content: string; checksum: string } | null> {
  const projectRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'));

  // Try multiple paths — order matters for performance
  const paths = [
    // Local development: projectRoot resolves to repo root
    join(projectRoot, source.path),
    // Docker container: projectRoot resolves to /, but volumes mount at /app/docs and /app/agents
    join('/app', source.path),
    // Fallback: VPS host path (only works if container has host access)
    join('/opt/quotation-automation', source.path),
  ];

  for (const filePath of paths) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const checksum = createHash('md5').update(content).digest('hex');
      return { title: source.name, content, checksum };
    } catch {
      continue;
    }
  }

  console.warn(`[knowledgeBase] Source not found: ${source.path}`);
  return null;
}

// ── Ingestion Pipeline ─────────────────────────────────────────────────

export async function ingestAllSources(): Promise<IngestionResult> {
  console.log('[knowledgeBase] Starting full ingestion...');

  // Record start
  const logId = await query(`INSERT INTO knowledge_ingestion_log (status) VALUES ('running') RETURNING id`);
  const logIdValue = (logId[0] as any).id;

  let documentsAdded = 0;
  let documentsUpdated = 0;
  let documentsRemoved = 0;

  try {
    // Get existing document checksums for dedup
    const existingDocs = await query<{ checksum: string; id: string }>(
      `SELECT checksum, id FROM knowledge_documents WHERE checksum IS NOT NULL`
    );
    const existingChecksums = new Map(existingDocs.map((d) => [d.checksum, d.id]));

    // Track which sources we've seen
    const seenChecksums = new Set<string>();

    for (const source of KNOWLEDGE_SOURCES) {
      const doc = await loadSourceDocument(source);
      if (!doc) continue;

      seenChecksums.add(doc.checksum);

      if (existingChecksums.has(doc.checksum)) {
        // Document already exists and hasn't changed — skip
        continue;
      }

      // Upsert document
      const existingId = existingChecksums.get(doc.checksum);
      if (existingId) {
        // Update existing document
        await query(
          `UPDATE knowledge_documents SET content = $1, updated_at = NOW() WHERE id = $2`,
          [doc.content, existingId]
        );
        documentsUpdated++;
      } else {
        // Insert new document
        const result = await query(
          `INSERT INTO knowledge_documents (title, content, source, source_url, doc_type, tags, checksum)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [doc.title, doc.content, source.name, source.url, source.type, source.tags, doc.checksum]
        );
        documentsAdded++;

        // Generate embeddings for chunks
        const docId = (result[0] as any).id;
        const chunks = chunkText(doc.content, CHUNK_SIZE, CHUNK_OVERLAP);

        for (let i = 0; i < chunks.length; i++) {
          const embedding = await generateEmbedding(chunks[i]);
          if (embedding) {
            await query(
              `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding)
               VALUES ($1, $2, $3, $4::vector)`,
              [docId, i, chunks[i], JSON.stringify(embedding)]
            );
          } else {
            // Store without embedding (will be embedded later)
            await query(
              `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text)
               VALUES ($1, $2, $3)`,
              [docId, i, chunks[i]]
            );
          }
        }
      }
    }

    // Remove documents for sources that no longer exist
    const allExistingChecksums = new Set(existingChecksums.keys());
    for (const checksum of allExistingChecksums) {
      if (!seenChecksums.has(checksum)) {
        const id = existingChecksums.get(checksum)!;
        await query(`DELETE FROM knowledge_embeddings WHERE document_id = $1`, [id]);
        await query(`DELETE FROM knowledge_documents WHERE id = $1`, [id]);
        documentsRemoved++;
      }
    }

    // Mark ingestion as completed
    await query(
      `UPDATE knowledge_ingestion_log SET status = 'completed', documents_added = $1, documents_updated = $2, documents_removed = $3, completed_at = NOW() WHERE id = $4`,
      [documentsAdded, documentsUpdated, documentsRemoved, logIdValue]
    );

    console.log(`[knowledgeBase] Ingestion complete: +${documentsAdded} added, ${documentsUpdated} updated, ${documentsRemoved} removed`);

    return {
      status: 'completed',
      documents_added: documentsAdded,
      documents_updated: documentsUpdated,
      documents_removed: documentsRemoved,
      error_message: null,
    };
  } catch (err: any) {
    console.error(`[knowledgeBase] Ingestion failed: ${err.message}`);

    await query(
      `UPDATE knowledge_ingestion_log SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, logIdValue]
    );

    return {
      status: 'failed',
      documents_added: documentsAdded,
      documents_updated: documentsUpdated,
      documents_removed: documentsRemoved,
      error_message: err.message,
    };
  }
}

// ── Semantic Search ────────────────────────────────────────────────────

export interface SearchResult {
  document_id: string;
  chunk_text: string;
  title: string;
  source: string;
  source_url: string | null;
  similarity: number;
}

export async function semanticSearch(searchQuery: string, limit = 5): Promise<SearchResult[]> {
  // Generate embedding for the query
  const embedding = await generateEmbedding(searchQuery);
  if (!embedding) {
    // Fallback to text search if embedding generation fails
    return textSearch(searchQuery, limit);
  }

  try {
    const results = await query<SearchResult>(
      `SELECT
        ke.document_id,
        ke.chunk_text,
        kd.title,
        kd.source,
        kd.source_url,
        1 - (ke.embedding <=> $1::vector) AS similarity
      FROM knowledge_embeddings ke
      JOIN knowledge_documents kd ON kd.id = ke.document_id
      WHERE ke.embedding IS NOT NULL
      ORDER BY ke.embedding <=> $1::vector
      LIMIT $2`,
      [JSON.stringify(embedding), limit]
    );
    return results;
  } catch (err: any) {
    console.error(`[knowledgeBase] Semantic search failed: ${err.message}`);
    return textSearch(searchQuery, limit);
  }
}

// ── Text Search Fallback ───────────────────────────────────────────────

async function textSearch(searchQuery: string, limit = 5): Promise<SearchResult[]> {
  const searchTerms = searchQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => `%${t}%`);

  if (searchTerms.length === 0) return [];

  try {
    const conditions = searchTerms.map((_, i) => `LOWER(ke.chunk_text) LIKE $${i + 1}`);
    const params = searchTerms;

    const results = await query<SearchResult>(
      `SELECT
        ke.document_id,
        ke.chunk_text,
        kd.title,
        kd.source,
        kd.source_url,
        0.0 AS similarity
      FROM knowledge_embeddings ke
      JOIN knowledge_documents kd ON kd.id = ke.document_id
      WHERE ${conditions.join(' AND ')}
      LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    return results;
  } catch (err: any) {
    console.error(`[knowledgeBase] Text search failed: ${err.message}`);
    return [];
  }
}

// ── Knowledge Base Status ──────────────────────────────────────────────

export interface KnowledgeBaseStatus {
  document_count: number;
  embedding_count: number;
  last_ingestion: {
    status: string;
    documents_added: number;
    documents_updated: number;
    documents_removed: number;
    started_at: string;
    completed_at: string | null;
  } | null;
}

export async function getKnowledgeBaseStatus(): Promise<KnowledgeBaseStatus> {
  const docCount = await query(`SELECT COUNT(*) AS count FROM knowledge_documents`);
  const embCount = await query(`SELECT COUNT(*) AS count FROM knowledge_embeddings`);
  const lastIngestion = await query(
    `SELECT status, documents_added, documents_updated, documents_removed, started_at, completed_at
     FROM knowledge_ingestion_log
     ORDER BY started_at DESC
     LIMIT 1`
  );

  return {
    document_count: parseInt((docCount[0] as any).count, 10),
    embedding_count: parseInt((embCount[0] as any).count, 10),
    last_ingestion: lastIngestion[0] ? {
      status: (lastIngestion[0] as any).status,
      documents_added: (lastIngestion[0] as any).documents_added,
      documents_updated: (lastIngestion[0] as any).documents_updated,
      documents_removed: (lastIngestion[0] as any).documents_removed,
      started_at: (lastIngestion[0] as any).started_at,
      completed_at: (lastIngestion[0] as any).completed_at,
    } : null,
  };
}
