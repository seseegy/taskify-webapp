import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from './NotFoundPage';
import { RouteError } from './RouteError';

/**
 * Rute berbahasa Indonesia. Semua rute di balik login (lihat App.tsx).
 *
 * - `handle.title` → judul tab/dokumen (lihat useRouteA11y).
 * - Beranda dimuat langsung; halaman lain dipecah per rute (`lazy`) supaya bundel awal kecil
 *   (mis. JSZip & syntax highlighter milik Vault tidak ikut terunduh di awal). Semua chunk tetap
 *   di-precache service worker, jadi tetap bisa dibuka offline.
 * - Error halaman ditangkap `RouteError` di dalam kerangka; error kerangka → layar penuh.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError fatal />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage />, handle: { title: 'Beranda' } },
          {
            path: 'kalender',
            handle: { title: 'Kalender' },
            lazy: () =>
              import('@/features/calendar/CalendarPage').then((m) => ({
                Component: m.CalendarPage,
              })),
          },
          {
            path: 'tugas',
            handle: { title: 'Tugas' },
            lazy: () =>
              import('@/features/tasks/TasksPage').then((m) => ({ Component: m.TasksPage })),
          },
          {
            path: 'jurnal',
            handle: { title: 'Jurnal' },
            lazy: () =>
              import('@/features/journal/JournalPage').then((m) => ({ Component: m.JournalPage })),
          },
          {
            path: 'catatan',
            handle: { title: 'Catatan' },
            lazy: () =>
              import('@/features/notes/NotesPage').then((m) => ({ Component: m.NotesPage })),
          },
          {
            path: 'keuangan',
            handle: { title: 'Keuangan' },
            lazy: () =>
              import('@/features/finance/FinancePage').then((m) => ({ Component: m.FinancePage })),
          },
          {
            path: 'vault',
            handle: { title: 'Vault Kode' },
            lazy: () =>
              import('@/features/vault/VaultPage').then((m) => ({ Component: m.VaultPage })),
          },
          {
            path: 'sandi',
            handle: { title: 'Sandi' },
            lazy: () =>
              import('@/features/sandi/SandiPage').then((m) => ({ Component: m.SandiPage })),
          },
          {
            path: 'pengaturan',
            handle: { title: 'Pengaturan' },
            lazy: () =>
              import('@/features/settings/SettingsPage').then((m) => ({
                Component: m.SettingsPage,
              })),
          },
          {
            path: 'review',
            handle: { title: 'Review' },
            lazy: () =>
              import('@/features/review/ReviewPage').then((m) => ({ Component: m.ReviewPage })),
          },
          {
            path: 'bagikan',
            handle: { title: 'Bagikan ke Taskify' },
            lazy: () =>
              import('@/features/share/SharePage').then((m) => ({ Component: m.SharePage })),
          },
          {
            path: 'tag/:id',
            handle: { title: 'Tag' },
            lazy: () => import('@/features/tags/TagPage').then((m) => ({ Component: m.TagPage })),
          },
          {
            path: 'sampah',
            handle: { title: 'Sampah' },
            lazy: () =>
              import('@/features/trash/TrashPage').then((m) => ({ Component: m.TrashPage })),
          },
          { path: '*', element: <NotFoundPage />, handle: { title: 'Halaman tidak ditemukan' } },
        ],
      },
    ],
  },
]);
