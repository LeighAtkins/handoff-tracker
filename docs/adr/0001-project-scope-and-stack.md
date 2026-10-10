# ADR-0001: Project scope and stack

- Status: Accepted
- Date: 2026-10-10

## Context

At Comfort Works, parcels from China often travel with 4PX first, then get handed to Sagawa
for the last mile in Japan. The 4PX tracking page goes quiet after the handover, and the
Sagawa leg uses a different tracking number. To find out where a parcel is, staff check
two carrier sites by hand, and parcels that stall after the handoff are easy to miss.

This is also a portfolio project, so the stack should match the one used by teams I want
to work with, and I should be able to explain every part of it.

## Decision

Build a small internal web app that tracks each shipment one leg at a time, normalises
carrier events into a single status model, and lists shipments that have gone quiet.

Stack:

- **TypeScript (strict), Next.js App Router, React** for the UI and mutations (Server Actions),
  so there is no separate API service to deploy for v1.
- **Prisma + PostgreSQL**: a relational store fits Order → Shipment → Leg → TrackingEvent,
  and migrations are reviewable in PRs.
- **pnpm workspaces + Turborepo**: the domain model (`packages/domain`) is kept apart from
  Prisma, Next.js and network code, so its rules can be unit tested on their own.
- **Zod** for anything crossing a trust boundary (CSV rows, forms, carrier responses).
- **Vitest** for unit tests, **Playwright** for the three core flows.
- **Docker Compose** for local dev. Kubernetes (kind + Helm + Argo CD) arrives in Phase 6
  and is optional for the private deployment.

## Out of scope

- Scraping carrier sites or bypassing CAPTCHAs. Only official or aggregator APIs are used.
  Carriers with no API are tracked as manual-check legs.
- Automatic messages to customers.
- Writing back to Shopify or NOMS (read only).
- Multi-tenant SaaS features.
- ML-based delay prediction.

## Consequences

- Real customer data stays in the private deployment. The repo ships with seeded fake data
  only (`DEMO-` order numbers), `/data` is gitignored, and CI fails if anything under it is
  tracked.
- Using Server Actions ties mutations to Next.js. If another client ever needs them,
  they can be moved behind route handlers.
- The domain package must stay free of framework imports. Review enforces this for now;
  a lint rule can be added if it starts slipping.
