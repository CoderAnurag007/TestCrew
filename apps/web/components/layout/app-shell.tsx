'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban, LogOut, Moon, Sun, Radar } from 'lucide-react';
import { useTheme } from '@/components/theme';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/components/session-provider';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Command', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, currentOrg, organizations, setCurrentOrgId, logout } = useSession();
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[240px_1fr]">
        <aside className="hidden border-r bg-card/60 lg:flex lg:flex-col">
          <div className="flex items-center gap-2 px-5 py-5">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Radar className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">AI App Auditor</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Control plane
              </div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
                    active && 'bg-accent text-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="truncate">{currentOrg?.name ?? 'No workspace'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                {organizations.map((org) => (
                  <DropdownMenuItem key={org.id} onClick={() => setCurrentOrgId(org.id)}>
                    {org.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="flex h-14 items-center justify-between border-b px-4 lg:px-8">
            <div className="mono text-xs text-muted-foreground">
              {user?.email}
              {currentOrg ? ` · ${currentOrg.slug}` : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle theme"
              >
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    {user?.name ?? 'Account'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void logout()}>
                    <LogOut className="mr-2 size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
