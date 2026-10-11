import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Disclosure } from '@/components/ui/Disclosure';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/features/sandi/components/CopyButton';
import { cn } from '@/lib/utils';
import type { ConfigEntry, ConfigFormat } from './config-parse';

/** Nilai tampil kembali tersembunyi setelah ini, seperti sandi di ItemSheet. */
const REVEAL_MS = 15_000;

/** Jumlah titik TETAP: panjang nilai tidak boleh terbaca dari penyamarannya. */
const MASK = '••••••••••••';

/**
 * Daftar kunci-nilai sebuah versi konfigurasi.
 *
 * Nilai disembunyikan secara bawaan dan tersembunyi lagi otomatis: isi `.env` hampir selalu
 * rahasia, dan layar yang ditinggalkan tidak boleh terus menampilkannya. Penyalinan memakai
 * `copySecret` (papan klip dihapus otomatis), dan TIDAK ada unduhan — supaya tidak ada salinan
 * tanpa enkripsi yang tertinggal di disk.
 */
export function ConfigValues({
  entries,
  text,
  format,
  name,
}: {
  entries: ConfigEntry[];
  /** Teks mentah: satu-satunya bentuk yang memuat komentar & urutan asli. */
  text: string;
  format: ConfigFormat;
  /** Nama berkas, untuk label aksesibel. */
  name: string;
}) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [allShown, setAllShown] = useState(false);

  // Satu timer untuk seluruh daftar: apa pun yang terbuka, tertutup lagi bersama-sama
  useEffect(() => {
    if (!allShown && shown.size === 0) return;
    const t = setTimeout(() => {
      setShown(new Set());
      setAllShown(false);
    }, REVEAL_MS);
    return () => clearTimeout(t);
  }, [allShown, shown]);

  const toggle = (key: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const isOpen = (key: string) => allShown || shown.has(key);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={allShown}
          onClick={() => {
            setAllShown((v) => !v);
            setShown(new Set());
          }}
        >
          {allShown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {allShown ? 'Sembunyikan nilai' : 'Tampilkan nilai'}
        </Button>
        <CopyButton
          value={text}
          label={`Salin seluruh isi ${name}`}
          what="Isi konfigurasi"
          secret
          showLabel
          className="glass"
        />
      </div>

      {entries.length === 0 ? (
        <p className="rounded-2xl p-3.5 text-sm text-muted glass">
          Tidak ada kunci yang bisa dibaca di versi ini.
          {format === 'env'
            ? ' Berkas mungkin hanya berisi komentar.'
            : ' Lihat teks mentah di bawah.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.key}
              className="flex min-h-14 items-center gap-2 rounded-2xl px-3 py-2 glass"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs font-bold break-all text-muted">
                  {e.key}
                </span>
                <span
                  className={cn(
                    'block text-sm',
                    isOpen(e.key) ? 'font-mono break-all select-all' : 'tracking-widest',
                  )}
                >
                  {isOpen(e.key) ? (
                    e.value === '' ? (
                      <span className="text-muted italic">kosong</span>
                    ) : (
                      e.value
                    )
                  ) : (
                    <span aria-label="Nilai disembunyikan">{MASK}</span>
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggle(e.key)}
                aria-pressed={isOpen(e.key)}
                aria-label={
                  isOpen(e.key) ? `Sembunyikan nilai ${e.key}` : `Tampilkan nilai ${e.key}`
                }
                className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-fg"
              >
                {isOpen(e.key) ? (
                  <EyeOff className="size-[18px]" aria-hidden="true" />
                ) : (
                  <Eye className="size-[18px]" aria-hidden="true" />
                )}
              </button>
              <CopyButton value={e.value} label={`Salin nilai ${e.key}`} what={e.key} secret />
            </li>
          ))}
        </ul>
      )}

      {/* Teks mentah memuat komentar dan urutan asli — tetapi juga seluruh nilainya, jadi
          dibuka oleh gerbang yang sama dengan nilai di atas. */}
      <Disclosure summary="Teks mentah (termasuk komentar)">
        {allShown ? (
          <div className="mt-2 overflow-x-auto rounded-xl glass">
            <CodeBlock code={text} language={format === 'json' ? 'json' : 'bash'} />
          </div>
        ) : (
          <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning/12 p-3 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            Teks mentah memuat semua nilai. Tekan &ldquo;Tampilkan nilai&rdquo; dulu untuk
            melihatnya.
          </p>
        )}
      </Disclosure>
    </div>
  );
}
