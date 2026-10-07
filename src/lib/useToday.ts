import { useSyncExternalStore } from 'react';
import { msUntilNextDay, todayLocal, type LocalDate } from './date';

/**
 * Tanggal "hari ini" (WIB) yang ikut berganti saat tengah malam, walau aplikasi dibiarkan terbuka.
 *
 * Memanggil `todayLocal()` langsung di dalam komponen hanya menghitung sekali per render, jadi
 * layar yang tidak ter-render ulang tetap menampilkan "hari ini" kemarin. Hook ini membuat
 * komponen yang memakainya render ulang tepat saat hari berganti.
 *
 * Satu timer bersama untuk semua pemakai. Timer browser ditunda saat tab di latar belakang atau
 * perangkat tidur, jadi tanggal juga diperiksa ulang saat tab kembali terlihat/difokuskan.
 */
let current = todayLocal();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function refresh() {
  const next = todayLocal();
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    refresh();
    schedule();
  }, msUntilNextDay());
}

const onVisible = () => {
  if (document.visibilityState === 'visible') refresh();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    refresh();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    }
  };
}

// Dihitung ulang tiap dibaca supaya render pertama setelah lama tanpa pemakai tidak basi.
// Nilainya string, jadi aman dibandingkan oleh React.
function getSnapshot(): LocalDate {
  const next = todayLocal();
  if (next !== current) current = next;
  return current;
}

export function useToday(): LocalDate {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
