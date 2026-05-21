FROM node:20-alpine
WORKDIR /app

# Install Docker CLI (needed for docker exec pg_dump)
# Also install PostgreSQL client as fallback
RUN apk add --no-cache docker-cli postgresql16-client curl

COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

# Run the backup agent — it runs on a schedule independently
CMD ["npx", "tsx", "src/backupRunner.ts"]
