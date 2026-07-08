# syntax=docker/dockerfile:1.6
# Multi-stage build for self-hosting Confer.
# Stage 1: build all workspaces
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install all deps (including dev) for the build.
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY cli/package.json cli/
RUN npm ci --no-audit --no-fund

# Copy source and build.
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/src/ server/src/
COPY server/tsconfig.json server/
COPY web/ web/
COPY cli/src/ cli/src/
COPY cli/SKILL.md cli/
COPY cli/tsconfig.json cli/

RUN npm run build

# Stage 2: runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV VIEW_PORT=5174
ENV DB_PATH=/app/data/confer.db
ENV BLOB_DIR=/app/blobs

# Only the production dependencies.
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY cli/package.json cli/
RUN npm ci --omit=dev --no-audit --no-fund

# Built artifacts.
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/cli/dist cli/dist
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/shared/src shared/src

# Caddy is the front door — routes by Host header to the two ports.
RUN apt-get update && apt-get install -y --no-install-recommends caddy ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY Caddyfile /etc/caddy/Caddyfile

# The Node process binds BOTH the app port and the view port via serve-both.
EXPOSE 80
VOLUME ["/app/data", "/app/blobs"]

CMD ["node", "server/dist/serve-both.js"]
