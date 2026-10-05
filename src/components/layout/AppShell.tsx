import { CodeXml, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router';
import { NAV_ITEMS } from '@/app/navigation';
import { Toaster } from '@/components/ui/Toaster';
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet';
import { useTaskSheet } from '@/features/tasks/task-sheet-store';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { SyncStatus } from './SyncStatus';
import { UpdatePrompt } from './UpdatePrompt';

/**
 * Kerangka aplikasi:
 *  - ≥ lg (laptop): sidebar kaca di kiri
 *  - < lg (HP): header atas + bottom nav dengan Kalender di tengah
 */
export function AppShell() {
  useTaskDeepLink();
  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <BottomNav />
      <UpdatePrompt />
      <TaskDetailSheet />
      <Toaster />
    </div>
  );
}

/** `?task=<id>` (mis. dari klik notifikasi pengingat) → buka panel detail tugas. */
function useTaskDeepLink() {
  const [params, setParams] = useSearchParams();
  const open = useTaskSheet((s) => s.open);
  const taskId = params.get('task');

  useEffect(() => {
    if (!taskId) return;
    open(taskId);
    setParams(
      (p) => {
        p.delete('task');
        return p;
      },
      { replace: true },
    );
  }, [taskId, open, setParams]);
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col p-4 lg:flex">
      <div className="flex h-full flex-col rounded-3xl p-4 glass">
        <Logo withText className="mb-8 px-2 pt-2" />
        <nav className="flex flex-1 flex-col gap-1" aria-label="Navigasi utama">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition',
                  isActive ? 'text-fg glass-strong' : 'text-muted hover:bg-surface hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex size-9 items-center justify-center rounded-xl transition',
                      isActive
                        ? cn('shine text-white shadow-md', item.gradient)
                        : 'bg-surface group-hover:scale-105',
                    )}
                  >
                    <item.icon className="size-[18px]" />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 px-1 pt-4">
          <SyncStatus />
          <span className="text-xs text-muted">v{__APP_VERSION__}</span>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 lg:hidden">
      <div className="flex items-center justify-between rounded-2xl px-3 py-2 glass">
        <Logo size="sm" withText />
        <div className="flex items-center gap-1.5">
          <SyncStatus compact />
          <HeaderLink to="/vault" label="Vault Kode" icon={CodeXml} />
          <HeaderLink to="/pengaturan" label="Pengaturan" icon={Settings} />
        </div>
      </div>
    </header>
  );
}

function HeaderLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Settings;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex size-9 items-center justify-center rounded-full transition',
          isActive ? 'bg-gradient-brand text-white' : 'text-muted glass hover:text-fg',
        )
      }
    >
      <Icon className="size-4" />
    </NavLink>
  );
}

function BottomNav() {
  const items = NAV_ITEMS.filter((i) => i.mobile);
  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-end justify-around rounded-3xl px-2 py-2 glass-strong">
        {items.map((item) => {
          const center = item.to === '/kalender';
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 text-[11px] font-semibold transition',
                  isActive ? 'text-fg' : 'text-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex items-center justify-center transition',
                      center
                        ? cn(
                            'shine -mt-7 size-14 rounded-2xl text-white shadow-xl shadow-indigo-500/40',
                            item.gradient,
                            isActive && 'ring-4 ring-primary/25',
                          )
                        : cn(
                            'size-9 rounded-xl',
                            isActive && cn('shine text-white shadow-md', item.gradient),
                          ),
                    )}
                  >
                    <item.icon className={center ? 'size-6' : 'size-[18px]'} />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
