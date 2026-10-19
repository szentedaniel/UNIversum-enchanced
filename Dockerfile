# syntax=docker/dockerfile:1

# Two targets, both built by `docker compose build` (see compose.yaml):
#   server: the Colyseus Room server on Node, run from its TypeScript source
#           (Node strips the types; no bundler, no `pnpm deploy`).
#   web:    Caddy holding the Vite build, serving it and proxying /colyseus/*.

# --- pnpm on Node, shared by both build stages -------------------------------
FROM node:26-slim AS pnpm
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PNPM_STORE_DIR=/pnpm/store PATH=/pnpm:$PATH
# The pnpm version comes from `packageManager` in package.json, as on dev machines and CI.
COPY package.json ./
RUN npm install --global --no-fund --no-audit "$(node -p 'require("./package.json").packageManager')"
COPY . .

# --- server: production dependencies of the server and its workspace packages -
FROM pnpm AS server-build
# `@universum/server...` = the server plus the workspace packages it depends on.
# Workspace packages stay symlinked source folders: Node refuses to strip types
# from .ts files that really live inside node_modules.
RUN --mount=type=cache,id=universum-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@universum/server..."

FROM node:26-slim AS server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=2567 DATA_DIR=/data
WORKDIR /app
COPY --from=server-build /app/package.json ./
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/packages ./packages
COPY --from=server-build /app/apps/server ./apps/server
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 2567
# The same entry as `pnpm dev` (minus --watch) and `pnpm --filter @universum/server start`.
CMD ["node", "src/main.ts"]

# --- web: the Vite build -------------------------------------------------------
FROM pnpm AS web-build
# Installing the web app also compiles its Paraglide messages (postinstall).
RUN --mount=type=cache,id=universum-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@universum/web..."
# Vite writes hidden source maps; they stay out of the image (Caddy refuses *.map too).
RUN pnpm --filter @universum/web run build \
    && find apps/web/dist -name '*.map' -delete

FROM caddy:2.11-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
