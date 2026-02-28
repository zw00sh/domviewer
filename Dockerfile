# Stage 1: build
# Installs all dependencies (including devDeps for esbuild/vite), compiles
# better-sqlite3 native addon, and produces the dist/ artefacts.
FROM node:22-slim AS build

# Build tools required to compile better-sqlite3 native bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root deps (includes esbuild, vitest)
COPY package.json package-lock.json ./
RUN npm ci

# Install web deps
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web

# Copy full source and build everything
COPY . .
RUN npm run build:all

# Drop devDependencies so production stage only copies what's needed at runtime
RUN npm prune --omit=dev


# Stage 2: production
# Lean runtime image — no build tools, only the compiled artefacts and
# production node_modules (including the pre-built better-sqlite3 native addon).
FROM node:22-slim AS production

ENV NODE_ENV=production

WORKDIR /app

# Runtime package metadata (needed for ESM "type": "module" resolution)
COPY --from=build /app/package.json ./

# Production node_modules with native addon already compiled
COPY --from=build /app/node_modules ./node_modules

# Server source files
COPY --from=build /app/server ./server

# Shared utilities used by both server and client bundles at runtime
COPY --from=build /app/shared ./shared

# Built client bundles + React SPA
COPY --from=build /app/dist ./dist

# SQLite database directory (mounted as a named volume at runtime)
RUN mkdir -p /app/data

EXPOSE 3000 3001

CMD ["node", "server/index.js"]
