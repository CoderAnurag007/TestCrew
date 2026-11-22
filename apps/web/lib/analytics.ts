'use client';

import posthog from 'posthog-js';

/**
 * Product analytics (PostHog). Off unless NEXT_PUBLIC_POSTHOG_KEY is set.
 *
 * Privacy: no autocapture, no session recording, no cookies (localStorage
 * only), Do Not Track respected, and people are identified by their user id
 * only, never their name or email. Share-link and free-check tokens are
 * stripped from every URL before it is sent. See docs/analytics.md for the
 * events and the funnel they make.
 */

/** Every event the app sends; the funnel in docs/analytics.md is built from these. */
export type AnalyticsEvent =
  | 'free_check_started'
  | 'free_check_failed'
  | 'free_check_completed'
  | 'free_check_signup_clicked'
  | 'free_check_claimed'
  | 'signed_up'
  | 'logged_in'
  | 'site_added'
  | 'audit_started'
  | 'report_viewed'
  | 'share_link_created'
  | 'shared_report_viewed'
  | 'shared_report_cta_clicked'
  | 'upgrade_clicked'
  | 'pricing_cta_clicked';

type Properties = Record<string, string | number | boolean | null | undefined>;

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let started = false;

/** Secrets in our own URLs: share links, free checks, and email-link tokens. */
export function scrubUrl(value: string): string {
  return value
    .replace(/\/(r|check)\/[A-Za-z0-9_-]{8,}/g, '/$1/:token')
    .replace(/([?&](?:token|scan)=)[^&#]*/g, '$1:token');
}

export function initAnalytics(): void {
  if (started || !KEY || typeof window === 'undefined') return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',
    persistence: 'localStorage',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: true,
    disable_session_recording: true,
    respect_dnt: true,
    before_send: (event) => {
      if (!event) return event;
      for (const key of ['$current_url', '$pathname', '$referrer', '$initial_current_url', '$initial_pathname']) {
        const value = event.properties?.[key];
        if (typeof value === 'string') event.properties[key] = scrubUrl(value);
      }
      return event;
    },
  });
}

export function track(event: AnalyticsEvent, properties?: Properties): void {
  if (!started) return;
  posthog.capture(event, properties);
}

export function trackPageview(): void {
  if (!started) return;
  posthog.capture('$pageview');
}

/** Ties events to the signed-in account by its id (no name or email). */
export function identify(userId: string, properties?: Properties): void {
  if (!started) return;
  if (posthog.get_distinct_id() !== userId) posthog.identify(userId, properties);
}

export function resetAnalytics(): void {
  if (!started) return;
  posthog.reset();
}
