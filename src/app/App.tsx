import { RouterProvider } from 'react-router/dom';
import { AppErrorBoundary } from '@/components/layout/AppErrorBoundary';
import { SetupRequired } from '@/components/layout/SetupRequired';
import { SplashScreen } from '@/components/layout/SplashScreen';
import { PowerSyncProvider } from '@/db/PowerSyncProvider';
import { useAuth } from '@/features/auth/auth-context';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { LockGate } from '@/features/lock/LockGate';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { isEnvReady } from '@/lib/env';
import { router } from './router';

/**
 * Urutan gerbang:
 *   Tema → (env lengkap?) → Auth → (login?) → DB lokal + sync → Kunci PIN → Router
 */
export function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        {isEnvReady ? (
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        ) : (
          <SetupRequired />
        )}
      </ThemeProvider>
    </AppErrorBoundary>
  );
}

function AuthGate() {
  const { state } = useAuth();

  if (state.status === 'loading') return <SplashScreen message="Memuat sesi…" />;
  if (state.status === 'signed_out') return <LoginPage />;

  return (
    <PowerSyncProvider>
      <LockGate>
        <RouterProvider router={router} />
      </LockGate>
    </PowerSyncProvider>
  );
}
