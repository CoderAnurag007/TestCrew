'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import {
  CircleAlert,
  CreditCard,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  parseTestPlan,
  SANDBOX_TEST_CARDS,
  testPlanSchema,
  type AppCategory,
  type ControlHint,
  type ControlRole,
  type PaymentProvider,
  type ResolvedCategory,
  type TestPlan,
} from '@auditor/shared';
import { EmptyRow, FieldHint, SettingsSection, Switch } from '@/components/pages/settings-ui';
import { CustomJourneysCard } from '@/components/project/custom-journeys-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { projectApi, type ProjectDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';

/* ------------------------------ catalogues ------------------------------ */

const CATEGORY_OPTIONS: Array<{ value: AppCategory; label: string; description: string }> = [
  {
    value: 'auto',
    label: 'Auto-detect',
    description: 'TestCrew picks a category from the pages it finds.',
  },
  {
    value: 'ecommerce',
    label: 'E-commerce',
    description: 'Catalog, product pages, cart and checkout.',
  },
  {
    value: 'saas',
    label: 'SaaS / dashboard',
    description: 'Signed-in lists, records and settings.',
  },
  {
    value: 'booking',
    label: 'Booking',
    description: 'Availability search, time slots and reservations.',
  },
  {
    value: 'content',
    label: 'Content / media',
    description: 'Articles, listings, search and sign-ups.',
  },
  {
    value: 'tools',
    label: 'Online tools',
    description: 'Converters and file tools: pages load, real files are processed.',
  },
  { value: 'generic', label: 'Generic', description: 'Contact forms and sign-in pages only.' },
];

export type JourneyRequirement = 'readonly' | 'full' | 'transaction' | 'payment';

export const PACK_JOURNEYS: Record<
  ResolvedCategory,
  Array<{ id: string; name: string; requires: JourneyRequirement }>
> = {
  ecommerce: [
    { id: 'browse_catalog', name: 'Browse catalog to a product', requires: 'readonly' },
    { id: 'search_product', name: 'Search finds products', requires: 'readonly' },
    { id: 'add_to_cart', name: 'Add to cart updates the cart', requires: 'full' },
    { id: 'cart_math', name: 'Cart quantities and totals add up', requires: 'full' },
    { id: 'checkout_to_payment', name: 'Checkout up to payment', requires: 'transaction' },
    { id: 'place_order', name: 'Place an order end to end', requires: 'payment' },
  ],
  saas: [
    { id: 'auth_session', name: 'Sign in keeps the session across pages', requires: 'readonly' },
    { id: 'list_controls', name: 'Search, filter, sort and paging on lists', requires: 'readonly' },
    { id: 'crud_lifecycle', name: 'Create, edit and delete a record', requires: 'full' },
    { id: 'settings_persist', name: 'Settings changes are saved', requires: 'full' },
  ],
  booking: [
    { id: 'availability_search', name: 'Search availability', requires: 'readonly' },
    { id: 'booking_to_payment', name: 'Book a slot up to payment', requires: 'transaction' },
    { id: 'complete_booking', name: 'Complete a booking', requires: 'payment' },
  ],
  content: [
    { id: 'article_navigation', name: 'Open articles from listings', requires: 'readonly' },
    { id: 'content_search', name: 'Search content', requires: 'readonly' },
    { id: 'newsletter_signup', name: 'Newsletter / contact form', requires: 'full' },
  ],
  tools: [
    { id: 'tool_pages_load', name: 'Tool pages load and are ready to use', requires: 'readonly' },
    { id: 'tool_processes_file', name: 'Tools process a sample file', requires: 'readonly' },
    { id: 'tool_rejects_wrong_file', name: 'Tools explain unsupported files', requires: 'readonly' },
  ],
  generic: [
    { id: 'contact_form', name: 'Contact form submits', requires: 'full' },
    { id: 'auth_pages', name: 'Sign-in and sign-up pages work', requires: 'readonly' },
  ],
};

const CATEGORY_LABEL: Record<ResolvedCategory, string> = {
  ecommerce: 'E-commerce',
  saas: 'SaaS / dashboard',
  booking: 'Booking',
  content: 'Content / media',
  tools: 'Online tools',
  generic: 'Generic',
};

export function RequirementBadge({
  requires,
  className,
}: {
  requires: string | undefined;
  className?: string;
}) {
  switch (requires) {
    case 'readonly':
      return (
        <Badge variant="muted" className={className}>
          Read-only
        </Badge>
      );
    case 'full':
      return (
        <Badge variant="warning" className={className}>
          Full
        </Badge>
      );
    case 'transaction':
      return (
        <Badge variant="info" className={className}>
          Staging order
        </Badge>
      );
    case 'payment':
      return (
        <Badge variant="high" className={className}>
          <CreditCard className="size-3" aria-hidden />
          Staging + sandbox payment
        </Badge>
      );
    default:
      return null;
  }
}

const ROLE_LABELS: Record<ControlRole, string> = {
  search: 'Search box',
  product_link: 'Product link',
  add_to_cart: 'Add to cart',
  cart: 'Cart',
  quantity: 'Quantity',
  remove_from_cart: 'Remove from cart',
  checkout: 'Checkout',
  continue: 'Continue / next',
  place_order: 'Place order',
  login: 'Sign in',
  signup: 'Sign up',
  create: 'Create / new',
  save: 'Save',
  delete: 'Delete',
  book: 'Book',
  select_date: 'Pick a date',
  select_slot: 'Pick a time slot',
  subscribe: 'Subscribe',
};
const ROLES = Object.keys(ROLE_LABELS) as ControlRole[];

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: 'Stripe',
  braintree: 'Braintree',
  adyen: 'Adyen',
  razorpay: 'Razorpay',
  checkout: 'Checkout.com',
  other: 'Other',
};
const PROVIDERS = Object.keys(PROVIDER_LABELS) as PaymentProvider[];

const STOP_OPTIONS: Array<{ value: TestPlan['transactions']['stopBefore']; label: string }> = [
  { value: 'payment', label: 'Before payment' },
  { value: 'place_order', label: 'Before the final place-order click' },
  { value: 'none', label: 'Run to completion' },
];

/* ------------------------------ text helpers ------------------------------ */

type Draft = {
  plan: TestPlan;
  excludeText: string;
  searchText: string;
  customText: string;
};

function toDraft(plan: TestPlan): Draft {
  return {
    plan,
    excludeText: plan.interactionMap.excludeLabels.join('\n'),
    searchText: plan.testData.searchTerms.join('\n'),
    customText: Object.entries(plan.testData.custom)
      .map(([key, value]) => `${key} = ${value}`)
      .join('\n'),
  };
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseCustom(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function fromDraft(draft: Draft): TestPlan {
  const plan = draft.plan;
  return {
    ...plan,
    interactionMap: { ...plan.interactionMap, excludeLabels: lines(draft.excludeText) },
    testData: {
      ...plan.testData,
      searchTerms: lines(draft.searchText),
      custom: parseCustom(draft.customText),
    },
    controlHints: plan.controlHints.map((hint) => ({ ...hint, label: hint.label.trim() })),
  };
}

const PATH_LABELS: Record<string, string> = {
  interactionMap: 'Interaction map',
  transactions: 'Orders',
  payment: 'Payment',
  testData: 'Test data',
  controlHints: 'Control hints',
  customJourneys: 'Custom journeys',
  disabledJourneys: 'Journeys',
};

/* ------------------------------ main tab ------------------------------ */

export function TestPlanTab({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => toDraft(parseTestPlan(project.testPlan)), [project.testPlan]);
  const [baseline, setBaseline] = useState(() => JSON.stringify(fromDraft(initial)));
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);

  const built = fromDraft(draft);
  const dirty = JSON.stringify(built) !== baseline;
  const plan = draft.plan;

  const setPlan = (patch: Partial<TestPlan>) =>
    setDraft((current) => ({ ...current, plan: { ...current.plan, ...patch } }));
  function setIn<K extends 'interactionMap' | 'transactions' | 'payment' | 'testData'>(
    key: K,
    patch: Partial<TestPlan[K]>,
  ) {
    setDraft((current) => ({
      ...current,
      plan: { ...current.plan, [key]: { ...current.plan[key], ...patch } },
    }));
  }

  const save = useMutation({
    mutationFn: (next: TestPlan) => projectApi.update(project.id, { testPlan: next }),
    onSuccess: async (_data, next) => {
      setBaseline(JSON.stringify(next));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      toast.success('Test plan saved');
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not save the test plan';
      setError(message);
      toast.error(message);
    },
  });

  const submit = () => {
    const parsed = testPlanSchema.safeParse(built);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const section = PATH_LABELS[String(issue?.path[0] ?? '')];
      const message = `${section ? `${section}: ` : ''}${issue?.message ?? 'Invalid test plan'}`;
      setError(message);
      toast.error(message);
      return;
    }
    save.mutate(parsed.data);
  };

  const disabled = new Set(plan.disabledJourneys);
  const toggleJourney = (id: string, on: boolean) => {
    const next = new Set(disabled);
    if (on) next.delete(id);
    else next.add(id);
    setPlan({ disabledJourneys: Array.from(next) });
  };

  const cards = SANDBOX_TEST_CARDS[plan.payment.provider];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-describedby={error ? 'test-plan-error' : undefined}
    >
      {/* Category */}
      <SettingsSection
        title="App category"
        description="Decides which journey pack runs. Auto-detect works for most apps."
      >
        <fieldset>
          <legend className="sr-only">App category</legend>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {CATEGORY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:border-[#b9bdc4] has-[:checked]:border-cobalt"
              >
                <input
                  type="radio"
                  name="category"
                  value={option.value}
                  checked={plan.category === option.value}
                  onChange={() => setPlan({ category: option.value })}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--cobalt)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </SettingsSection>

      {/* Interaction map */}
      <SettingsSection
        title="Interaction map"
        titleId="imap-title"
        description="Clicks every visible control on each screen and records what it does: navigates, opens a dialog, changes content, or nothing."
        descriptionId="imap-desc"
        action={
          <>
            <Switch
              checked={plan.interactionMap.enabled}
              onCheckedChange={(enabled) => setIn('interactionMap', { enabled })}
              aria-labelledby="imap-title"
              aria-describedby="imap-desc"
            />
            <span className="text-[13px] text-muted-foreground" aria-hidden>
              {plan.interactionMap.enabled ? 'On' : 'Off'}
            </span>
          </>
        }
      >
        <div className={cn('max-w-2xl space-y-5', !plan.interactionMap.enabled && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberInput
              label="Controls per screen"
              hint="5 to 200"
              min={5}
              max={200}
              value={plan.interactionMap.maxControlsPerScreen}
              disabled={!plan.interactionMap.enabled}
              onChange={(maxControlsPerScreen) => setIn('interactionMap', { maxControlsPerScreen })}
            />
            <NumberInput
              label="Max screens"
              hint="1 to 100"
              min={1}
              max={100}
              value={plan.interactionMap.maxScreens}
              disabled={!plan.interactionMap.enabled}
              onChange={(maxScreens) => setIn('interactionMap', { maxScreens })}
            />
            <NumberInput
              label="Time budget (min)"
              hint="1 to 60"
              min={1}
              max={60}
              value={plan.interactionMap.budgetMinutes}
              disabled={!plan.interactionMap.enabled}
              onChange={(budgetMinutes) => setIn('interactionMap', { budgetMinutes })}
            />
          </div>
          <TextAreaField
            label="Never click these labels"
            hint="One label per line, up to 50. For example Log out or Delete account."
            value={draft.excludeText}
            disabled={!plan.interactionMap.enabled}
            placeholder={'Log out\nDelete account'}
            onChange={(excludeText) => setDraft((current) => ({ ...current, excludeText }))}
          />
        </div>
      </SettingsSection>

      {/* Journeys */}
      <SettingsSection
        title="Journeys"
        description="Business flows from each pack. Only the pack for your app category runs; switch off any that do not apply. Each journey also needs the mode shown on its badge."
      >
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {(Object.keys(PACK_JOURNEYS) as ResolvedCategory[]).map((category) => {
            const active = plan.category === 'auto' || plan.category === category;
            return (
              <section
                key={category}
                aria-labelledby={`pack-${category}`}
                className={cn('bg-card', !active && 'text-muted-foreground')}
              >
                <h3
                  id={`pack-${category}`}
                  className="flex h-9 items-center gap-2 border-b border-border bg-well px-4 text-[13px] font-medium text-ink"
                >
                  {CATEGORY_LABEL[category]}
                  {plan.category === category ? <Badge variant="info">Selected</Badge> : null}
                  {!active ? (
                    <span className="font-normal text-muted-foreground">Not running</span>
                  ) : null}
                </h3>
                <ul className="divide-y divide-border">
                  {PACK_JOURNEYS[category].map((journey) => {
                    const labelId = `journey-${journey.id}`;
                    return (
                      <li key={journey.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                          <div
                            id={labelId}
                            className={cn(
                              'text-sm',
                              active ? 'text-ink' : 'text-muted-foreground',
                              disabled.has(journey.id) &&
                                'text-muted-foreground line-through decoration-muted-foreground/50',
                            )}
                          >
                            {journey.name}
                          </div>
                          <RequirementBadge requires={journey.requires} />
                        </div>
                        <Switch
                          checked={!disabled.has(journey.id)}
                          onCheckedChange={(on) => toggleJourney(journey.id, on)}
                          aria-labelledby={labelId}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </SettingsSection>

      {/* Orders and payments */}
      <SettingsSection
        title="Orders and payments"
        description="How far transactional journeys may go. Both are off unless you switch them on."
      >
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <div id="tx-title" className="text-sm font-medium text-ink">
                    Place orders and bookings
                  </div>
                  <p id="tx-hint" className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Only runs on a Staging environment in Full mode. Production never places orders.
                  </p>
                </div>
                <Switch
                  checked={plan.transactions.enabled}
                  onCheckedChange={(enabled) => setIn('transactions', { enabled })}
                  aria-labelledby="tx-title"
                  aria-describedby="tx-hint"
                />
              </div>
              <div
                className={cn(
                  'grid gap-4 sm:grid-cols-2',
                  !plan.transactions.enabled && 'opacity-60',
                )}
              >
                <NumberInput
                  label="Max per run"
                  hint="1 to 10"
                  min={1}
                  max={10}
                  value={plan.transactions.maxPerRun}
                  disabled={!plan.transactions.enabled}
                  onChange={(maxPerRun) => setIn('transactions', { maxPerRun })}
                />
                <SelectField
                  label="Stop"
                  value={plan.transactions.stopBefore}
                  disabled={!plan.transactions.enabled}
                  onChange={(value) =>
                    setIn('transactions', {
                      stopBefore: value as TestPlan['transactions']['stopBefore'],
                    })
                  }
                  options={STOP_OPTIONS}
                />
              </div>
            </div>

            <div className="space-y-4">
              <SelectField
                label="Payment"
                hint="Sandbox payments also need orders switched on and a Staging environment."
                value={plan.payment.mode}
                onChange={(value) => {
                  const mode = value as TestPlan['payment']['mode'];
                  setIn('payment', {
                    mode,
                    cardNumber:
                      mode === 'sandbox' &&
                      !cards.some((card) => card.number === plan.payment.cardNumber)
                        ? (cards[0]?.number ?? '')
                        : plan.payment.cardNumber,
                  });
                }}
                options={[
                  { value: 'never', label: 'Never pay' },
                  { value: 'sandbox', label: 'Sandbox test card' },
                ]}
              />
              {plan.payment.mode === 'sandbox' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Provider"
                    value={plan.payment.provider}
                    onChange={(value) => {
                      const provider = value as PaymentProvider;
                      const list = SANDBOX_TEST_CARDS[provider];
                      setIn('payment', {
                        provider,
                        cardNumber: list.some((card) => card.number === plan.payment.cardNumber)
                          ? plan.payment.cardNumber
                          : (list[0]?.number ?? ''),
                      });
                    }}
                    options={PROVIDERS.map((provider) => ({
                      value: provider,
                      label: PROVIDER_LABELS[provider],
                    }))}
                  />
                  <SelectField
                    label="Test card"
                    value={plan.payment.cardNumber}
                    onChange={(cardNumber) => setIn('payment', { cardNumber })}
                    options={[
                      ...(cards.some((card) => card.number === plan.payment.cardNumber)
                        ? []
                        : [{ value: plan.payment.cardNumber, label: 'Choose a test card' }]),
                      ...cards.map((card) => ({
                        value: card.number,
                        label: `${card.number.replace(/(\d{4})(?=\d)/g, '$1 ')}, ${card.label}`,
                      })),
                    ]}
                    mono
                  />
                  <TextField
                    label="Expiry"
                    value={plan.payment.expiry}
                    maxLength={7}
                    placeholder="12/34"
                    inputMode="numeric"
                    onChange={(expiry) => setIn('payment', { expiry })}
                  />
                  <TextField
                    label="CVC"
                    value={plan.payment.cvc}
                    maxLength={4}
                    placeholder="123"
                    inputMode="numeric"
                    onChange={(cvc) => setIn('payment', { cvc })}
                  />
                  <TextField
                    className="sm:col-span-2"
                    label="Name on card"
                    value={plan.payment.nameOnCard}
                    maxLength={80}
                    onChange={(nameOnCard) => setIn('payment', { nameOnCard })}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div
            role="note"
            className="flex items-start gap-3 rounded-md border border-border bg-well px-4 py-3 text-sm text-ink"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="font-medium">Live payments are blocked automatically</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                If the page loads live payment keys (for example{' '}
                <span className="mono">pk_live_</span> or <span className="mono">rzp_live_</span>),
                the browser refuses every payment request and the journey stops. Only the published
                sandbox cards above can be saved; real card numbers are rejected.
              </p>
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Test data */}
      <SettingsSection
        title="Test data"
        description="Values the auditor types into forms. Use fake data only."
      >
        <div className="max-w-2xl space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="First name"
              value={plan.testData.firstName}
              maxLength={60}
              onChange={(firstName) => setIn('testData', { firstName })}
            />
            <TextField
              label="Last name"
              value={plan.testData.lastName}
              maxLength={60}
              onChange={(lastName) => setIn('testData', { lastName })}
            />
            <TextField
              className="sm:col-span-2"
              label="Email"
              type="email"
              value={plan.testData.email}
              maxLength={160}
              placeholder="testcrew+run@example.com"
              hint="Leave empty to use testcrew+<run>@example.com, unique per run."
              onChange={(email) => setIn('testData', { email })}
            />
            <TextField
              label="Phone"
              value={plan.testData.phone}
              maxLength={40}
              inputMode="tel"
              onChange={(phone) => setIn('testData', { phone })}
            />
            <TextField
              label="Company"
              value={plan.testData.company}
              maxLength={120}
              onChange={(company) => setIn('testData', { company })}
            />
            <TextField
              className="sm:col-span-2"
              label="Address line 1"
              value={plan.testData.address1}
              maxLength={160}
              onChange={(address1) => setIn('testData', { address1 })}
            />
            <TextField
              className="sm:col-span-2"
              label="Address line 2"
              value={plan.testData.address2}
              maxLength={160}
              onChange={(address2) => setIn('testData', { address2 })}
            />
            <TextField
              label="City"
              value={plan.testData.city}
              maxLength={80}
              onChange={(city) => setIn('testData', { city })}
            />
            <TextField
              label="State / region"
              value={plan.testData.state}
              maxLength={80}
              onChange={(state) => setIn('testData', { state })}
            />
            <TextField
              label="Postal code"
              value={plan.testData.postalCode}
              maxLength={20}
              onChange={(postalCode) => setIn('testData', { postalCode })}
            />
            <TextField
              label="Country"
              value={plan.testData.country}
              maxLength={80}
              onChange={(country) => setIn('testData', { country })}
            />
            <TextField
              className="sm:col-span-2"
              label="Coupon code"
              value={plan.testData.coupon}
              maxLength={60}
              hint="Optional. Tried at checkout when a coupon field exists."
              onChange={(coupon) => setIn('testData', { coupon })}
            />
          </div>
          <TextAreaField
            label="Search terms"
            hint="One per line, up to 10. Used by search journeys."
            value={draft.searchText}
            placeholder={'running shoes\nwireless headphones'}
            onChange={(searchText) => setDraft((current) => ({ ...current, searchText }))}
          />
          <TextAreaField
            label="Custom field values"
            hint="One per line as field = value, matched by field name or label."
            value={draft.customText}
            placeholder="gst number = 29ABCDE1234F1Z5"
            onChange={(customText) => setDraft((current) => ({ ...current, customText }))}
          />
        </div>
      </SettingsSection>

      <ControlHintsCard
        hints={plan.controlHints}
        onChange={(controlHints) => setPlan({ controlHints })}
      />
      <CustomJourneysCard
        journeys={plan.customJourneys}
        onChange={(customJourneys) => setPlan({ customJourneys })}
      />

      {/* Save bar */}
      <div className="sticky bottom-3 z-10 mt-2">
        <div
          className={cn(
            'flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-[var(--shadow-float)] sm:flex-row sm:items-center sm:justify-between',
            error ? 'border-[#f2c4bf]' : 'border-border',
          )}
        >
          <div className="min-w-0 text-sm" aria-live="polite">
            {error ? (
              <p id="test-plan-error" role="alert" className="flex items-start gap-2 text-danger">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="break-words">{error}</span>
              </p>
            ) : dirty ? (
              <p className="flex items-center gap-2 font-medium text-ink">
                <span aria-hidden className="size-[7px] rounded-full bg-warning" />
                Unsaved changes
              </p>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                <span aria-hidden className="size-[7px] rounded-full bg-success" />
                All changes saved
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraft(toDraft(JSON.parse(baseline) as TestPlan));
                  setError(null);
                }}
                disabled={save.isPending}
              >
                <RotateCcw />
                Discard
              </Button>
            ) : null}
            <Button type="submit" disabled={save.isPending || !dirty}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {save.isPending ? 'Saving…' : 'Save test plan'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------ control hints ------------------------------ */

function ControlHintsCard({
  hints,
  onChange,
}: {
  hints: ControlHint[];
  onChange: (hints: ControlHint[]) => void;
}) {
  const set = (index: number, patch: Partial<ControlHint>) =>
    onChange(hints.map((hint, i) => (i === index ? { ...hint, ...patch } : hint)));
  return (
    <SettingsSection
      title="Control hints"
      description="Tell journeys the exact label your app uses, for example Add to cart is labelled Add to bag."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={hints.length >= 50}
          onClick={() =>
            onChange([
              ...hints,
              {
                role: ROLES.find((role) => !hints.some((h) => h.role === role)) ?? 'search',
                label: '',
              },
            ])
          }
        >
          <Plus />
          Add hint
        </Button>
      }
    >
      {hints.length ? (
        <ul className="max-w-2xl space-y-2">
          {hints.map((hint, index) => (
            <li key={index} className="flex items-center gap-2">
              <label htmlFor={`hint-role-${index}`} className="sr-only">
                Hint {index + 1} role
              </label>
              <NativeSelect
                id={`hint-role-${index}`}
                wrapperClassName="w-36 shrink-0 sm:w-44"
                value={hint.role}
                onChange={(event) => set(index, { role: event.target.value as ControlRole })}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </NativeSelect>
              <label htmlFor={`hint-label-${index}`} className="sr-only">
                Hint {index + 1} label in your app
              </label>
              <Input
                id={`hint-label-${index}`}
                className="min-w-0 flex-1"
                value={hint.label}
                maxLength={120}
                placeholder="Exact label in your app"
                onChange={(event) => set(index, { label: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:bg-well hover:text-danger"
                aria-label={`Remove hint ${index + 1}`}
                onClick={() => onChange(hints.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyRow>No hints. Journeys find controls by common labels.</EmptyRow>
      )}
    </SettingsSection>
  );
}

/* ------------------------------ fields ------------------------------ */

function NumberInput({
  label,
  hint,
  min,
  max,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="mono tabular"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        aria-invalid={!Number.isInteger(value) || value < min || value > max ? true : undefined}
        onChange={(event) =>
          onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
        }
      />
      <FieldHint id={`${id}-hint`}>{hint}</FieldHint>
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  className,
  ...rest
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
} & Pick<React.ComponentProps<'input'>, 'type' | 'maxLength' | 'placeholder' | 'inputMode'>) {
  const id = useId();
  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        autoComplete="off"
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
    </div>
  );
}

function TextAreaField({
  label,
  hint,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        className="mono min-h-20 text-xs"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldHint id={`${id}-hint`}>{hint}</FieldHint>
    </div>
  );
}

function SelectField({
  label,
  hint,
  value,
  options,
  disabled,
  mono,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        className={mono ? 'mono text-xs' : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value || 'empty'} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
    </div>
  );
}
