# syntax=docker/dockerfile:1.7

# ---- Shared base: pnpm toolchain + non-root user prep ----
FROM node:24-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    COREPACK_ENABLE_PROJECT_SPEC=0

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

# ---- Stage 1: full dependency install (used by build & migrations) ----
FROM base AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Stage 2: build the NestJS app ----
FROM base AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# package.json needed so `pnpm build` can resolve the `nest build` script
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# TS / Nest / SWC config + drizzle config (imported via dotenv at build time)
COPY tsconfig.json tsconfig.build.json nest-cli.json .swcrc drizzle.config.ts ./
COPY src ./src

RUN pnpm build

# ---- Stage 3: one-shot migrations ----
FROM deps AS migrations

WORKDIR /app

COPY drizzle.config.ts ./
COPY drizzle ./drizzle

USER node

CMD ["node", "node_modules/drizzle-kit/bin.cjs", "migrate"]

# ---- Stage 4: production runtime ----
FROM base AS runtime

ENV NODE_ENV=production \
    APP_PORT=4000

WORKDIR /app

# Production-only dependency install (excludes devDependencies like drizzle-kit, vitest)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store-prod,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# Built artifacts
COPY --from=build /app/dist ./dist

# SQLite volume mount point, writable by the non-root 'node' user
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 4000

CMD ["node", "dist/main.js"]
