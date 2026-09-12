# Stage 1: Build environment
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci

COPY src/ ./src/
COPY eslint.config.js prettier.config.js ./

# Verify, test, and build distribution artifacts
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/contradiction.db
ENV MCP_TRANSPORT=stdio
ENV HTTP_HOST=0.0.0.0
ENV HTTP_PORT=3000

# Install runtime dependencies for SQLite
RUN apk add --no-cache dumb-init

COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled build output and migrations from builder
COPY --from=builder /app/dist ./dist

# Create persistent data directory and set permissions for non-root node user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))" || exit 0

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
