# Deploying TestCrew

TestCrew runs as five pieces: **Postgres**, **Redis** (sessions + the audit queue),
the **API**, one or more **workers** (real browsers) and the **website**.
All of them build from `infrastructure/docker/Dockerfile` (targets `api`, `worker`,
`web`, `migrate`, `fixture`).

## Option A: one server with Docker (recommended for the beta)

A single VPS with **4 vCPU / 8 GB RAM** runs everything, including two workers
(up to four audits at once). Any provider works: Hetzner, DigitalOcean, Vultr, AWS Lightsail.

1. Create the server (Ubuntu 24.04) and install Docker:
   `curl -fsSL https://get.docker.com | sh`
2. Point two DNS **A records** at the server's IP, e.g. `app.yourdomain.com` and `api.yourdomain.com`.
3. On the server:
   ```bash
   git clone https://github.com/CoderAnurag007/TestCrew.git && cd TestCrew
   cp infrastructure/deploy/.env.production.example infrastructure/deploy/.env.production
   nano infrastructure/deploy/.env.production      # fill in domains, passwords, secrets, AI key
   docker compose -f infrastructure/deploy/docker-compose.prod.yml \
     --env-file infrastructure/deploy/.env.production up -d --build
   ```
4. Open `https://app.yourdomain.com`. Caddy fetches HTTPS certificates on first visit.

Generate each secret with `openssl rand -hex 32`. **Back up `CREDENTIAL_ENCRYPTION_KEY`**:
it decrypts saved logins and integration tokens, and cannot be recovered.

### Updating

```bash
git pull && docker compose -f infrastructure/deploy/docker-compose.prod.yml \
  --env-file infrastructure/deploy/.env.production up -d --build
```
Database migrations run automatically (the `migrate` service) before the API starts.

### Scaling

- More audits at once: raise `WORKER_REPLICAS` (each worker ≈ 1.5 GB RAM, two audits).
- Screenshots off the server disk: set the `S3_*` values (S3 or Cloudflare R2).
- Backups: dump Postgres daily, e.g. `docker compose exec postgres pg_dump -U testcrew testcrew > backup.sql`.

## Option B: a managed platform

Railway, Render or Fly.io can run the same images. Create managed Postgres and Redis,
then four services from this repo with the Dockerfile above:

| Service | Target | Notes |
|---|---|---|
| migrate | `migrate` | run once per deploy (release command) |
| api | `api` | port 3001, health check `/health` |
| worker | `worker` | no port; 2 GB RAM; scale for more audits |
| web | `web` | port 3000; build arg `NEXT_PUBLIC_API_URL=https://api…` |

Use the same environment variables as `.env.production.example`. API and worker need the
same `S3_*` settings (they don't share a disk on these platforms).

## Checking a deployment

`smoke.mjs` signs up, audits the built-in test shop, and reads back findings, a screenshot
and a public share link. CI runs it on every push (`.github/workflows/deploy-smoke.yml`)
against `docker-compose.smoke.yml`.
