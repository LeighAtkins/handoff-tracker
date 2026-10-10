# Next.js web app. Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile -t handoff-web .
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# Prune the monorepo to just the web app and its workspace dependencies, with a pruned lockfile.
FROM base AS prune
COPY . .
RUN npx -y turbo@2.11.7 prune @handoff/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
# turbo prune keeps workspace packages only; the shared TypeScript config lives at the root.
COPY tsconfig.base.json ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@handoff/web

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# The server needs node only. Dropping the bundled npm/corepack removes their dependencies
# (and their CVEs) from the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
