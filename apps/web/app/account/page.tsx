'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CircleCheck, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { DIALOG_CLASS } from '@/components/pages/create-project-dialog';
import { SettingsSection } from '@/components/pages/settings-ui';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/queries';

export default function AccountPage() {
  const { user } = useSession();
  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-ink">Account</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Your sign-in details. Workspace settings live with each project.</p>
      </header>
      {user ? (
        <>
          <Profile name={user.name} email={user.email} verified={user.emailVerified !== false} />
          <ChangePassword />
          <DeleteAccount email={user.email} />
        </>
      ) : (
        <div className="shimmer h-48 rounded-lg" aria-label="Loading your account" />
      )}
    </AppShell>
  );
}

function Profile({ name, email, verified }: { name: string; email: string; verified: boolean }) {
  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => toast.success(`Sent a confirmation link to ${email}`),
    onError: () => toast.error('Could not send the link. Try again in a minute.'),
  });
  return (
    <SettingsSection title="Profile" description="The name and email on your account.">
      <dl className="grid gap-4 xl:grid-cols-2">
        <div>
          <dt className="text-[13px] text-muted-foreground">Name</dt>
          <dd className="mt-0.5 text-sm font-medium text-ink">{name}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">Email</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-medium text-ink [overflow-wrap:anywhere]">
            {email}
            {verified ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-normal text-success">
                <CircleCheck className="size-3.5" aria-hidden /> Confirmed
              </span>
            ) : (
              <button
                type="button"
                className="text-[12px] font-normal text-muted-foreground underline underline-offset-4 hover:text-ink"
                disabled={resend.isPending || resend.isSuccess}
                onClick={() => resend.mutate()}
              >
                {resend.isSuccess ? 'Link sent' : 'Not confirmed: send the link again'}
              </button>
            )}
          </dd>
        </div>
      </dl>
    </SettingsSection>
  );
}

function ChangePassword() {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => authApi.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('Password changed. Other browsers were signed out.');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not change the password'),
  });
  return (
    <SettingsSection title="Password" description="Changing it signs you out everywhere else.">
      <form
        className="grid max-w-[420px] gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (next.length < 10) return setError('Use at least 10 characters for the new password.');
          change.mutate();
        }}
      >
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
          <Link href="/forgot-password" className="text-[12px] text-muted-foreground underline-offset-4 hover:text-ink hover:underline">
            Forgot it?
          </Link>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
          />
          <p className="text-[12px] text-muted-foreground">At least 10 characters.</p>
        </div>
        <div>
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? <Loader2 className="animate-spin" /> : null}
            Change password
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => authApi.deleteAccount({ password, confirmEmail }),
    onSuccess: () => {
      queryClient.clear();
      try {
        window.localStorage.clear();
      } catch {
        /* nothing stored */
      }
      router.replace('/?deleted=1');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not delete the account'),
  });
  const matches = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  return (
    <SettingsSection title="Delete account" description="This cannot be undone.">
      <div className="flex flex-col gap-4 rounded-lg border border-[#f2c4bf] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Deletes your sign-in and every workspace where you are the only member, with its sites, audits, findings and
          screenshots. Workspaces you share stay with the other members.
        </p>
        <Button variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete account
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setConfirmEmail('');
            setPassword('');
            setError(null);
          }
        }}
      >
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your workspaces where nobody else is a member are deleted with everything in them. Shared workspaces stay, and
              another member becomes their owner. Scheduled audits in deleted workspaces stop.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              if (matches && password) remove.mutate();
            }}
          >
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-email">
                Type <span className="mono rounded-[4px] bg-well px-1.5 py-0.5 text-xs">{email}</span> to confirm
              </Label>
              <Input
                id="confirm-email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delete-password">Password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={!matches || !password || remove.isPending}>
                {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {remove.isPending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
