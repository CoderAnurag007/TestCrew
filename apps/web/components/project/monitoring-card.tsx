'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import { DEVICES, type AlertSettings, type Device, type FindingSeverity, type MonitorCadence } from '@auditor/shared';
import { FieldHint, SettingsSection, Switch } from '@/components/pages/settings-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { launchApi, type MonitoringSettings, type ProjectDetail } from '@/lib/queries';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SEVERITIES: { value: FindingSeverity; label: string }[] = [
  { value: 'CRITICAL', label: 'Critical only' },
  { value: 'HIGH', label: 'High and above' },
  { value: 'MEDIUM', label: 'Medium and above' },
  { value: 'LOW', label: 'Low and above' },
  { value: 'INFO', label: 'Everything' },
];

/** "06:00 UTC" shown in the viewer's own time, e.g. "11:30 am". */
function localTime(hourUtc: number): string {
  const date = new Date();
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function nextRunText(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function MonitoringCard({ project }: { project: ProjectDetail }) {
  const settings = useQuery({
    queryKey: ['monitoring', project.id],
    queryFn: () => launchApi.monitoring(project.id),
  });
  if (settings.isLoading) return <div className="shimmer mt-2 h-64 rounded-md" aria-label="Loading monitoring" />;
  if (settings.isError || !settings.data) {
    return (
      <p className="py-8 text-sm text-danger" role="alert">
        Could not load monitoring settings.
      </p>
    );
  }
  return <MonitoringForm key={String(settings.data.nextRunAt)} project={project} initial={settings.data} />;
}

function MonitoringForm({ project, initial }: { project: ProjectDetail; initial: MonitoringSettings }) {
  const queryClient = useQueryClient();
  const [cadence, setCadence] = useState<MonitorCadence | null>(initial.cadence);
  const [hourUtc, setHourUtc] = useState(initial.hourUtc);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [environmentId, setEnvironmentId] = useState<string | null>(initial.environmentId);
  const [devices, setDevices] = useState<Device[]>(initial.devices.length ? initial.devices : ['desktop']);
  const [alerts, setAlerts] = useState<AlertSettings>({
    emails: initial.alerts.emails ?? [],
    minSeverity: initial.alerts.minSeverity ?? 'MEDIUM',
    onFailure: initial.alerts.onFailure ?? true,
    scheduledOnly: initial.alerts.scheduledOnly ?? false,
  });
  const [email, setEmail] = useState('');

  const save = useMutation({
    mutationFn: () =>
      launchApi.saveMonitoring(project.id, { cadence, hourUtc, weekday, environmentId, devices, alerts }),
    onSuccess: async (data) => {
      queryClient.setQueryData(['monitoring', project.id], data);
      toast.success(data.cadence ? `Monitoring on. Next audit ${nextRunText(data.nextRunAt)}` : 'Monitoring saved');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save monitoring'),
  });

  const addEmail = () => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error('That doesn’t look like an email address');
      return;
    }
    if (!alerts.emails.includes(value) && alerts.emails.length < 10) {
      setAlerts({ ...alerts, emails: [...alerts.emails, value] });
    }
    setEmail('');
  };

  const toggleDevice = (device: Device) => {
    setDevices((current) =>
      current.includes(device)
        ? current.length > 1
          ? current.filter((item) => item !== device)
          : current
        : [...current, device],
    );
  };

  const runsPerSlot = devices.length;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <SettingsSection
        title="Scheduled audits"
        description="TestCrew audits the site on its own and tells you only when something new breaks."
      >
        <div className="space-y-5">
          <div className="grid gap-2">
            <Label>How often</Label>
            <div className="inline-flex w-fit flex-wrap rounded-md border border-border bg-well p-0.5" role="group" aria-label="How often">
              {([null, 'hourly', 'daily', 'weekly'] as (MonitorCadence | null)[]).map((value) => (
                <button
                  key={value ?? 'off'}
                  type="button"
                  aria-pressed={cadence === value}
                  onClick={() => setCadence(value)}
                  className={cn(
                    'h-8 rounded-[4px] px-3 text-[13px] font-medium transition-colors',
                    cadence === value ? 'bg-card text-ink ring-1 ring-border' : 'text-muted-foreground hover:text-ink',
                  )}
                >
                  {value === null ? 'Off' : value.charAt(0).toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {cadence ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {cadence === 'weekly' ? (
                  <div className="grid gap-2">
                    <Label htmlFor="monitor-weekday">Day</Label>
                    <NativeSelect id="monitor-weekday" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                      {WEEKDAYS.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : null}
                {cadence !== 'hourly' ? (
                  <div className="grid gap-2">
                    <Label htmlFor="monitor-hour">Time (your time zone)</Label>
                    <NativeSelect id="monitor-hour" value={hourUtc} onChange={(event) => setHourUtc(Number(event.target.value))}>
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>
                          {localTime(hour)} ({String(hour).padStart(2, '0')}:00 UTC)
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="monitor-env">Environment</Label>
                  <NativeSelect
                    id="monitor-env"
                    value={environmentId ?? ''}
                    onChange={(event) => setEnvironmentId(event.target.value || null)}
                  >
                    <option value="">Default ({project.environments[0]?.name ?? 'Production'})</option>
                    {project.environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name} · {environment.baseUrl}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              {cadence === 'hourly' ? (
                <FieldHint>
                  Hourly suits a short checkout or sign-up check. A full audit can take 15–25 minutes, so a run is skipped
                  while the previous one is still going.
                </FieldHint>
              ) : null}
              {initial.cadence && initial.nextRunAt ? (
                <p className="text-[13px] text-muted-foreground">Next audit: {nextRunText(initial.nextRunAt)}</p>
              ) : null}
            </>
          ) : (
            <FieldHint>Off: audits only run when you start them or from CI.</FieldHint>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Browsers and screens"
        description="Each one is a separate audit. Most shoppers are on phones, and Safari renders some pages differently."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(DEVICES) as Device[]).map((device) => {
            const on = devices.includes(device);
            return (
              <button
                key={device}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDevice(device)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border px-3.5 py-3 text-left transition-colors',
                  on ? 'border-ink bg-card' : 'border-border bg-well hover:border-[#b9bdc4]',
                )}
              >
                <span>
                  <span className="block text-[14px] font-medium text-ink">{DEVICES[device].label}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {DEVICES[device].mobile ? 'Phone screen, touch' : 'Laptop screen'} ·{' '}
                    {DEVICES[device].engine === 'webkit' ? 'Safari engine' : 'Chrome engine'}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn('size-4 shrink-0 rounded-[4px] border', on ? 'border-ink bg-ink' : 'border-[#b9bdc4] bg-card')}
                />
              </button>
            );
          })}
        </div>
        {runsPerSlot > 1 ? (
          <FieldHint>
            {runsPerSlot} audits each time{cadence ? `, ${cadence}` : ''}.
          </FieldHint>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Alerts"
        description="Sent when a run finds a new bug or one that came back. Bugs you already know about stay quiet."
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="alert-severity">Alert for</Label>
              <NativeSelect
                id="alert-severity"
                value={alerts.minSeverity}
                onChange={(event) => setAlerts({ ...alerts, minSeverity: event.target.value as FindingSeverity })}
              >
                {SEVERITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="alert-email">Email</Label>
            <div className="flex gap-2">
              <Input
                id="alert-email"
                type="email"
                placeholder="dev@yourcompany.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addEmail();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addEmail} disabled={!email.trim()}>
                Add
              </Button>
            </div>
            {alerts.emails.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {alerts.emails.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1 rounded-md border border-border bg-well py-1 pl-2.5 pr-1 text-[13px] text-ink">
                    {item}
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      className="rounded p-0.5 text-muted-foreground hover:text-ink"
                      onClick={() => setAlerts({ ...alerts, emails: alerts.emails.filter((value) => value !== item) })}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <FieldHint>Email needs SMTP_URL in the server settings. Slack and webhooks are set up under Integrations.</FieldHint>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <SwitchRow
              id="alert-failure"
              title="Alert when an audit can’t finish"
              description="The site was down, blocked the browser, or the audit crashed."
              checked={alerts.onFailure}
              onChange={(value) => setAlerts({ ...alerts, onFailure: value })}
            />
            <SwitchRow
              id="alert-scheduled"
              title="Only for scheduled audits"
              description="Stay quiet for audits you start by hand."
              checked={alerts.scheduledOnly}
              onChange={(value) => setAlerts({ ...alerts, scheduledOnly: value })}
            />
          </div>
        </div>
      </SettingsSection>

      <div className="flex justify-end border-t border-border pt-6">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : null}
          Save monitoring
        </Button>
      </div>
    </form>
  );
}

function SwitchRow({
  id,
  title,
  description,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p id={`${id}-title`} className="text-[14px] font-medium text-ink">
          {title}
        </p>
        <p id={`${id}-desc`} className="text-[13px] text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`} />
    </div>
  );
}
