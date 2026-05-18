FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
# Use tsx to run directly — avoids OOM from tsc on low-memory VPS
CMD ["npx", "tsx", "src/server.ts"]
