import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { useTxSheet } from '@/features/finance/tx-sheet-store';
import { useMusicPanel } from '@/features/music/music-store';
import { usePalette } from '@/features/search/palette-store';
import { useTaskSheet } from '@/features/tasks/task-sheet-store';
import { useTikTokSheet } from '@/features/tiktok/tiktok-sheet-store';
import { env } from '@/lib/env';

/**
 * Panel global yang dimuat LAZY: palet perintah, detail tugas, form transaksi, pemutar musik,
 * dan pengunduh TikTok.
 *
 * Keempatnya dulu ikut bundel awal (±90 KB JS minified) padahal baru dibutuhkan setelah dibuka.
 * Sekarang masing-masing dipasang saat store-nya pertama kali meminta dibuka, lalu TETAP
 * terpasang (animasi tutup, keadaan pemutar musik, dan fokus tidak hilang). Kodenya diambil di
 * waktu senggang setelah aplikasi tampil (`prefetchPanels`), jadi pembukaan pertama tetap cepat
 * dan tetap bisa offline (semua chunk ada di precache service worker).
 */

const load = {
  palette: () =>
    import('@/features/search/CommandPalette').then((m) => ({ default: m.CommandPalette })),
  task: () =>
    import('@/features/tasks/components/TaskDetailSheet').then((m) => ({
      default: m.TaskDetailSheet,
    })),
  tx: () =>
    import('@/features/finance/components/TransactionSheet').then((m) => ({
      default: m.TransactionSheet,
    })),
  music: () => import('@/features/music/MusicBar').then((m) => ({ default: m.MusicBar })),
  tiktok: () => import('@/features/tiktok/TikTokSheet').then((m) => ({ default: m.TikTokSheet })),
};

const CommandPalette = lazy(load.palette);
const TaskDetailSheet = lazy(load.task);
const TransactionSheet = lazy(load.tx);
const MusicBar = lazy(load.music);
const TikTokSheet = lazy(load.tiktok);

/** Sama dengan `isMusicConfigured` di api-client, tanpa memuat modul pemutar. */
const musicEnabled = Boolean(env.musicApiUrl);
/** Sama dengan `isTikTokConfigured` di tiktok/api-client. */
const tiktokEnabled = Boolean(env.tiktokApiUrl);

/** true sejak `wanted` pertama kali true (lalu tidak pernah kembali false). */
function useOnceTrue(wanted: boolean) {
  const [on, setOn] = useState(wanted);
  if (wanted && !on) setOn(true);
  return on || wanted;
}

function Mount({ when, component: C }: { when: boolean; component: ComponentType }) {
  const mounted = useOnceTrue(when);
  return mounted ? (
    <Suspense fallback={null}>
      <C />
    </Suspense>
  ) : null;
}

export function LazyPanels() {
  const palette = usePalette((s) => s.open);
  const task = useTaskSheet((s) => s.taskId !== null);
  const tx = useTxSheet((s) => s.open);
  const music = useMusicPanel((s) => s.panel !== 'none');
  const tiktok = useTikTokSheet((s) => s.open);

  useEffect(() => prefetchPanels(), []);

  return (
    <>
      {musicEnabled && <Mount when={music} component={MusicBar} />}
      <Mount when={task} component={TaskDetailSheet} />
      <Mount when={tx} component={TransactionSheet} />
      <Mount when={palette} component={CommandPalette} />
      {tiktokEnabled && <Mount when={tiktok} component={TikTokSheet} />}
    </>
  );
}

/** Ambil kode panel saat browser senggang, setelah tampilan pertama selesai. */
function prefetchPanels() {
  const run = () => {
    void load.palette();
    void load.task();
    void load.tx();
    if (musicEnabled) void load.music();
  };
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 5000 });
    return () => cancelIdleCallback(id);
  }
  const t = setTimeout(run, 2000);
  return () => clearTimeout(t);
}
