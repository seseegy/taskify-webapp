import { Sparkles, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/Button';

/**
 * Notifikasi "versi baru tersedia" (registerType: 'prompt').
 * Versi baru tidak diaktifkan diam-diam agar tidak memotong pekerjaan yang sedang diketik.
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Cek pembaruan tiap jam selama aplikasi terbuka
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!offlineReady && !needRefresh) return null;

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md animate-fade-up items-center gap-3 rounded-2xl p-4 glass-strong lg:bottom-6"
    >
      <div className="shine flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white">
        <Sparkles className="size-5" />
      </div>
      <p className="flex-1 text-sm font-medium">
        {needRefresh ? 'Versi baru Taskify tersedia.' : 'Taskify siap dipakai offline.'}
      </p>
      {needRefresh && (
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          Perbarui
        </Button>
      )}
      <Button size="icon" variant="ghost" onClick={close} aria-label="Tutup">
        <X />
      </Button>
    </div>
  );
}
