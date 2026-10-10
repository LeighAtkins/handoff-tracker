<img src="assets/icon.svg" width="64" height="64" alt="">

# handoff-tracker

Follows parcels across carrier handoffs (e.g. 4PX China → Sagawa Japan), flags shipments that go
quiet, and gives staff one place to look.

All data in this repo is fake. Order numbers start with `DEMO-`.

## Quick start

Requires Node 24, Docker, and pnpm (`corepack enable`).

```sh
pnpm install
cp .env.example .env
pnpm db:setup   # start Postgres on :5433, apply migrations, seed 50 fake orders
pnpm dev        # http://localhost:3100
```

## Layout

| Path                | What                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `apps/web`          | Next.js app (App Router, Server Components, Server Actions)         |
| `apps/worker`       | Polling worker that pulls fresh tracking events                     |
| `packages/domain`   | Pure TypeScript domain model and rules. No Prisma, Next.js or fetch |
| `packages/db`       | Prisma schema, migrations, fake-data seed                           |
| `packages/carriers` | Carrier adapter interface and implementations                       |
| `e2e`               | Playwright tests                                                    |
| `infra`             | Dockerfiles, Helm, kind, Argo CD                                    |
| `docs/adr`          | Architecture decision records                                       |

## Scripts

| Command                               | What                                   |
| ------------------------------------- | -------------------------------------- |
| `pnpm dev`                            | Run the web app                        |
| `pnpm lint` / `typecheck` / `test`    | What CI runs                           |
| `pnpm db:migrate`                     | Create a migration after a schema edit |
| `pnpm db:reset`                       | Drop, re-migrate and reseed            |
| `pnpm --filter @handoff/worker start` | Run the worker once                    |

## Decisions

- [ADR-0001: Project scope and stack](docs/adr/0001-project-scope-and-stack.md)
