# node:sqlite (built-in SQLite) needs Node 22.13+
FROM node:24-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy source and build the React frontend into dist/
COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/pricechecker.db

# Persist the SQLite database outside the container
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
