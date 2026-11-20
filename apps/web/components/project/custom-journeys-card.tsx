'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CustomJourney, CustomStep } from '@auditor/shared';
import { EmptyRow, SettingsSection, Switch } from '@/components/pages/settings-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MAX_STEPS = 40;
const MAX_JOURNEYS = 30;

type StepAction = CustomStep['action'];

export const STEP_ACTIONS: Array<{
  value: StepAction;
  label: string;
  target: string;
  value_: string;
}> = [
  { value: 'goto', label: 'Go to', target: 'Path, e.g. /pricing', value_: '' },
  { value: 'click', label: 'Click', target: 'Button or link label', value_: '' },
  { value: 'fill', label: 'Fill', target: 'Field label or placeholder', value_: 'Text to type' },
  { value: 'select', label: 'Select', target: 'Dropdown label', value_: 'Option to pick' },
  {
    value: 'press',
    label: 'Press key',
    target: 'Field label (optional)',
    value_: 'Key, e.g. Enter',
  },
  { value: 'expect_text', label: 'Expect text', target: 'Text that must appear', value_: '' },
  {
    value: 'expect_no_text',
    label: 'Expect text absent',
    target: 'Text that must not appear',
    value_: '',
  },
  {
    value: 'expect_url',
    label: 'Expect URL contains',
    target: 'URL fragment, e.g. /thank-you',
    value_: '',
  },
  {
    value: 'wait',
    label: 'Wait',
    target: 'Text to wait for (optional)',
    value_: 'Milliseconds, e.g. 1000',
  },
];

const ACTION_LABEL = Object.fromEntries(
  STEP_ACTIONS.map((item) => [item.value, item.label]),
) as Record<StepAction, string>;

function newJourney(): CustomJourney {
  return {
    id: crypto.randomUUID().slice(0, 8),
    name: '',
    enabled: true,
    mutates: false,
    transactional: false,
    steps: [{ action: 'goto', target: '/', value: '' }],
  };
}

export function CustomJourneysCard({
  journeys,
  onChange,
}: {
  journeys: CustomJourney[];
  onChange: (journeys: CustomJourney[]) => void;
}) {
  const [editing, setEditing] = useState<CustomJourney | null>(null);
  const [open, setOpen] = useState(false);

  const openEditor = (journey: CustomJourney) => {
    setEditing(structuredClone(journey));
    setOpen(true);
  };

  return (
    <SettingsSection
      title="Custom journeys"
      description={`Your own step-by-step checks, resolved against the live page by visible labels. Up to ${MAX_JOURNEYS}.`}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={journeys.length >= MAX_JOURNEYS}
          onClick={() => openEditor(newJourney())}
        >
          <Plus />
          Add journey
        </Button>
      }
    >
      {journeys.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {journeys.map((journey) => (
            <li
              key={journey.id}
              className="flex flex-col gap-3 bg-card px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    <span className={cn('truncate', !journey.enabled && 'text-muted-foreground')}>
                      {journey.name}
                    </span>
                    {!journey.enabled ? <Badge variant="muted">Off</Badge> : null}
                    {journey.transactional ? (
                      <Badge variant="info">Staging order</Badge>
                    ) : journey.mutates ? (
                      <Badge variant="warning">Full</Badge>
                    ) : (
                      <Badge variant="muted">Read-only</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {journey.steps.length} step{journey.steps.length === 1 ? '' : 's'}:{' '}
                    {journey.steps
                      .slice(0, 3)
                      .map((step) => ACTION_LABEL[step.action])
                      .join(' → ')}
                    {journey.steps.length > 3 ? ' → …' : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditor(journey)}
                  aria-label={`Edit ${journey.name}`}
                >
                  <Pencil />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:bg-well hover:text-danger"
                  aria-label={`Delete ${journey.name}`}
                  onClick={() => onChange(journeys.filter((item) => item.id !== journey.id))}
                >
                  <Trash2 />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyRow>
          No custom journeys. Add one to check a flow the built-in packs do not cover.
        </EmptyRow>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-2xl">
          {editing ? (
            <JourneyEditor
              journey={editing}
              onChange={setEditing}
              onSave={() => {
                const cleaned: CustomJourney = {
                  ...editing,
                  name: editing.name.trim(),
                  steps: editing.steps.map((step) => ({
                    ...step,
                    target: step.target.trim(),
                    value: step.value.trim(),
                  })),
                };
                const exists = journeys.some((item) => item.id === cleaned.id);
                onChange(
                  exists
                    ? journeys.map((item) => (item.id === cleaned.id ? cleaned : item))
                    : [...journeys, cleaned],
                );
                setOpen(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function JourneyEditor({
  journey,
  onChange,
  onSave,
}: {
  journey: CustomJourney;
  onChange: (journey: CustomJourney) => void;
  onSave: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CustomJourney>) => onChange({ ...journey, ...patch });
  const setStep = (index: number, patch: Partial<CustomStep>) =>
    set({ steps: journey.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  const move = (index: number, delta: number) => {
    const target = index + delta;
    const a = journey.steps[index];
    const b = journey.steps[target];
    if (!a || !b) return;
    const next = [...journey.steps];
    next[index] = b;
    next[target] = a;
    set({ steps: next });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!journey.name.trim()) {
          setError('Give the journey a name.');
          return;
        }
        if (!journey.steps.length) {
          setError('Add at least one step.');
          return;
        }
        const missing = journey.steps.findIndex(
          (step) => step.action !== 'wait' && step.action !== 'press' && !step.target.trim(),
        );
        if (missing >= 0) {
          setError(`Step ${missing + 1} needs a target.`);
          return;
        }
        setError(null);
        onSave();
      }}
    >
      <DialogHeader>
        <DialogTitle>{journey.name.trim() ? journey.name : 'Custom journey'}</DialogTitle>
        <DialogDescription>
          Steps run in order. Targets are visible labels, placeholders or paths.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="journey-name">Name</Label>
          <Input
            id="journey-name"
            value={journey.name}
            maxLength={120}
            placeholder="Apply a coupon at checkout"
            onChange={(event) => set({ name: event.target.value })}
            required
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <SwitchField
            id="journey-enabled"
            title="Enabled"
            hint="Runs on every audit."
            checked={journey.enabled}
            onChange={(enabled) => set({ enabled })}
          />
          <SwitchField
            id="journey-mutates"
            title="Changes data"
            hint="Only runs in Full mode."
            checked={journey.mutates || journey.transactional}
            disabled={journey.transactional}
            onChange={(mutates) => set({ mutates })}
          />
          <SwitchField
            id="journey-transactional"
            title="Places an order"
            hint="Only on Staging in Full mode."
            checked={journey.transactional}
            onChange={(transactional) =>
              set({ transactional, mutates: transactional ? true : journey.mutates })
            }
          />
        </div>

        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium text-ink">
            Steps
            <span className="tabular text-xs font-normal text-muted-foreground">
              {journey.steps.length} / {MAX_STEPS}
            </span>
          </legend>
          <ol className="space-y-2">
            {journey.steps.map((step, index) => {
              const meta = STEP_ACTIONS.find((item) => item.value === step.action) ?? {
                target: 'Target',
                value_: '',
              };
              const base = `step-${index}`;
              return (
                <li key={index} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-muted-foreground">
                      Step {index + 1}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move step ${index + 1} up`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => move(index, 1)}
                        disabled={index === journey.steps.length - 1}
                        aria-label={`Move step ${index + 1} down`}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:bg-well hover:text-danger"
                        onClick={() => set({ steps: journey.steps.filter((_, i) => i !== index) })}
                        disabled={journey.steps.length <= 1}
                        aria-label={`Remove step ${index + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <label htmlFor={`${base}-action`} className="sr-only">
                        Step {index + 1} action
                      </label>
                      <NativeSelect
                        id={`${base}-action`}
                        value={step.action}
                        onChange={(event) =>
                          setStep(index, { action: event.target.value as StepAction })
                        }
                      >
                        {STEP_ACTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div>
                      <label htmlFor={`${base}-target`} className="sr-only">
                        Step {index + 1} target
                      </label>
                      <Input
                        id={`${base}-target`}
                        value={step.target}
                        maxLength={300}
                        placeholder={meta.target}
                        onChange={(event) => setStep(index, { target: event.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${base}-value`} className="sr-only">
                        Step {index + 1} value
                      </label>
                      <Input
                        id={`${base}-value`}
                        value={step.value}
                        maxLength={300}
                        placeholder={meta.value_ || 'Value (not used)'}
                        disabled={!meta.value_}
                        onChange={(event) => setStep(index, { value: event.target.value })}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={journey.steps.length >= MAX_STEPS}
            onClick={() =>
              set({ steps: [...journey.steps, { action: 'click', target: '', value: '' }] })
            }
          >
            <Plus />
            Add step
          </Button>
        </fieldset>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-[#f2c4bf] bg-[#fdf1ef] px-3 py-2.5 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit">Done</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes apply to the plan when you save the test plan.
        </p>
      </div>
    </form>
  );
}

function SwitchField({
  id,
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <div id={`${id}-label`} className="text-sm font-medium text-ink">
          {title}
        </div>
        <div id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}
