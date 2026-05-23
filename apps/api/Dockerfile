# Build stage — install all dependencies
FROM node:20-alpine AS builder
WORKDIR /app

# Install Docker CLI (needed for docker exec pg_dump in supabase-backup-agent)
RUN apk add --no-cache docker-cli wget

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Production stage — minimal runtime image
FROM node:20-alpine AS runner
WORKDIR /app

# Install Docker CLI (needed for docker exec pg_dump in supabase-backup-agent)
RUN apk add --no-cache docker-cli wget

ENV NODE_ENV=production

# Copy node_modules from builder (includes tsx for runtime)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Clean npm cache to reduce image size
RUN npm cache clean --force

EXPOSE 8080

# Use tsx to run directly — avoids OOM from tsc on low-memory VPS
CMD ["node", "--dns-result-order=ipv4first", "--import", "tsx", "src/server.ts"]
