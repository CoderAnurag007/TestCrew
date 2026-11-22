# Product analytics

Snaghunt sends product events to [PostHog](https://posthog.com) so we can see where people
drop off between the first visit and a paying workspace.

## Turning it on

1. Create a free PostHog Cloud project (US or EU region).
2. Copy the **Project API key** (starts with `phc_`).
3. Set it for the web app, then rebuild or restart it:
   - local: `apps/web/.env.local` → `NEXT_PUBLIC_POSTHOG_KEY=phc_...`
   - production: `infrastructure/deploy/.env.production` → `NEXT_PUBLIC_POSTHOG_KEY` (it is baked in at build time)
   - EU project: also set `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`

Without a key nothing is loaded and nothing is sent.

## Privacy choices (see `apps/web/lib/analytics.ts`)

- No autocapture and no session recording: only the events below and page views.
- No cookies: the visitor id lives in localStorage. Do Not Track turns analytics off.
- People are identified by their user id only, never their name or email.
- Share-link and free-check tokens are removed from every URL before it is sent.

## Events

| Event | When | Properties |
|---|---|---|
| `$pageview` | Every page change | (URL with tokens removed) |
| `free_check_started` | Free check started from the home page | `source` (hero, cta, check-page), `reused` |
| `free_check_failed` | Free check could not start, or the run failed | `stage`, `status` |
| `free_check_completed` | Free check results shown | `score`, `issues`, `bugs` |
| `free_check_signup_clicked` | "See the full report" on a free check | `signedIn`, `locked` |
| `signed_up` | Account created | `via` (free_check or direct) |
| `logged_in` | Signed in | `withFreeCheck` |
| `free_check_claimed` | Free check saved into a workspace | |
| `site_added` | Site added | `first` |
| `audit_started` | Audit started | `first`, `type` (full, design, bugs), `device` |
| `report_viewed` | A finished report opened | `designOnly`, `findings` |
| `share_link_created` | Share link made for a report | |
| `shared_report_viewed` | A shared report with the "Checked by Snaghunt" footer opened | `poweredBy` |
| `shared_report_cta_clicked` | "Check your site free" on a shared report | |
| `pricing_cta_clicked` | A plan button on the pricing section | `plan`, `billing`, `currency` |
| `upgrade_clicked` | Plan changed on the Plan page | `from`, `to` |

## Funnels to build in PostHog

**Acquisition (the main one):**
`$pageview` (path `/`) → `free_check_started` → `free_check_completed` →
`free_check_signup_clicked` → `signed_up` → `free_check_claimed` → `audit_started` → `upgrade_clicked`

**Direct sign-ups:** `signed_up` (via = direct) → `site_added` → `audit_started` → `report_viewed`

**Word of mouth:** `share_link_created` → `shared_report_viewed` → `shared_report_cta_clicked` → `free_check_started`

Weekly numbers to watch: free checks started, completion rate (completed ÷ started),
check-to-sign-up rate, sign-up-to-first-report rate, and shared reports viewed.
