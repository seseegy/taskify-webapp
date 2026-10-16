import { useQuery } from '@powersync/react';
import { useState } from 'react';
import { Disclosure } from '@/components/ui/Disclosure';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast-store';
import { applyOp } from '@/db/connector';
import { useDatabase } from '@/db/database-context';
import { APP_TIMEZONE } from '@/lib/date';
import { explainErrorCode, retryUploadError, type RetryDeps } from './upload-errors';
import { askConfirm } from '@/components/ui/confirm-store';

interface UploadErrorRow {
  id: string;
  op: string;
  table_name: string;
  row_id: string;
  payload: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

const TABLE_LABEL: Record<string, string> = {
  tasks: 'Tugas',
  task_lists: 'Daftar tugas',
  journal_entries: 'Jurnal',
  notes: 'Catatan',
  transactions: 'Transaksi',
  wallets: 'Dompet',
  categories: 'Kategori',
  budgets: 'Anggaran',
  debts: 'Hutang/piutang',
  recurring_transactions: 'Transaksi berulang',
  snippets: 'Snippet',
  code_projects: 'Project',
  attachments: 'Lampiran',
  tags: 'Tag',
  taggings: 'Tag item',
  entity_links: 'Tautan',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: APP_TIMEZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Daftar perubahan yang DITOLAK server secara permanen (tabel lokal `upload_errors`).
 * Sebelumnya hanya jumlahnya yang tampil, sehingga pengguna tidak tahu apa yang gagal dan tidak
 * bisa menyelamatkan isinya. Di sini bisa dilihat, dikirim ulang ("Coba lagi", setelah
 * penyebabnya diperbaiki), disalin (JSON, untuk dimasukkan ulang manual), dan dibersihkan.
 */
export function UploadErrors() {
  const { powerSync } = useDatabase();
  const { data } = useQuery<UploadErrorRow>(
    `SELECT id, op, table_name, row_id, payload, error_code, error_message, created_at
       FROM upload_errors ORDER BY created_at DESC LIMIT 100`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  if (data.length === 0) return null;

  const deps: RetryDeps = {
    apply: applyOp,
    // Nama tabel sudah divalidasi retryUploadError (hanya tabel tersinkron) sebelum ini dipanggil
    localRow: (table, id) =>
      powerSync.getOptional<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]),
  };

  /** Kirim ulang satu atau semua (terlama dulu: urutan aslinya). Berhenti di kegagalan pertama. */
  const retry = async (targets: UploadErrorRow[], key: string) => {
    if (!navigator.onLine) {
      toast('Butuh koneksi internet untuk mengirim ulang.', { tone: 'danger' });
      return;
    }
    setBusy(key);
    let sent = 0;
    try {
      for (const r of [...targets].reverse()) {
        const result = await retryUploadError(r, deps);
        if (!result.ok) {
          toast(`${TABLE_LABEL[r.table_name] ?? r.table_name}: ${result.message}`, {
            tone: 'danger',
            duration: 8000,
          });
          break;
        }
        await powerSync.execute('DELETE FROM upload_errors WHERE id = ?', [r.id]);
        sent++;
      }
      if (sent > 0) toast(`${sent} perubahan berhasil dikirim ulang`, { tone: 'success' });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    const text = JSON.stringify(
      data.map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null })),
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
      toast('Detail disalin ke papan klip', { tone: 'success' });
    } catch {
      toast('Tidak bisa menyalin. Izinkan akses papan klip.', { tone: 'danger' });
    }
  };

  const clear = async () => {
    const ok = await askConfirm({
      title: `Hapus ${data.length} catatan perubahan yang ditolak?`,
      description: 'Isinya tidak bisa dipulihkan. Salin dulu kalau ada yang ingin diselamatkan.',
      confirmLabel: 'Hapus',
    });
    if (!ok) return;
    await powerSync.execute('DELETE FROM upload_errors');
  };

  return (
    <Disclosure
      className="mt-3 rounded-xl p-3 text-sm glass"
      summaryClassName="font-semibold"
      summary={`Lihat perubahan yang ditolak (${data.length})`}
    >
      <p className="mt-2 text-xs text-muted">
        Perubahan ini tidak masuk ke server dan mungkin tidak terlihat lagi di aplikasi. Setelah
        penyebabnya diperbaiki, kirim ulang dengan Coba lagi. Salin detailnya jika ada isi yang
        ingin diselamatkan.
      </p>
      <ul className="mt-2 max-h-60 space-y-2 overflow-auto">
        {data.map((r) => (
          <li key={r.id} className="rounded-lg bg-surface p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">
                {TABLE_LABEL[r.table_name] ?? r.table_name} · {r.op}
              </span>
              <span className="shrink-0 text-xs text-muted">{when(r.created_at)}</span>
            </div>
            <div className="text-xs text-muted">{explainErrorCode(r.error_code)}</div>
            {r.error_message && (
              <div className="mt-0.5 text-xs break-words text-muted">{r.error_message}</div>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 -ml-2"
              loading={busy === r.id}
              disabled={busy !== null && busy !== r.id}
              onClick={() => void retry([r], r.id)}
            >
              <RotateCcw /> Coba lagi
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.length > 1 && (
          <Button
            size="sm"
            loading={busy === 'all'}
            disabled={busy !== null && busy !== 'all'}
            onClick={() => void retry(data, 'all')}
          >
            <RotateCcw /> Coba lagi semua
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          <Copy /> Salin detail
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void clear()}>
          <Trash2 /> Bersihkan daftar
        </Button>
      </div>
    </Disclosure>
  );
}
