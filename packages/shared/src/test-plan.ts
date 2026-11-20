import { z } from 'zod';

/**
 * Per-project test plan: what kind of app this is, which business journeys to
 * run, what data to use, and how far transactional flows may go.
 *
 * Safety is enforced in layers and this plan can only narrow it:
 * - transactions (placing orders, bookings) run only on a STAGING environment
 *   in FULL mode;
 * - payments run only with a provider's published sandbox test card, and the
 *   browser refuses any payment request that carries a live key;
 * - production never places orders, whatever the plan says.
 */

export const appCategorySchema = z.enum(['auto', 'ecommerce', 'saas', 'booking', 'content', 'tools', 'generic']);
export type AppCategory = z.infer<typeof appCategorySchema>;
export type ResolvedCategory = Exclude<AppCategory, 'auto'>;

export const environmentKindSchema = z.enum(['PRODUCTION', 'STAGING']);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;

export const paymentProviderSchema = z.enum(['stripe', 'braintree', 'adyen', 'razorpay', 'checkout', 'other']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

/**
 * Published sandbox card numbers. Only these may be saved in a test plan; a
 * real card number is rejected by validation before it is ever stored.
 */
export const SANDBOX_TEST_CARDS: Record<PaymentProvider, Array<{ number: string; label: string }>> = {
  stripe: [
    { number: '4242424242424242', label: 'Visa, succeeds' },
    { number: '5555555555554444', label: 'Mastercard, succeeds' },
    { number: '4000000000000002', label: 'Visa, declined' },
    { number: '4000002500003155', label: 'Visa, needs 3-D Secure' },
  ],
  braintree: [
    { number: '4111111111111111', label: 'Visa, succeeds' },
    { number: '5555555555554444', label: 'Mastercard, succeeds' },
  ],
  adyen: [
    { number: '4111111145551142', label: 'Visa, succeeds' },
    { number: '5555341244441115', label: 'Mastercard, succeeds' },
  ],
  razorpay: [
    { number: '4111111111111111', label: 'Visa, succeeds' },
    { number: '5267318187975449', label: 'Mastercard, succeeds' },
  ],
  checkout: [{ number: '4242424242424242', label: 'Visa, succeeds' }],
  other: [
    { number: '4242424242424242', label: 'Generic test Visa' },
    { number: '4111111111111111', label: 'Generic test Visa' },
  ],
};

export function isSandboxTestCard(provider: PaymentProvider, number: string): boolean {
  const digits = number.replace(/\D/g, '');
  return SANDBOX_TEST_CARDS[provider].some((card) => card.number === digits);
}

/** Markers of live (real-money) payment configuration seen in page source or requests. */
export const LIVE_PAYMENT_KEY_PATTERN = /\b(pk_live_|sk_live_|rk_live_|rzp_live_|live_[a-z0-9]{8,}_adyen|production_[a-z0-9]{6,}_braintree)/i;
/** Markers of sandbox payment configuration. */
export const TEST_PAYMENT_KEY_PATTERN = /\b(pk_test_|rzp_test_|sandbox_[a-z0-9]{6,}|test_[A-Z0-9]{10,})/;

export const testDataSchema = z.object({
  firstName: z.string().max(60).default('Ada'),
  lastName: z.string().max(60).default('Tester'),
  email: z.string().max(160).default(''),
  phone: z.string().max(40).default('5550100123'),
  company: z.string().max(120).default(''),
  address1: z.string().max(160).default('221 Test Street'),
  address2: z.string().max(160).default(''),
  city: z.string().max(80).default('Springfield'),
  state: z.string().max(80).default('CA'),
  postalCode: z.string().max(20).default('94016'),
  country: z.string().max(80).default('United States'),
  coupon: z.string().max(60).default(''),
  searchTerms: z.array(z.string().min(1).max(80)).max(10).default([]),
  /** Extra field values keyed by field name or label, e.g. { "gst number": "29ABCDE1234F1Z5" }. */
  custom: z.record(z.string().max(80), z.string().max(200)).default({}),
});
export type TestData = z.infer<typeof testDataSchema>;

/** Roles a pack looks for. Hints map a role to the exact label your app uses. */
export const controlRoleSchema = z.enum([
  'search',
  'product_link',
  'add_to_cart',
  'cart',
  'quantity',
  'remove_from_cart',
  'checkout',
  'continue',
  'place_order',
  'login',
  'signup',
  'create',
  'save',
  'delete',
  'book',
  'select_date',
  'select_slot',
  'subscribe',
]);
export type ControlRole = z.infer<typeof controlRoleSchema>;

export const controlHintSchema = z.object({
  role: controlRoleSchema,
  label: z.string().min(1).max(120),
});
export type ControlHint = z.infer<typeof controlHintSchema>;

/** A step of a custom journey, written by people, resolved against the live page at run time. */
export const customStepSchema = z.object({
  action: z.enum(['goto', 'click', 'fill', 'select', 'press', 'expect_text', 'expect_no_text', 'expect_url', 'wait']),
  /** Visible label, placeholder, or name of the control; a path for goto/expect_url; text for expect_text. */
  target: z.string().max(300).default(''),
  value: z.string().max(300).default(''),
});
export type CustomStep = z.infer<typeof customStepSchema>;

export const customJourneySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  /** Changes data (submits, orders): only runs in FULL mode; transactional ones only on staging. */
  mutates: z.boolean().default(false),
  transactional: z.boolean().default(false),
  steps: z.array(customStepSchema).min(1).max(40),
});
export type CustomJourney = z.infer<typeof customJourneySchema>;

export const testPlanSchema = z
  .object({
    category: appCategorySchema.default('auto'),
    interactionMap: z
      .object({
        enabled: z.boolean().default(true),
        /** Most controls to probe on one screen. */
        maxControlsPerScreen: z.number().int().min(5).max(200).default(40),
        maxScreens: z.number().int().min(1).max(100).default(20),
        /** Total time budget for probing, in minutes. */
        budgetMinutes: z.number().int().min(1).max(60).default(6),
        excludeLabels: z.array(z.string().min(1).max(80)).max(50).default([]),
      })
      .default({ enabled: true, maxControlsPerScreen: 40, maxScreens: 20, budgetMinutes: 6, excludeLabels: [] }),
    /** Pack journey ids switched off for this project (all are on by default). */
    disabledJourneys: z.array(z.string().max(64)).max(100).default([]),
    transactions: z
      .object({
        /** Place orders/bookings end to end. Only ever on a STAGING environment in FULL mode. */
        enabled: z.boolean().default(false),
        maxPerRun: z.number().int().min(1).max(10).default(1),
        /** Where to stop: before payment, before the final submit, or run to completion. */
        stopBefore: z.enum(['payment', 'place_order', 'none']).default('payment'),
      })
      .default({ enabled: false, maxPerRun: 1, stopBefore: 'payment' }),
    payment: z
      .object({
        mode: z.enum(['never', 'sandbox']).default('never'),
        provider: paymentProviderSchema.default('stripe'),
        cardNumber: z.string().max(23).default(''),
        expiry: z.string().max(7).default('12/34'),
        cvc: z.string().max(4).default('123'),
        nameOnCard: z.string().max(80).default('TestCrew QA'),
      })
      .default({ mode: 'never', provider: 'stripe', cardNumber: '', expiry: '12/34', cvc: '123', nameOnCard: 'TestCrew QA' }),
    testData: testDataSchema.default(testDataSchema.parse({})),
    controlHints: z.array(controlHintSchema).max(50).default([]),
    customJourneys: z.array(customJourneySchema).max(30).default([]),
  })
  .superRefine((plan, ctx) => {
    if (plan.payment.mode === 'sandbox') {
      if (!isSandboxTestCard(plan.payment.provider, plan.payment.cardNumber)) {
        ctx.addIssue({
          code: 'custom',
          path: ['payment', 'cardNumber'],
          message: `Only published ${plan.payment.provider} sandbox test cards are allowed`,
        });
      }
    }
  });
export type TestPlan = z.infer<typeof testPlanSchema>;

export function parseTestPlan(value: unknown): TestPlan {
  const parsed = testPlanSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : testPlanSchema.parse({});
}

/* ----------------------------- results ----------------------------- */

export const controlOutcomeSchema = z.enum([
  'navigates',
  'opens_overlay',
  'changes_content',
  'expands',
  'opens_window',
  'downloads',
  'submits',
  'blocked_by_safety',
  'no_effect',
  'error',
  'skipped',
]);
export type ControlOutcome = z.infer<typeof controlOutcomeSchema>;

export interface OverlayReport {
  title: string;
  kind: 'dialog' | 'drawer' | 'popover' | 'banner';
  controls: number;
  probed: Array<{ label: string; outcome: ControlOutcome; detail: string }>;
  closedBy: 'close_button' | 'control' | 'escape' | 'backdrop' | 'none';
  closed: boolean;
  escapeCloses: boolean | null;
}

export interface ControlProbe {
  label: string;
  role: string | null;
  kind: string;
  selector: string;
  outcome: ControlOutcome;
  detail: string;
  destination?: string;
  status?: number;
  overlay?: OverlayReport;
  change?: string;
  blockedRequest?: string;
  error?: string;
  durationMs: number;
}

export interface ScreenMap {
  url: string;
  title: string;
  controlsFound: number;
  controls: ControlProbe[];
}

export interface InteractionMap {
  screens: ScreenMap[];
  totals: Record<ControlOutcome, number>;
  probed: number;
  durationMs: number;
  truncated: boolean;
}

export interface JourneyStepResult {
  index: number;
  goal: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  detail: string;
  url?: string;
  screenshotKey?: string;
  /** Evidence row for the step screenshot: GET /runs/:runId/evidence/:evidenceId */
  evidenceId?: string;
  checks?: Array<{ name: string; passed: boolean; expected?: string; actual?: string; explain?: CheckExplanation }>;
}

/**
 * How a failed check reads in the report, in the visitor's words: a title that
 * names the problem, a short explanation, numbered steps anyone can follow, and
 * where to look for the fix.
 */
export interface CheckExplanation {
  title: string;
  summary: string;
  steps: string[];
  expected?: string;
  actual?: string;
  fix?: string;
}

export interface JourneyResult {
  id: string;
  name: string;
  category: ResolvedCategory | 'custom';
  requires: 'readonly' | 'full' | 'transaction' | 'payment';
  status: 'passed' | 'failed' | 'skipped' | 'blocked' | 'partial';
  reason?: string;
  steps: JourneyStepResult[];
  durationMs: number;
}
