FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Copy all package.json files from the workspace so bun.lock stays consistent
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/docker/package.json ./packages/docker/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN bun install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/docker/ ./packages/docker/
COPY apps/api/ ./apps/api/

EXPOSE 3000

CMD ["bun", "apps/api/src/index.ts"]
