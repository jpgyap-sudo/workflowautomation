FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm ci --production && npm cache clean --force

COPY src/ ./src/

# Directory for stored quotation text files
RUN mkdir -p /data/files

VOLUME ["/data/files"]

EXPOSE 8090

CMD ["node", "src/index.js"]
