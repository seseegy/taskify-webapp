import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { FinancePage } from '@/features/finance/FinancePage';
import { JournalPage } from '@/features/journal/JournalPage';
import { ReviewPage } from '@/features/review/ReviewPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SharePage } from '@/features/share/SharePage';
import { TagPage } from '@/features/tags/TagPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { TrashPage } from '@/features/trash/TrashPage';
import { VaultPage } from '@/features/vault/VaultPage';
import { NotFoundPage } from './NotFoundPage';

/** Rute berbahasa Indonesia. Semua rute di balik login (lihat App.tsx). */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'kalender', element: <CalendarPage /> },
      { path: 'tugas', element: <TasksPage /> },
      { path: 'jurnal', element: <JournalPage /> },
      { path: 'keuangan', element: <FinancePage /> },
      { path: 'vault', element: <VaultPage /> },
      { path: 'pengaturan', element: <SettingsPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'bagikan', element: <SharePage /> },
      { path: 'tag/:id', element: <TagPage /> },
      { path: 'sampah', element: <TrashPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
