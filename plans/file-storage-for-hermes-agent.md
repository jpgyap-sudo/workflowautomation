# Plan: Replace Google Drive with Local File Store for Hermes Agent

## Overview
Replace Google Drive upload for quotation files with a local VPS file-store container that:
1. Stores **text-extracted** quotation data (not bulky PDFs/images)
2. Provides reference for Hermes agent during production analysis
3. Auto-deletes after 3 months from order completion/delivery
4. Removes all Google Drive upload code for quotations and deposit slips

## Architecture

```mermaid
graph TB
    subgraph "Docker Compose Stack"
        P[postgres]
        R[redis]
        A[api]
        D[dashboard]
        TB[telegram-bot]
        BA[backup-agent]
        FS[file-store<br/>NEW]
    end

    subgraph "File Store Volume"
        FV[/quotations/YYYY-MM/QTN-XXXX.txt]
    end

    TB -->|1. Extract text via Gemini Vision| A
    A -->|2. POST /files/store| FS
    FS -->|3. Write text file| FV
    FS -->|4. Daily cleanup: DELETE old files| FV
    A -->|5. Query file text| FS
    H[Hermes Agent<br/>in API] -->|6. Read file text for context| FS

    style FS fill:#90EE90
```

## Changes by Component

### 1. Database (`database/migrations/018_file_store.sql`)
```sql
-- Add order completion tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Add local file storage to files table
ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_backend TEXT DEFAULT 'google_drive';
ALTER TABLE files ADD COLUMN IF NOT EXISTS local_file_path TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_files_retention_until ON files(retention_until) WHERE retention_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders(delivered_at) WHERE delivered_at IS NOT NULL;
```

### 2. New Container: `apps/file-store/`
- **Fastify API** (lightweight, consistent with existing API)
- **Endpoints**:
  - `POST /files/store` — Store extracted text for an order
  - `GET /files/:order_id` — Retrieve text for Hermes agent
  - `GET /files/:order_id/download` — Download original (if kept briefly)
  - `DELETE /files/:order_id` — Manual delete
- **Auto-cleanup scheduler**: Daily cron-like task
  - Queries DB for orders where `completed_at` or `delivered_at` > 3 months ago
  - Deletes files from disk and updates DB
- **Volume**: `file_store_data:/data/quotations`

### 3. API Changes (`apps/api/`)
- Remove `uploadToDrive` import and calls from `/drive/upload` endpoint
- When receiving quotation upload:
  1. Extract text via Gemini Vision (existing flow)
  2. Send text to file-store container
  3. Store reference in DB (`files` table with `storage_backend='local'`)
- When order stage reaches `delivered` → set `orders.delivered_at = NOW()`
- When order stage reaches `completed` → set `orders.completed_at = NOW()`
- Remove deposit slip Google Drive upload (just don't store it)

### 4. Telegram Bot Changes (`apps/telegram-bot/`)
- Remove `uploadToDrive` import
- Remove deposit slip upload code
- Remove quotation file upload to Google Drive
- Send extracted text to API → API forwards to file-store

### 5. Hermes Agent Changes (`apps/api/src/services/hermesClaw.ts`)
- Add `fetchFileText(orderId)` function — calls file-store container
- Include extracted quotation text in `HermesProductionContext`
- Use text in prompt for production analysis

### 6. docker-compose.yml Changes
```yaml
  file-store:
    build: ./apps/file-store
    container_name: qas_file_store
    restart: unless-stopped
    environment:
      PORT: 8082
      DATA_DIR: /data/quotations
      POSTGRES_HOST: postgres
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      CLEANUP_INTERVAL_MS: 86400000  # Daily
      RETENTION_DAYS: 90             # 3 months
    volumes:
      - file_store_data:/data/quotations
    ports:
      - "127.0.0.1:8082:8082"
    depends_on:
      postgres:
        condition: service_healthy
```

### 7. New Volume
```yaml
volumes:
  file_store_data:
```

## File Storage Structure (on disk)
```
/data/quotations/
  2026-05/
    QTN-001-ClientName.txt          # Extracted text from quotation
    QTN-002-ClientName.txt
  2026-06/
    QTN-003-ClientName.txt
```

## Auto-Deletion Logic
```
Every 24 hours:
  1. Find orders where completed_at < NOW() - INTERVAL '90 days'
     OR delivered_at < NOW() - INTERVAL '90 days'
  2. For each order:
     a. Delete files from disk at local_file_path
     b. Set files.extracted_text = NULL
     c. Set files.retention_until = NULL
     d. Log deletion
```

## Deployment Order
1. Add migration (schema changes)
2. Create `apps/file-store/` container code
3. Update `docker-compose.yml`
4. Update API endpoints (remove Drive, add file-store calls)
5. Update Telegram bot (remove Drive uploads)
6. Update Hermes agent (read from file-store)
7. Deploy to VPS
8. Verify and test
