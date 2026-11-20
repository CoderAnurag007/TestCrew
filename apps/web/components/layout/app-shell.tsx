'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Check,
  ChevronsUpDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useSession } from '@/components/session-provider';
import { PlanLimitDialog, TrialNotice } from '@/components/layout/plan-notices';
import { Brand, BrandMark } from '@/components/shell/brand';
import {
  NEW_PROJECT_EVENT,
  NEW_PROJECT_FLAG,
  NEW_WORKSPACE_EVENT,
  NEW_WORKSPACE_FLAG,
} from '@/components/shell/events';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { projectApi } from '@/lib/queries';
import { cn } from '@/lib/utils';

const NAV: Array<{ href: string; label: string; icon: LucideIcon; match: string[] }> = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, match: ['/dashboard'] },
  { href: '/projects', label: 'Projects', icon: FolderKanban, match: ['/projects', '/runs'] },
];

/** Opens a dialog on the target page, navigating there first when needed. */
function useOpenOn() {
  const router = useRouter();
  const pathname = usePathname();
  return (path: string, event: string, flag: string) => {
    if (pathname === path) {
      window.dispatchEvent(new Event(event));
    } else {
      router.push(`${path}?${flag}=1`);
    }
  };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const openOn = useOpenOn();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-well lg:flex">
        <SidebarContent />
      </aside>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="left-0 top-0 flex h-dvh w-[min(18rem,85vw)] max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-l-0 bg-well p-0">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">Pages, workspace and account</DialogDescription>
          <SidebarContent onNavigate={() => setMenuOpen(false)} />
        </DialogContent>
      </Dialog>

      <div className="relative flex min-h-screen min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-background">
          <div className="mx-auto flex h-12 w-full max-w-[1248px] items-center gap-3 px-4 sm:px-6 lg:px-10">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 size-9 lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <Link href="/dashboard" className="rounded-lg lg:hidden" aria-label="Snaghunt overview">
              <BrandMark className="size-6" />
            </Link>
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => openOn('/projects', NEW_PROJECT_EVENT, NEW_PROJECT_FLAG)}
              >
                <Plus />
                <span className="hidden sm:inline">New audit</span>
                <span className="sr-only sm:hidden">New audit</span>
              </Button>
            </div>
          </div>
        </header>
        <main className="relative flex-1">
          <div className="mx-auto w-full max-w-[1248px] px-4 pb-20 pt-8 sm:px-6 lg:px-10">
            {children}
          </div>
        </main>
      </div>
      <PlanLimitDialog />
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, currentOrg, organizations, setCurrentOrgId, logout } = useSession();
  const openOn = useOpenOn();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center px-4">
        <Brand href="/dashboard" />
      </div>

      <nav aria-label="Main" className="mt-3 flex flex-col gap-0.5 px-2">
        {NAV.map((item) => {
          const active = item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-[#3d4148] outline-none transition-colors hover:bg-[#e9ebed] hover:text-ink',
                active && 'bg-card font-medium text-ink shadow-[0_0_0_1px_var(--rule)] hover:bg-card',
              )}
            >
              <item.icon className={cn('size-4', active ? 'text-ink' : 'text-muted-foreground')} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-1 border-t border-border p-2">
        <TrialNotice />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[#e9ebed]"
              aria-label="Switch workspace"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[12px] font-semibold text-ink">
                {(currentOrg?.name ?? '?').slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {currentOrg?.name ?? 'No workspace'}
                </span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {currentOrg ? 'Workspace' : 'Create one to start'}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 p-1">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                className="gap-2 rounded-md"
                onSelect={() => {
                  setCurrentOrgId(org.id);
                  onNavigate?.();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {org.id === currentOrg?.id ? <Check className="size-4 text-ink" /> : null}
              </DropdownMenuItem>
            ))}
            {organizations.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className="gap-2 rounded-md"
              onSelect={() => {
                onNavigate?.();
                openOn('/dashboard', NEW_WORKSPACE_EVENT, NEW_WORKSPACE_FLAG);
              }}
            >
              <Plus className="size-4" />
              New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[#e9ebed]"
              aria-label="Account menu"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                {initials(user?.name ?? user?.email ?? '')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{user?.name ?? 'Account'}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{user?.email ?? ''}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 p-1">
            <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 rounded-md" onSelect={() => void logout()}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function initials(value: string): string {
  const parts = value.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

type Crumb = { label: string; href?: string };

function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const projectId = segments[0] === 'projects' ? segments[1] : undefined;

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.get(projectId!),
    enabled: Boolean(projectId),
  });

  const crumbs: Crumb[] = [];
  if (segments[0] === 'dashboard') {
    crumbs.push({ label: 'Overview' });
  } else if (segments[0] === 'projects') {
    crumbs.push({ label: 'Projects', href: projectId ? '/projects' : undefined });
    if (projectId) {
      const sub = segments[2];
      crumbs.push({
        label: project.data?.name ?? 'Project',
        href: sub ? `/projects/${projectId}` : undefined,
      });
      if (sub === 'runs') crumbs.push({ label: 'Runs' });
      if (sub === 'settings') crumbs.push({ label: 'Settings' });
    }
  } else if (segments[0] === 'runs') {
    crumbs.push({ label: 'Projects', href: '/projects' });
    if (segments[1]) crumbs.push({ label: `Run ${segments[1].slice(-8)}` });
  }

  if (!crumbs.length) {
    return <div className="min-w-0 flex-1" />;
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li
              key={`${crumb.label}-${index}`}
              className={cn('flex min-w-0 items-center gap-1', !last && 'hidden sm:flex')}
            >
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="truncate rounded-md px-1 py-1 text-muted-foreground outline-none transition-colors hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn('truncate px-1 py-1', last ? 'font-medium text-ink' : 'text-muted-foreground')}
                  aria-current={last ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
              {!last ? <span className="shrink-0 text-[#b3b7be]" aria-hidden>/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
