# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

# npm 源，默认国内镜像；需要官方源可 docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json* ./
RUN npm config set registry "$NPM_REGISTRY" \
 && npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000

COPY . .
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# 非 root 用户
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 8080
CMD ["node", "server.js"]
