FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

# Copy all package.json files from the workspace so bun.lock stays consistent
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/docker/package.json ./packages/docker/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/

WORKDIR /app/apps/web
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
