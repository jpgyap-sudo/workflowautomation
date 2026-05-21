FROM node:20-alpine
WORKDIR /app

# Install Docker CLI (needed for docker exec pg_dump in supabase-backup-agent)
RUN apk add --no-cache docker-cli wget

COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

# Use tsx to run directly — avoids OOM from tsc on low-memory VPS
CMD ["npx", "tsx", "src/server.ts"]
