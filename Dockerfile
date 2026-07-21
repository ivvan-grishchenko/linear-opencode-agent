# ---- Stage 1: deps ----
FROM node:24-slim AS deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    COREPACK_ENABLE_PROJECT_SPEC=0

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Stage 2: build ----
FROM node:24-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    COREPACK_ENABLE_PROJECT_SPEC=0

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Manifest needed for `pnpm build` to find the script
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# TS / Nest / SWC config needed for `nest build`
COPY tsconfig.json tsconfig.build.json nest-cli.json .swcrc ./
# Drizzle config is imported by source via drizzle-kit (not needed at runtime, but harmless)
COPY drizzle.config.ts ./
COPY src ./src

RUN pnpm build

# ---- Stage 3: migrations ----
FROM deps AS migrations

WORKDIR /app

COPY drizzle.config.ts ./
COPY drizzle ./drizzle

# SQLite file lives on a volume mounted at /data; make it writable by the node user
RUN mkdir -p /data && chown node:node /data

USER node

# Invoke drizzle-kit directly: the corepack/pnpm activation in the deps stage was
# done as root, so pnpm is not reliably available for the node user
CMD ["node", "node_modules/drizzle-kit/bin.cjs", "migrate"]

# ---- Stage 4: runtime ----
FROM node:24-slim AS runtime

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    APP_PORT=4000 \
    COREPACK_ENABLE_PROJECT_SPEC=0

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /app

# Install production dependencies only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# Built artifacts
COPY --from=build /app/dist ./dist

# SQLite file lives on a volume mounted at /data; make it writable by the node user
RUN mkdir -p /data && chown node:node /data

# Drop root (node:24-slim ships a non-root 'node' user with UID 1000)
USER node

EXPOSE 4000

# Healthy defaults; override via env at runtime
CMD ["node", "dist/main.js"]
