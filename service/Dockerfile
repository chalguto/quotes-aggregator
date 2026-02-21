# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for layer-cache efficiency
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json  ./

# Install ALL dependencies (dev tools needed for the build)
RUN npm ci && npm cache clean --force

# Copy source and compile TypeScript → dist/
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Prune to production deps only ───────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ── Stage 3: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Compiled output
COPY --from=builder /app/dist ./dist
# Production node_modules
COPY --from=deps   /app/node_modules ./node_modules
COPY package.json ./

RUN mkdir -p logs && chown -R appuser:appgroup /app

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main"]
