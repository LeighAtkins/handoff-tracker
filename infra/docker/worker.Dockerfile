# Polling worker. Also carries the Prisma CLI, so it runs migrations too:
#   docker build -f infra/docker/worker.Dockerfile -t handoff-worker .
#   docker run --rm -e DATABASE_URL=... handoff-worker pnpm --dir /app/packages/db migrate:deploy
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS prune
COPY . .
RUN npx -y turbo@2.11.7 prune @handoff/worker --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
# turbo prune keeps workspace packages only; the shared TypeScript config lives at the root.
COPY tsconfig.base.json ./
RUN pnpm turbo run generate --filter=@handoff/db

FROM base AS run
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
# tsx is a dependency of the worker package, so run from there. One run by default
# (Kubernetes CronJob); Compose passes --loop.
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/index.ts"]
