# One Dockerfile, four targets: api, worker, web, fixture.
#   docker build -f infrastructure/docker/Dockerfile --target api .
# Packages are used straight from source (tsx), so there is no compile step
# beyond Prisma's client and the Next.js build.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------- deps
FROM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @auditor/database generate

# ---------------------------------------------------------------- api
FROM deps AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@auditor/api", "start"]

# One-shot job that brings the database schema up to date.
FROM deps AS migrate
CMD ["pnpm", "--filter", "@auditor/database", "migrate:deploy"]

# ---------------------------------------------------------------- worker
# Chrome and WebKit (Safari) need system libraries Alpine does not have,
# so the worker installs Playwright's browsers with their Debian dependencies.
FROM deps AS worker
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd apps/worker \
 && pnpm exec playwright install --with-deps chromium chromium-headless-shell webkit \
 && rm -rf /var/lib/apt/lists/*
CMD ["pnpm", "--filter", "@auditor/worker", "start"]

# ---------------------------------------------------------------- web
FROM deps AS web-build
# Baked into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL
# Optional product analytics (PostHog); off when the key is empty.
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST} \
    NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "Set --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain" && exit 1)
RUN pnpm --filter @auditor/web build

FROM web-build AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@auditor/web", "start"]

# ---------------------------------------------------------------- fixture
# A small test shop with planted bugs, used by the deploy smoke test.
FROM deps AS fixture
ENV FIXTURE_HOST=0.0.0.0 \
    FIXTURE_PORT=4173
EXPOSE 4173
CMD ["pnpm", "--filter", "@auditor/fixture", "start"]
