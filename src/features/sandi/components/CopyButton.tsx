import { Check, Copy, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast-store';
import { cn } from '@/lib/utils';
import { CLIPBOARD_CLEAR_MS, copySecret } from '../clipboard';

async function copyPlain(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tombol salin ikon. `secret` = sandi: dihapus otomatis dari papan klip setelah 30 detik.
 * Username/URL disalin biasa (tidak menimpa papan klip pengguna nanti).
 */
export function CopyButton({
  value,
  label,
  what,
  secret,
  icon: Icon = Copy,
  showLabel,
  onCopied,
  className,
}: {
  value: string;
  /** Nama aksesibel, mis. "Salin sandi GitHub" */
  label: string;
  /** Untuk pesan toast, mis. "Sandi" */
  what: string;
  secret?: boolean;
  /** Ikon saat diam. Beri ikon berbeda bila ada beberapa tombol salin berdampingan. */
  icon?: LucideIcon;
  /** Tampilkan teks "Salin" di samping ikon (untuk aksi utama, bukan baris daftar) */
  showLabel?: boolean;
  /** Dipanggil HANYA setelah penyalinan berhasil (mis. mencatat pemakaian kode TOTP). */
  onCopied?: () => void;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!value) return;
    const ok = secret ? await copySecret(value) : await copyPlain(value);
    if (!ok) return toast('Tidak bisa menyalin. Izinkan akses papan klip.', { tone: 'danger' });
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1500);
    toast(
      secret
        ? `${what} disalin. Dihapus dari papan klip dalam ${CLIPBOARD_CLEAR_MS / 1000} detik.`
        : `${what} disalin`,
      { tone: 'success' },
    );
    onCopied?.();
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={!value}
      aria-label={label}
      title={label}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-fg disabled:opacity-40',
        showLabel ? 'h-11 gap-2 px-4 text-sm font-semibold' : 'size-11',
        done && 'text-success',
        className,
      )}
    >
      {done ? (
        <Check className="size-[18px]" aria-hidden="true" />
      ) : (
        <Icon className="size-[18px]" aria-hidden="true" />
      )}
      {showLabel && (done ? 'Tersalin' : 'Salin')}
    </button>
  );
}
