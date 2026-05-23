# Build stage — install all dependencies
FROM node:20-alpine AS builder
WORKDIR /app

# Install Docker CLI (needed for docker exec pg_dump)
# Also install PostgreSQL client as fallback
RUN apk add --no-cache docker-cli postgresql16-client curl

COPY package*.json ./
# Use npm install (no lockfile committed for this app)
RUN npm install

COPY tsconfig.json ./
COPY src ./src

# Production stage — minimal runtime image
FROM node:20-alpine AS runner
WORKDIR /app

# Install Docker CLI (needed for docker exec pg_dump)
# Also install PostgreSQL client as fallback
RUN apk add --no-cache docker-cli postgresql16-client curl

ENV NODE_ENV=production

# Copy node_modules from builder (tsx is in dependencies, so --omit=dev keeps it)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Clean npm cache to reduce image size
RUN npm cache clean --force

# Run the backup agent — it runs on a schedule independently
CMD ["npx", "tsx", "src/backupRunner.ts"]
