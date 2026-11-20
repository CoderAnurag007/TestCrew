import { z } from 'zod';
import type { Device, MonitorCadence } from './launch.js';

/** Paid plans. Prices are per month in USD; annual billing is shown as the monthly equivalent. */
export const planIdSchema = z.enum(['FREE', 'STARTER', 'PRO', 'AGENCY']);
export type PlanId = z.infer<typeof planIdSchema>;

export type PlanLimits = {
  /** Websites (projects) in the workspace. */
  sites: number;
  /** Audits per calendar month across the workspace, or null for no cap. */
  auditsPerMonth: number | null;
  devices: Device[];
  cadences: MonitorCadence[];
  tickets: boolean;
  alerts: boolean;
  /** Your own name, logo and colour on shared reports. */
  branding: boolean;
  /** Most AI spend per calendar month before audits fall back to the built-in rules. */
  aiBudgetUsd: number;
  /** Price of each site over the included number, or null when extra sites are not sold. */
  extraSiteUsd: number | null;
};

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  annualUsd: number;
  priceInr: number;
  tagline: string;
  limits: PlanLimits;
  highlights: string[];
};

const ALL_DEVICES: Device[] = ['desktop', 'phone', 'safari', 'iphone'];

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    priceUsd: 0,
    annualUsd: 0,
    priceInr: 0,
    tagline: 'Try it on one site',
    limits: {
      sites: 1,
      auditsPerMonth: 3,
      devices: ['desktop'],
      cadences: [],
      tickets: false,
      alerts: false,
      branding: false,
      aiBudgetUsd: 0.5,
      extraSiteUsd: null,
    },
    highlights: ['1 site', '3 audits a month', 'Desktop Chrome', 'Shareable report'],
  },
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    priceUsd: 39,
    annualUsd: 32,
    priceInr: 1499,
    tagline: 'One store or app, watched every day',
    limits: {
      sites: 1,
      auditsPerMonth: 60,
      devices: ['desktop', 'phone'],
      cadences: ['daily', 'weekly'],
      tickets: true,
      alerts: true,
      branding: false,
      aiBudgetUsd: 5,
      extraSiteUsd: null,
    },
    highlights: ['1 site', 'Daily audits', 'Phone and desktop', 'Slack and email alerts', 'GitHub, Jira and Linear tickets'],
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    priceUsd: 99,
    annualUsd: 79,
    priceInr: 3999,
    tagline: 'For product teams',
    limits: {
      sites: 5,
      auditsPerMonth: null,
      devices: ALL_DEVICES,
      cadences: ['daily', 'weekly'],
      tickets: true,
      alerts: true,
      branding: false,
      aiBudgetUsd: 20,
      extraSiteUsd: null,
    },
    highlights: ['5 sites', 'Unlimited audits', 'Safari and iPhone too', 'Everything in Starter'],
  },
  AGENCY: {
    id: 'AGENCY',
    name: 'Agency',
    priceUsd: 299,
    annualUsd: 239,
    priceInr: 11999,
    tagline: 'Every client site, with your brand',
    limits: {
      sites: 25,
      auditsPerMonth: null,
      devices: ALL_DEVICES,
      cadences: ['hourly', 'daily', 'weekly'],
      tickets: true,
      alerts: true,
      branding: true,
      aiBudgetUsd: 60,
      extraSiteUsd: 10,
    },
    highlights: ['25 sites, then $10 per site', 'Your logo on client reports', 'Hourly checks', 'Everything in Pro'],
  },
};

export const PLAN_ORDER: PlanId[] = ['FREE', 'STARTER', 'PRO', 'AGENCY'];

/** New workspaces get the Pro plan free for this many days, no card needed. */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: PlanId = 'PRO';

export type PlanState = {
  plan: PlanId;
  trialEndsAt: Date | null;
  extraSites?: number;
};

/** The plan whose limits apply right now: the trial plan while a trial runs. */
export function effectivePlan(state: PlanState, now: Date = new Date()): PlanId {
  if (state.plan === 'FREE' && state.trialEndsAt && state.trialEndsAt.getTime() > now.getTime()) return TRIAL_PLAN;
  return state.plan;
}

export function limitsFor(state: PlanState, now: Date = new Date()): PlanLimits {
  const plan = PLANS[effectivePlan(state, now)];
  const extra = plan.limits.extraSiteUsd != null ? Math.max(0, state.extraSites ?? 0) : 0;
  return { ...plan.limits, sites: plan.limits.sites + extra };
}

/** The cheapest plan that allows something, for "upgrade to X" messages. */
export function cheapestPlanWith(test: (limits: PlanLimits) => boolean): Plan | null {
  for (const id of PLAN_ORDER) if (test(PLANS[id].limits)) return PLANS[id];
  return null;
}

export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Machine-readable reason sent with HTTP 402, so the app can show the right upgrade prompt. */
export const planLimitCodeSchema = z.enum(['sites', 'audits', 'device', 'cadence', 'tickets', 'alerts', 'branding']);
export type PlanLimitCode = z.infer<typeof planLimitCodeSchema>;

export type Usage = {
  plan: PlanId;
  effectivePlan: PlanId;
  trialEndsAt: Date | null;
  limits: PlanLimits;
  periodStart: Date;
  sites: number;
  audits: number;
  aiSpendUsd: number;
};
