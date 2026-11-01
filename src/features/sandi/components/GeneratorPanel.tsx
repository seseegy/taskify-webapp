import { Check, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Listbox } from '@/components/ui/Listbox';
import { Input, Label } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { toast } from '@/components/ui/toast-store';
import { cn } from '@/lib/utils';
import { CLIPBOARD_CLEAR_MS, copySecret } from '../clipboard';
import {
  DIGITS,
  LENGTH_MAX,
  LENGTH_MIN,
  SEPARATORS,
  SYMBOLS,
  WORDS_MAX,
  WORDS_MIN,
  clampLength,
  clampWords,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  strengthFromBits,
} from '../generator';
import { readPrefs, writePrefs, type GeneratorMode, type GeneratorPrefs } from '../generator-prefs';
import { StrengthMeter } from './StrengthMeter';
import { Switch } from '@/components/ui/Switch';

const SEPARATOR_LABEL: Record<(typeof SEPARATORS)[number], string> = {
  '-': 'Tanda hubung ( - )',
  ' ': 'Spasi',
  '.': 'Titik ( . )',
  _: 'Garis bawah ( _ )',
  '': 'Tanpa pemisah',
};

const WORDLIST_SIZE = 7776;

function make(prefs: GeneratorPrefs, words: readonly string[] | null): string {
  if (prefs.mode === 'password') return generatePassword(prefs.password);
  return words ? generatePassphrase(prefs.passphrase, words) : '';
}

/** Mewarnai karakter menurut jenisnya agar mudah dibaca/diketik ulang (huruf tetap warna teks). */
function Colored({ value }: { value: string }) {
  return (
    <>
      {[...value].map((ch, i) => (
        <span
          key={i}
          className={cn(
            DIGITS.includes(ch) && 'text-primary',
            SYMBOLS.includes(ch) && 'text-warning',
          )}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

/**
 * Generator sandi. Tidak butuh brankas terbuka. Yang diingat per perangkat hanya PENGATURAN,
 * tidak pernah sandi yang dihasilkan.
 *
 * `onUse`: dipanggil dari form item ("Pakai sandi ini"); tanpa `onUse` tombol itu tidak tampil.
 */
export function GeneratorPanel({
  onUse,
  compact,
}: {
  onUse?: (value: string) => void;
  compact?: boolean;
}) {
  const [state, setState] = useState(() => {
    const prefs = readPrefs();
    return { prefs, value: make(prefs, null) };
  });
  const [words, setWords] = useState<readonly string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { prefs, value } = state;
  const pw = prefs.password;
  const ph = prefs.passphrase;

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // Daftar kata (±60 KB) hanya dimuat saat mode frasa sandi dipakai
  useEffect(() => {
    if (prefs.mode !== 'passphrase' || words) return;
    let alive = true;
    void import('../eff-wordlist').then((m) => {
      if (!alive) return;
      setWords(m.EFF_WORDLIST);
      setState((s) => ({ ...s, value: make(s.prefs, m.EFF_WORDLIST) }));
    });
    return () => {
      alive = false;
    };
  }, [prefs.mode, words]);

  const change = (next: GeneratorPrefs) => {
    writePrefs(next);
    setState({ prefs: next, value: make(next, words) });
  };
  const regenerate = () => setState((s) => ({ ...s, value: make(s.prefs, words) }));

  const bits =
    prefs.mode === 'password' ? passwordEntropy(pw) : passphraseEntropy(ph, WORDLIST_SIZE);
  const strength = strengthFromBits(bits);
  const onlyOneClass = [pw.lower, pw.upper, pw.digits, pw.symbols].filter(Boolean).length === 1;
  const loadingWords = prefs.mode === 'passphrase' && !words;

  const copy = async () => {
    if (!value) return;
    if (!(await copySecret(value)))
      return toast('Tidak bisa menyalin. Izinkan akses papan klip.', { tone: 'danger' });
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    toast(`Sandi disalin. Dihapus dari papan klip dalam ${CLIPBOARD_CLEAR_MS / 1000} detik.`, {
      tone: 'success',
    });
  };

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- hasil */}
      <Card className={cn('space-y-4', compact && 'p-4')}>
        <div
          role="group"
          aria-label="Sandi yang dihasilkan"
          className="min-h-24 rounded-2xl p-4 glass-strong"
        >
          {loadingWords ? (
            <p className="py-4 text-sm text-muted" role="status">
              Memuat daftar kata…
            </p>
          ) : (
            <>
              <p
                aria-hidden="true"
                className={cn(
                  'font-mono leading-relaxed font-semibold select-all',
                  // Karakter acak boleh dipotong di mana saja; frasa hanya di antara kata
                  prefs.mode === 'password' ? 'break-all' : 'break-words',
                  compact ? 'text-lg' : 'text-xl sm:text-2xl',
                )}
              >
                <Colored value={value} />
              </p>
              {/* Teks polos untuk pembaca layar (versi berwarna dipecah per karakter) */}
              <span className="sr-only">{value}</span>
            </>
          )}
        </div>

        <StrengthMeter strength={strength} />

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copy()} disabled={!value} className="flex-1 sm:flex-none">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Tersalin' : 'Salin'}
          </Button>
          <Button
            variant="secondary"
            onClick={regenerate}
            disabled={loadingWords}
            aria-label="Buat sandi baru"
          >
            <RefreshCw aria-hidden="true" /> <span className="hidden sm:inline">Buat ulang</span>
          </Button>
          {onUse && (
            <Button
              variant="secondary"
              onClick={() => onUse(value)}
              disabled={!value}
              className="w-full sm:ml-auto sm:w-auto"
            >
              Pakai sandi ini
            </Button>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------------- opsi */}
      <Card className={cn('space-y-4', compact && 'p-4')}>
        <SegmentedControl<GeneratorMode>
          label="Jenis sandi"
          value={prefs.mode}
          onChange={(mode) => change({ ...prefs, mode })}
          options={[
            { value: 'password', label: 'Karakter acak' },
            { value: 'passphrase', label: 'Frasa sandi' },
          ]}
        />

        {prefs.mode === 'password' ? (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <Label htmlFor="gen-length" className="mb-0">
                  Panjang
                </Label>
                <Input
                  id="gen-length-num"
                  type="number"
                  inputMode="numeric"
                  aria-label="Panjang sandi (angka)"
                  min={LENGTH_MIN}
                  max={LENGTH_MAX}
                  value={pw.length}
                  onChange={(e) =>
                    change({
                      ...prefs,
                      password: { ...pw, length: clampLength(Number(e.target.value)) },
                    })
                  }
                  className="h-11 w-20 text-center font-mono"
                />
              </div>
              <input
                id="gen-length"
                type="range"
                min={LENGTH_MIN}
                max={LENGTH_MAX}
                value={pw.length}
                aria-valuetext={`${pw.length} karakter`}
                onChange={(e) =>
                  change({ ...prefs, password: { ...pw, length: Number(e.target.value) } })
                }
                className="h-8 w-full"
              />
            </div>

            <div className="-mx-1 grid gap-0.5 sm:grid-cols-2">
              <Switch
                label="Huruf kecil"
                hint="a–z"
                checked={pw.lower}
                disabled={pw.lower && onlyOneClass}
                onChange={(lower) => change({ ...prefs, password: { ...pw, lower } })}
              />
              <Switch
                label="Huruf besar"
                hint="A–Z"
                checked={pw.upper}
                disabled={pw.upper && onlyOneClass}
                onChange={(upper) => change({ ...prefs, password: { ...pw, upper } })}
              />
              <Switch
                label="Angka"
                hint="0–9"
                checked={pw.digits}
                disabled={pw.digits && onlyOneClass}
                onChange={(digits) => change({ ...prefs, password: { ...pw, digits } })}
              />
              <Switch
                label="Simbol"
                hint="! @ # $ % …"
                checked={pw.symbols}
                disabled={pw.symbols && onlyOneClass}
                onChange={(symbols) => change({ ...prefs, password: { ...pw, symbols } })}
              />
              <Switch
                className="sm:col-span-2"
                label="Hindari karakter yang mirip"
                hint="Tanpa I, l, 1, O, 0, o — lebih mudah diketik ulang"
                checked={pw.avoidAmbiguous}
                onChange={(avoidAmbiguous) =>
                  change({ ...prefs, password: { ...pw, avoidAmbiguous } })
                }
              />
            </div>
            {onlyOneClass && (
              <p className="text-xs text-muted">Minimal satu jenis karakter harus aktif.</p>
            )}
          </>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <Label htmlFor="gen-words" className="mb-0">
                  Jumlah kata
                </Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  aria-label="Jumlah kata (angka)"
                  min={WORDS_MIN}
                  max={WORDS_MAX}
                  value={ph.words}
                  onChange={(e) =>
                    change({
                      ...prefs,
                      passphrase: { ...ph, words: clampWords(Number(e.target.value)) },
                    })
                  }
                  className="h-11 w-20 text-center font-mono"
                />
              </div>
              <input
                id="gen-words"
                type="range"
                min={WORDS_MIN}
                max={WORDS_MAX}
                value={ph.words}
                aria-valuetext={`${ph.words} kata`}
                onChange={(e) =>
                  change({ ...prefs, passphrase: { ...ph, words: Number(e.target.value) } })
                }
                className="h-8 w-full"
              />
            </div>

            <div>
              <Label htmlFor="gen-sep">Pemisah</Label>
              <Listbox
                id="gen-sep"
                value={ph.separator}
                onChange={(v) =>
                  change({
                    ...prefs,
                    passphrase: { ...ph, separator: v as typeof ph.separator },
                  })
                }
                options={SEPARATORS.map((s) => ({ value: s, label: SEPARATOR_LABEL[s] }))}
              />
            </div>

            <div className="-mx-1 grid gap-0.5 sm:grid-cols-2">
              <Switch
                label="Awali kata dengan huruf besar"
                checked={ph.capitalize}
                onChange={(capitalize) => change({ ...prefs, passphrase: { ...ph, capitalize } })}
              />
              <Switch
                label="Tambah satu angka"
                hint="Untuk situs yang mewajibkan angka"
                checked={ph.includeNumber}
                onChange={(includeNumber) =>
                  change({ ...prefs, passphrase: { ...ph, includeNumber } })
                }
              />
            </div>
            <p className="text-xs text-muted">
              Kata diambil dari daftar EFF (7.776 kata); tiap kata menambah ±12,9 bit. Frasa lebih
              mudah diingat dan diketik daripada karakter acak.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
