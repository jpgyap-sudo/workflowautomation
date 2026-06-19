# Quotation Automation System — CentralBrain Learning Layer
# =========================================================
# CentralBrain is a persistent, PostgreSQL-backed AI learning layer
# that stores lessons, fixes, and best practices with pgvector embeddings
# for semantic search. It replaces the flat-file lessons-learned.md system.

## Architecture

| Component | Technology | Location |
|-----------|-----------|----------|
| **Database** | PostgreSQL 16 + pgvector | `database/migrations/047_brain_lessons.sql` |
| **Embeddings** | Ollama nomic-embed-text (768-dim) | `docker-compose.yml` → `ollama` service |
| **API** | Fastify endpoints | `apps/api/src/server.ts` (brain/* routes) |
| **Service** | TypeScript service module | `apps/api/src/services/brainService.ts` |
| **Telegram Integration** | Telegraf `/brain` command | `apps/telegram-bot/src/bot.ts` |
| **Dashboard** | Next.js page | `apps/dashboard/src/app/brain/page.tsx` |
| **Import Script** | Node.js migration tool | `scripts/import-brain-lessons.mjs` |
| **Ollama Init** | Shell script for model pull | `scripts/init-ollama-brain.sh` |

## How It Works

### 1. Lesson Creation (POST /brain)
When a lesson is created via the API, dashboard, or import script:
1. Title + content are concatenated
2. Sent to Ollama `nomic-embed-text` for a 768-dimensional embedding
3. Lesson + embedding stored in `brain_lessons` table
4. If Ollama is unavailable, the lesson is stored without an embedding (text-only fallback)

### 2. Semantic Search (GET /brain/search)
When a user queries `/brain/search`:
1. The query text is also sent to Ollama for embedding
2. pgvector cosine similarity (`<=>` operator) finds the closest lessons
3. Results include a `similarity` score (0-1)
4. If Ollama is unavailable, falls back to ILIKE text search

### 3. Telegram Integration (/brain command)
Users in any allowed Telegram group can type:
```
/brain how to handle delivery exception
```
The bot queries the API, formats results, and replies with:
- Confidence indicator (🟢/🟡/🔴)
- Success summary
- Tags and related files
- Match percentage

## Deployment

### First-time setup (VPS or local):
```bash
# 1. Start the stack
docker compose up -d

# 2. Pull the embedding model into Ollama
sh scripts/init-ollama-brain.sh

# 3. Migrate existing lessons from lessons-learned.md
# Wait for the API to be healthy first
node scripts/import-brain-lessons.mjs --api-url http://localhost:8080
```

### Tear-down:
- Lessons are in the `brain_lessons` table (backed up with your normal DB backup)
- If you remove the Ollama container, the API falls back to text-only search
- To reset: `TRUNCATE brain_lessons;` and reimport

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/brain/stats` | Lesson statistics (counts by agent/confidence/source/tag) |
| `GET` | `/brain` | List lessons with pagination + filters |
| `GET` | `/brain/search?q=...` | Semantic search with optional tag/agent filters |
| `GET` | `/brain/:id` | Get a single lesson |
| `GET` | `/brain/:id/similar` | Find similar lessons by embedding distance |
| `POST` | `/brain` | Create a new lesson (auto-embeds) |
| `PATCH` | `/brain/:id` | Update a lesson (re-embeds if title/content changes) |
| `DELETE` | `/brain/:id` | Delete a lesson |
| `POST` | `/brain/reembed` | Re-embed lessons missing embeddings |

## Dashboard

The CentralBrain dashboard page (`/brain`) shows:
- **Stats cards**: total lessons, embedding status, tag count, agent count, confidence split
- **Search bar**: full-text and semantic search
- **Filter inputs**: by tag and agent with clear button
- **Lesson list**: expandable cards showing summary, full content, tags, files, source
- **New Lesson modal**: create lessons with title, content, summary, tags, confidence, files
- **Delete**: inline delete with confirmation
- **Re-Embed button**: batch-generate embeddings for lessons that are missing them

## Database Schema

See `database/migrations/047_brain_lessons.sql` for the full schema:
- `brain_lessons` table with UUID PK, title, content, summary, tags[], agent, confidence, embedding (vector(768)), related_files[], source, metadata JSONB
- IVFFlat index on embedding with cosine similarity (lists=100)
- GIN indexes on tags and related_files for fast filtering
- Auto-updated_at trigger

## Memory Layer vs CentralBrain

| Feature | Old (lessons-learned.md) | New (CentralBrain) |
|---------|-------------------------|-------------------|
| Storage | Flat markdown file (16K+ lines) | PostgreSQL with pgvector |
| Search | Manual `Ctrl+F` | Semantic AI search |
| Embeddings | None | 768-dim nomic-embed-text |
| Access | Local AI tools only | API, Dashboard, Telegram |
| Durability | Git-tracked (bloats repo) | In DB (backed up normally) |
| Tags | Inconsistent | Structured TEXT[] with GIN index |
| Cross-extension | Manual sync | All tools write to same DB |
| Migration | N/A | `scripts/import-brain-lessons.mjs` |
