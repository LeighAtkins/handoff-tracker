# Security

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security → Report a vulnerability) on this
repository rather than opening a public issue. Expect an acknowledgement within 3 working days.

This repository contains only code and fake data. The internal Comfort Works deployment is private,
and its data never enters this repository (see "Data" below).

## How findings are triaged

Findings come from three places: Trivy in CI (on every pull request and push to `main`),
Dependabot alerts and pull requests, and reports.

**What CI blocks on.** Trivy scans the lockfile, committed secrets and Dockerfiles, plus both
built images. CI fails on any **HIGH or CRITICAL** finding that has a fix available
(`--ignore-unfixed`). Unfixed findings and lower severities are reviewed weekly through
Dependabot instead of blocking work.

**Deciding what to do**, in order of preference:

1. **Upgrade** the direct dependency.
2. **Override** a transitive dependency in `pnpm-workspace.yaml` (`overrides:`), with a comment
   giving the advisory ID and the reason. Prefer same-major fixes. If a major bump is needed,
   check that the parent still works and say so in the comment. Remove the override once
   upstream catches up.
3. **Remove** what is vulnerable from the image if it is not needed at runtime. For example,
   the runtime images drop the npm bundled with Node, which cleared seven HIGH findings in
   npm's own dependencies.
4. **Accept** only when the vulnerable code is genuinely unreachable (e.g. a dev-only tool that
   never ships in an image). Add the ID to `.trivyignore` with the reason, who accepted it and a
   review date no more than 30 days out.

**Target times** from a finding appearing in CI or an alert:

| Severity     | Fix or accept within           |
| ------------ | ------------------------------ |
| Critical     | 2 days                         |
| High         | 7 days                         |
| Medium / Low | Next routine dependency update |

### Log

| Date       | Finding                                                    | Where                               | Action                                                               |
| ---------- | ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| 2026-10-10 | GHSA-3f6p-5ww8-9rcr (HIGH)                                 | `mysql2` via `prisma` CLI           | Override to `^3.22.0`                                                |
| 2026-10-10 | CVE-2026-40345 (HIGH)                                      | `deepmerge-ts` via `@prisma/config` | Override to `^8.0.0`; checked `prisma generate` and `migrate status` |
| 2026-10-10 | 7 HIGH in `brace-expansion`, `ip-address`, `tar`, `undici` | npm bundled in `node:24-alpine`     | Removed npm/corepack from runtime images                             |

## Data

- Real customer data lives only in the private deployment's database. It is never committed, never
  baked into images (`data/` is in `.gitignore` and `.dockerignore`, and CI fails if anything under
  `data/` is tracked), and never used in the public demo.
- Customer name and postcode are masked in the UI by default. Every reveal is written to the
  audit log.
- Sign-in is restricted to the company's Google domain plus an explicit allowlist. Roles limit
  who can change data, and every change is audited with the user's email.
- Secrets (auth secret, OAuth client, aggregator API keys, database password) come from the
  environment only.
