import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SplashScreen } from './SplashScreen';

interface State {
  failed: boolean;
}

/**
 * Jaring pengaman terluar: error render di provider (tema, auth, DB, kunci PIN) tidak lagi
 * menghasilkan layar putih. Error di dalam halaman ditangani `RouteError` (router.tsx).
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] error tak tertangani', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert">
        <SplashScreen
          title="Terjadi kesalahan"
          message="Aplikasi mengalami masalah tak terduga. Data yang sudah tersimpan di perangkat aman."
          action={{ label: 'Muat ulang', onClick: () => window.location.reload() }}
        />
      </div>
    );
  }
}
