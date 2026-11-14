import {
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Link2,
  RefreshCcw,
  Share2,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { askConfirm } from '@/components/ui/confirm-store';
import { Input, Label } from '@/components/ui/Input';
import { Listbox } from '@/components/ui/Listbox';
import { Sheet } from '@/components/ui/Sheet';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast-store';
import type { TempFile } from '@/db/schema';
import { formatBytes } from '@/lib/bytes';
import { parseTimestamp } from '@/lib/date';
import { FileGlyph } from './FileGlyph';
import { ownerDownloadUrl } from './tempfile-api';
import { changeFile, removeFile } from './tempfile-store';
import {
  EXPIRY_CHOICES,
  expiryLabel,
  fileState,
  isShareable,
  shareUrl,
  type ExpiryOption,
} from './tempfile-utils';

const fmtDateTime = (ts: string) =>
  parseTimestamp(ts).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Detail satu berkas: tautan, publik/privat, masa berlaku, ganti nama, unduh, hapus. */
export function TempFileSheet({
  file,
  now,
  online,
  onClose,
}: {
  file: TempFile | null;
  now: number;
  online: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={file !== null} onClose={onClose} title="Detail berkas">
      {file && <Body key={file.id} file={file} now={now} online={online} onClose={onClose} />}
    </Sheet>
  );
}

function Body({
  file,
  now,
  online,
  onClose,
}: {
  file: TempFile;
  now: number;
  online: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState(file.file_name);
  const [expiry, setExpiry] = useState<ExpiryOption>('7d');
  const [copied, setCopied] = useState(false);
  const state = fileState(file, now);
  const shareable = isShareable(file, now);
  const url = shareUrl(location.origin, file.share_token);
  const editable = state !== 'expired' && online && busy === null;

  /** Jalankan satu aksi server; galat ditampilkan, tombol dikunci selama berjalan. */
  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast(success, { tone: 'success' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal. Coba lagi.', { tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Tidak bisa menyalin otomatis. Pilih tautannya lalu salin manual.', { tone: 'danger' });
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === file.file_name) return;
    void run('rename', () => changeFile(file.id, { name: next }), 'Nama diganti');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileGlyph mime={file.mime_type} name={file.file_name} />
        <div className="min-w-0">
          <p className="text-sm font-semibold break-words">{file.file_name}</p>
          <p className="text-xs text-muted">
            {formatBytes(file.size_bytes)} · diunggah {fmtDateTime(file.created_at)}
          </p>
        </div>
      </div>

      {state === 'expired' && (
        <p role="status" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
          Berkas ini sudah kedaluwarsa. Tautannya tidak bekerja lagi dan berkasnya dihapus otomatis
          dalam beberapa saat.
        </p>
      )}
      {state === 'pending' && (
        <p role="status" className="rounded-xl bg-warning/12 p-3 text-sm text-warning">
          Unggahan belum selesai. Bila tidak sedang diunggah, hapus lalu unggah ulang. Pesanan yang
          ditinggalkan dibersihkan otomatis.
        </p>
      )}

      {state === 'ready' && (
        <section aria-labelledby="tf-link" className="space-y-2">
          <h3 id="tf-link" className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" aria-hidden="true" /> Tautan publik
          </h3>
          <Switch
            checked={file.is_public === 1}
            disabled={!editable}
            onChange={(v) =>
              void run(
                'public',
                () => changeFile(file.id, { isPublic: v }),
                v ? 'Tautan diaktifkan' : 'Tautan dinonaktifkan',
              )
            }
            label={
              <span className="flex items-center gap-1.5">
                {file.is_public === 1 ? (
                  <Eye className="size-4" aria-hidden="true" />
                ) : (
                  <EyeOff className="size-4" aria-hidden="true" />
                )}
                {file.is_public === 1 ? 'Siapa pun yang punya tautan bisa mengunduh' : 'Privat'}
              </span>
            }
            hint={
              file.is_public === 1
                ? 'Matikan untuk menghentikan tautan sementara tanpa menghapus berkas.'
                : 'Tautan tidak bekerja sampai diaktifkan lagi.'
            }
          />
          {shareable && (
            <>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={url}
                  aria-label="Tautan publik"
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 font-mono text-xs"
                />
                <Button variant="secondary" onClick={() => void copy()} aria-label="Salin tautan">
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </Button>
                {'share' in navigator && (
                  <Button
                    variant="secondary"
                    aria-label="Bagikan tautan"
                    onClick={() =>
                      void navigator.share({ title: file.file_name, url }).catch(() => undefined)
                    }
                  >
                    <Share2 aria-hidden="true" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">
                {file.download_count}× diunduh
                {file.last_download_at && ` · terakhir ${fmtDateTime(file.last_download_at)}`}
              </p>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-11 sm:h-9"
            disabled={!editable}
            loading={busy === 'token'}
            onClick={async () => {
              const ok = await askConfirm({
                title: 'Buat tautan baru?',
                description:
                  'Tautan lama langsung berhenti bekerja. Siapa pun yang sudah menerimanya tidak bisa mengunduh lagi.',
                confirmLabel: 'Buat tautan baru',
              });
              if (ok)
                void run(
                  'token',
                  () => changeFile(file.id, { regenerate: true }),
                  'Tautan baru dibuat; tautan lama dicabut',
                );
            }}
          >
            <RefreshCcw aria-hidden="true" /> Buat tautan baru (cabut yang lama)
          </Button>
        </section>
      )}

      {state !== 'expired' && (
        <section aria-labelledby="tf-expiry-h" className="space-y-2">
          <h3 id="tf-expiry-h" className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4" aria-hidden="true" /> Masa berlaku
          </h3>
          <p className="text-sm text-muted">{expiryLabel(file.expires_at, now)}</p>
          <div className="flex gap-2">
            <Listbox
              aria-label="Masa berlaku baru, dihitung dari sekarang"
              value={expiry}
              onChange={(v) => setExpiry(v as ExpiryOption)}
              options={EXPIRY_CHOICES.map((c) => ({
                value: c.value,
                label: c.value === 'never' ? c.label : `${c.label} dari sekarang`,
              }))}
              disabled={!editable}
              className="min-w-0 flex-1"
            />
            <Button
              variant="secondary"
              disabled={!editable}
              loading={busy === 'expiry'}
              onClick={() =>
                void run('expiry', () => changeFile(file.id, { expiry }), 'Masa berlaku diperbarui')
              }
            >
              Terapkan
            </Button>
          </div>
        </section>
      )}

      {state !== 'expired' && (
        <form onSubmit={rename} className="space-y-2">
          <Label htmlFor="tf-name">Nama berkas</Label>
          <div className="flex gap-2">
            <Input
              id="tf-name"
              value={name}
              maxLength={255}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!editable || !name.trim() || name.trim() === file.file_name}
              loading={busy === 'rename'}
            >
              Simpan
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {state === 'ready' && (
          <Button
            variant="secondary"
            disabled={!online || busy !== null}
            loading={busy === 'download'}
            onClick={() =>
              void run('download', async () => {
                // Presigned GET dengan Content-Disposition: attachment → unduh, tidak pindah halaman
                window.location.assign(await ownerDownloadUrl(file.id));
              })
            }
          >
            <Download aria-hidden="true" /> Unduh
          </Button>
        )}
        <Button
          variant="danger"
          disabled={!online || busy !== null}
          loading={busy === 'delete'}
          onClick={async () => {
            const ok = await askConfirm({
              title: `Hapus ${file.file_name}?`,
              description:
                'Tautan publik langsung berhenti bekerja dan berkas dihapus dari penyimpanan. Tidak bisa diurungkan.',
              confirmLabel: 'Hapus',
            });
            if (!ok) return;
            setBusy('delete');
            try {
              await removeFile(file.id);
              toast('Berkas dihapus', { tone: 'success' });
              onClose();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Gagal menghapus.', { tone: 'danger' });
              setBusy(null);
            }
          }}
        >
          <Trash2 aria-hidden="true" /> Hapus
        </Button>
      </div>
      {!online && (
        <p className="text-xs text-muted">Sedang offline: perubahan butuh koneksi internet.</p>
      )}
    </div>
  );
}
