# AI App Auditor

Production-grade control plane for autonomous web application audits. The product explores a target app, generates executable tests from the discovered graph, runs them, and produces findings plus a quality report.

## Architecture

```
apps/web        Next.js dashboard (command center)
apps/api        Fastify control-plane API
apps/worker     BullMQ worker (explore → generate tests → execute → analyze)
apps/fixture    Intentionally buggy demo app for end-to-end audits

packages/shared     Zod domain models and HTTP contracts
packages/database   Prisma schema, client, AES-256-GCM secret store
packages/config     Environment validation
packages/logger     Pino + Sentry-ready error reporter
packages/ai         Provider-agnostic AI gateway, explorer and analysis agents
packages/browser    Playwright sessions, observers, selectors
packages/flow-engine  State graph, action extraction, exploration limits
packages/test-engine  Test planning, generation, assertions, isolated runner
packages/analyzer   Bug/UX/a11y/visual analysis, scoring, S3-compatible storage
```

Tenant-owned tables always include `organizationId`. API queries are membership-scoped. Credential secrets are encrypted before persistence and never returned from GET APIs.

```
Browser --cookie session--> Fastify API --> PostgreSQL
                         |--> Redis (sessions + BullMQ)
Worker  <----- BullMQ ---- Redis
Worker  -----------------> PostgreSQL
```

## Local setup

Requirements: Node 22+, pnpm 9+. PostgreSQL is required. Redis is required for the worker and for multi-instance API sessions.

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

If Docker is unavailable, point `DATABASE_URL` at a local Postgres database and set `REDIS_URL=memory://local` so the API can run without Redis. In that mode the worker stays idle and run jobs are not processed.

- Web: http://localhost:3000
- API: http://localhost:3001
- OpenAPI: http://localhost:3001/docs

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | api, worker, prisma | PostgreSQL connection |
| `REDIS_URL` | api, worker | Sessions and job queue |
| `SESSION_SECRET` | api | Cookie signing / session hardening (>= 32 chars) |
| `CREDENTIAL_ENCRYPTION_KEY` | api, worker | 64 hex chars (32-byte AES key) |
| `WEB_ORIGIN` | api | CORS and Origin allowlist |
| `NEXT_PUBLIC_API_URL` | web | Browser API base URL |
| `COOKIE_SECURE` / `COOKIE_DOMAIN` | api | Production cookie flags |
| `SENTRY_DSN` | api, worker | Optional error reporting |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | worker | Optional OpenAI. Unused when Gemini is configured. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | worker | Optional Gemini. Preferred when `AI_PROVIDER=auto` and the key is set. |
| `AI_PROVIDER` | worker | `auto` (default), `gemini`, `openai`, or `heuristic`. |
| `S3_*` / `ARTIFACT_DIR` | api, worker | Object storage for screenshots, DOM, traces. DB stores keys only. |

Never commit `.env`. Rotate `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` outside local development.

## Database

Prisma schema lives in `packages/database/prisma/schema.prisma`.

```bash
pnpm db:generate          # prisma generate
pnpm db:migrate           # prisma migrate dev
pnpm db:migrate:deploy    # prisma migrate deploy
pnpm db:studio
```

## Commands

```bash
pnpm dev          # web + api + worker
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## Testing

API integration tests use Fastify `inject` against PostgreSQL. Sessions and the run queue use an in-memory adapter when `NODE_ENV=test`, so Redis is not required for `pnpm test`. Start Postgres first:

```bash
docker compose up -d postgres
# or use a local Postgres instance and set DATABASE_URL
pnpm db:migrate:deploy
pnpm test
```

Coverage includes Zod validation, authorization ranking, authentication, project tenant isolation, and run queue/cancel.

## Deployment overview

1. Provision PostgreSQL, Redis, and (later) S3-compatible storage.
2. Set production env vars. Enable `COOKIE_SECURE=true` and a shared `COOKIE_DOMAIN` when the API and web app are on sibling subdomains.
3. Run `pnpm db:migrate:deploy`.
4. Build and run `apps/api`, `apps/worker`, and `apps/web`. Dockerfiles are in `infrastructure/docker/`.
5. Put the API behind TLS. Keep `WEB_ORIGIN` exact. Rate limits are Redis-backed so API instances can scale horizontally.
6. Sessions live in Redis, so any API replica can authenticate a user.

## Security notes

- Passwords are hashed with Argon2id.
- Session IDs are HTTP-only, `SameSite=Lax` cookies.
- Mutating requests in production require a matching `Origin`.
- Secrets are AES-256-GCM (`LocalAesGcmSecretStore`), swappable for Vault/AWS Secrets Manager via `SecretStore`.
- Structured Pino logs redact passwords, secrets, and cookies. Every response includes `x-request-id`.

## Part 3 capabilities

After an audit starts, the worker explores the app, builds a flow graph, generates tests from discovered controls (never invented selectors), executes them in isolated browser contexts, detects bugs/UX/accessibility/visual issues, and writes a deterministic quality score plus report.

The run page includes Overview, Live Run, Flows, Tests, Findings, Evidence, and Report tabs. Video recording is optional per project because it increases storage cost.

## Limitations

- Authentication is username/password only.
- Compose starts only Postgres and Redis (no MinIO). Local disk storage is the default.
- No SSO, billing, or magic-link invites.
