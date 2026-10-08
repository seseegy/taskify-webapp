import { CodeXml, KeyRound, Search, Settings, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigation, useSearchParams } from 'react-router';
import { NAV_ITEMS } from '@/app/navigation';
import { useRouteA11y } from '@/app/useRouteA11y';
import { Toaster } from '@/components/ui/Toaster';
import { useAttachmentOutbox } from '@/features/attachments/attachment-actions';
import { TransactionSheet } from '@/features/finance/components/TransactionSheet';
import { useRecurringProcessor } from '@/features/finance/finance-actions';
import { CommandPalette } from '@/features/search/CommandPalette';
import { useSandiAutoLock } from '@/features/sandi/useSandiAutoLock';
import { usePalette } from '@/features/search/palette-store';
import { TaskDetailSheet } from '@/features/tasks/components/TaskDetailSheet';
import { useTrashPurge } from '@/features/trash/trash-actions';
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
  useRecurringProcessor();
  useAttachmentOutbox();
  useSandiAutoLock();
  useTrashPurge();
  const mainRef = useRef<HTMLElement>(null);
  useRouteA11y(mainRef);
  const navigating = useNavigation().state === 'loading';
  return (
    <div className="min-h-dvh lg:flex">
      {/* Tautan lompat: muncul saat difokuskan (Tab pertama) */}
      <a
        href="#konten"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-xl focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:glass-strong"
      >
        Lewati ke konten utama
      </a>
      {/* Indikator muat saat chunk halaman diunduh (pindah rute) */}
      <div role="status" className="sr-only">
        {navigating ? 'Memuat halaman…' : ''}
      </div>
      {navigating && (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-[65] h-0.5 animate-pulse bg-gradient-brand"
        />
      )}
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main
          id="konten"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-12"
        >
          <Outlet />
        </main>
      </div>

      <BottomNav />
      <UpdatePrompt />
      <TaskDetailSheet />
      <TransactionSheet />
      <CommandPalette />
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
        <Logo withText className="mb-6 px-2 pt-2" />
        <SearchButton />
        {/*
          Daftar menu HARUS bisa digulir: sidebar setinggi h-dvh, dan 9 menu + logo + pencarian +
          footer butuh ~765px. Di laptop 1366x768 (viewport ~650px) menu terakhir (Sandi,
          Pengaturan) terpotong dan tidak bisa diklik sama sekali.
          `min-h-0` wajib: tanpa itu anak flex tidak mau menyusut di bawah tinggi isinya, jadi
          `overflow-y-auto` tidak berpengaruh. Pola yang sama dipakai di ui/Sheet.tsx.
        */}
        <nav
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain"
          aria-label="Navigasi utama"
        >
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
        {/*
          Lebar header ini sudah penuh. Hitungan: ikon logo 36 + pencarian 36 + status sync 36
          + N tombol modul 36 + gap 6, dikurangi px-4 halaman dan px-3 kartu (56px).
          Karena itu dua ambang di bawah, bukan angka asal:
            - ikon Review muncul dari 360px (di 320px tidak muat, lebih 18px)
            - teks logo muncul dari 430px (dengan 4 tombol, teks butuh viewport >= 416px)
          Di bawah 360px, Review tetap terjangkau lewat tombol pencarian (command palette).
        */}
        <Logo size="sm" withText textClassName="hidden min-[430px]:inline" />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Cari & catat cepat"
            onClick={() => usePalette.getState().show()}
            className="flex size-9 items-center justify-center rounded-full text-muted glass hover:text-fg"
          >
            <Search className="size-4" />
          </button>
          <SyncStatus compact />
          <HeaderLink
            to="/review"
            label="Review"
            icon={Trophy}
            className="hidden min-[360px]:flex"
          />
          <HeaderLink to="/vault" label="Vault Kode" icon={CodeXml} />
          <HeaderLink to="/sandi" label="Sandi" icon={KeyRound} />
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
  className,
}: {
  to: string;
  label: string;
  icon: typeof Settings;
  className?: string;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex size-9 items-center justify-center rounded-full transition',
          isActive ? 'bg-gradient-brand text-white' : 'text-muted glass hover:text-fg',
          className,
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

function SearchButton() {
  const show = usePalette((s) => s.show);
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={() => show()}
      className="mb-5 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm text-muted glass transition hover:text-fg"
    >
      <Search className="size-4" />
      <span className="flex-1">Cari & catat cepat</span>
      <kbd className="rounded-md border border-line px-1.5 text-[10px] font-bold">
        {mac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}
