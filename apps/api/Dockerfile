# ---- Base: install + build ----
FROM node:24-alpine AS base
WORKDIR /app
# Copy workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# Prisma client must be generated for the target platform.
RUN npm run prisma:generate --workspace=@candle/api
RUN npm run build --workspace=@candle/shared
RUN npm run build --workspace=@candle/api
# Compile the DB seed to plain JS — the runtime image drops devDependencies
# (no ts-node), so the seed must execute as compiled JS.
RUN npx tsc -p apps/api/tsconfig.seed.json
# Prune dev dependencies for the runtime image.
RUN npm prune --omit=dev --workspace=@candle/api

# ---- Runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S candle && adduser -S candle -G candle
COPY --from=base /app/package.json /app/package-lock.json* ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/apps/api/dist-seed ./seed-dist
COPY --from=base /app/apps/api/prisma ./apps/api/prisma
COPY --from=base /app/apps/api/package.json ./apps/api/package.json
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/package.json
# Uploads dir must be writable by the non-root runtime user.
RUN mkdir -p /app/uploads && chown candle:candle /app/uploads
USER candle
EXPOSE 3001
# Default CMD starts the API only. docker-compose.yml overrides this for
# local dev to run `prisma migrate deploy` + the DB seed first.
CMD ["node", "apps/api/dist/main.js"]
