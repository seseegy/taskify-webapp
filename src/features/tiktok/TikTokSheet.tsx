import { ClipboardPaste, Link2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { findTikTokLink } from './tiktok-link';
import { useTikTokSheet } from './tiktok-sheet-store';
import { TikTokCard } from './TikTokCard';

/**
 * Panel "Unduh dari TikTok" — jalur kedua selain /bagikan, untuk desktop atau bila link disalin
 * (bukan dibagikan). Isi panel di-mount ulang setiap kali dibuka (`key`), jadi tidak ada sisa
 * dari pembukaan sebelumnya.
 */
export function TikTokSheet() {
  const open = useTikTokSheet((s) => s.open);
  const initial = useTikTokSheet((s) => s.input);
  const hide = useTikTokSheet((s) => s.hide);
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }

  return (
    <Sheet open={open} onClose={hide} title="Unduh dari TikTok">
      <SheetBody key={session} initial={initial} />
    </Sheet>
  );
}

function SheetBody({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [submitted, setSubmitted] = useState<string | null>(
    findTikTokLink(initial) ? initial : null,
  );
  const [error, setError] = useState('');
  const canPaste = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

  const submit = (value: string) => {
    if (!findTikTokLink(value)) {
      setError('Itu bukan link video atau foto TikTok.');
      return;
    }
    setError('');
    setSubmitted(value.trim());
  };

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setText(value);
      submit(value);
    } catch {
      setError('Izin membaca clipboard ditolak. Tempel manual dengan tekan lama di kolom.');
    }
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <Label htmlFor="tiktok-link">Link TikTok</Label>
        <div className="flex gap-2">
          <Input
            id="tiktok-link"
            data-autofocus
            inputMode="url"
            autoComplete="off"
            placeholder="https://vt.tiktok.com/…"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'tiktok-link-error' : 'tiktok-link-hint'}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
          />
          <Button type="submit" aria-label="Ambil" size="icon" className="size-11">
            <Link2 />
          </Button>
        </div>
        {error ? (
          <p id="tiktok-link-error" role="alert" className="mt-1.5 text-xs text-danger">
            {error}
          </p>
        ) : (
          <p id="tiktok-link-hint" className="mt-1.5 text-xs text-muted">
            Di HP lebih cepat: buka video di TikTok → Bagikan → Taskify.
          </p>
        )}
        {canPaste && !submitted && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void paste()}>
            <ClipboardPaste /> Tempel dari clipboard
          </Button>
        )}
      </form>
      {submitted && <TikTokCard input={submitted} />}
    </div>
  );
}
