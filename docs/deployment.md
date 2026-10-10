# Deployment

Two very different environments:

|         | Public repo / demo                | Private deployment (Comfort Works trial)         |
| ------- | --------------------------------- | ------------------------------------------------ |
| Data    | Seeded fake data (`DEMO-` orders) | Real orders imported from NOMS / Shopify exports |
| Sign-in | Developer login on localhost      | Google sign-in restricted to the company domain  |
| Where   | Your machine, CI, kind (Phase 6)  | One small private server                         |

P3 applies throughout: real customer data lives only in the private deployment's database. It is
never committed, never put in an image (`data/` is in `.dockerignore`), and never copied into the demo.

## Recommended private setup: one small VM

For two to three users over a two-week trial, the cheapest setup that is still done properly is
a single VM running Docker Compose (`infra/deploy/docker-compose.prod.yml`):

- **Caddy** terminates HTTPS with an automatic Let's Encrypt certificate, redirects HTTP to HTTPS,
  and adds HSTS and basic security headers.
- **web** and **worker** use the images from `infra/docker/`.
- **Postgres** is not published to the internet. Only web and worker can reach it.

Any 1 vCPU / 1–2 GB VM is enough, for example AWS Lightsail, Hetzner Cloud or a small EC2 instance,
typically around US$5 a month. Reusing an existing App Runner / Fargate setup also works: run
the two images there and point them at a managed Postgres. Kubernetes is not worth it for the trial.

### Steps

1. **Google OAuth client**: in Google Cloud Console → APIs & Services → Credentials, create an
   OAuth client of type _Web application_. Authorised redirect URI:
   `https://<DOMAIN>/auth/google/callback`. If Comfort Works uses Google Workspace, set the
   consent screen to _Internal_ so only company accounts can even try.
2. **DNS**: point `<DOMAIN>` (e.g. a subdomain you control) at the VM's IP.
3. **Server**: install Docker, copy `infra/deploy/` to it, and create `.env.prod` from
   `.env.prod.example`. Generate secrets with `openssl rand -base64 32`.
4. **Start**: `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d`.
   Migrations run first (the `migrate` service), then web and worker start.
5. **First admin**: the first person to sign in with a company address becomes a viewer.
   Promote them once:
   `docker compose exec postgres psql -U handoff -c "update \"User\" set role='ADMIN' where email='you@comfort-works.com';"`
   After that, admins manage everyone else at `/admin/users`.
6. **Carriers**: until ADR-0003 is settled, set the 4PX and SAGAWA carriers to the chosen
   aggregator: `update "Carrier" set adapter='ship24' where code in ('4PX','SAGAWA');`
   (Carriers are created on first import.)

### Firewall

Allow only 22 (SSH, ideally restricted to your IP) and 80/443. Postgres is never exposed.

### Backups

A daily dump, kept for 14 days:

```sh
# crontab -e on the VM
0 3 * * * cd /opt/handoff/infra/deploy && docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U handoff handoff | gzip > backups/handoff-$(date +\%F).sql.gz && find backups -mtime +14 -delete
```

### Ending the trial

`docker compose down -v` removes the containers **and the database volume**. Delete the backups
and the VM too. Nothing else holds customer data.

## Environment variables

| Variable                                    | Used by     | Notes                                                                      |
| ------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                              | web, worker | Set by the compose file                                                    |
| `AUTH_SECRET`                               | web         | 32+ random characters; required in production                              |
| `APP_URL`                                   | web         | `https://<DOMAIN>`; builds the OAuth redirect URI and marks cookies Secure |
| `ALLOWED_EMAIL_DOMAIN`                      | web         | Verified Google accounts at this domain may sign in as viewers             |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | web         | OAuth client from step 1                                                   |
| `APP_TIME_ZONE`                             | web         | Times shown to staff; default `Asia/Tokyo`                                 |
| `SHIP24_API_KEY` etc.                       | worker      | Only the aggregator in use                                                 |
| `WORKER_INTERVAL_SECONDS`                   | worker      | Loop interval; carrier poll intervals still apply                          |
| `AUTH_DEV_LOGIN`                            | web         | **Local development and CI only.** Also restricted to localhost            |

## Running the containers locally

`docker compose --profile app up --build` runs Postgres, migrations, web (http://localhost:3200)
and the worker loop against the local database.
