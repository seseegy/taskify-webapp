import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { FinancePage } from '@/features/finance/FinancePage';
import { JournalPage } from '@/features/journal/JournalPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TasksPage } from '@/features/tasks/TasksPage';
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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
