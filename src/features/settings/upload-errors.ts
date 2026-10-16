import { UpdateType } from '@powersync/web';
import { ROW_MISSING_CODE, type PostgrestLikeError } from '@/db/upload-policy';
import { EXPORT_TABLES } from './export-tables';

/** Penjelasan singkat untuk kode error yang dianggap permanen (lihat db/upload-policy.ts). */
export function explainErrorCode(code: string | null): string {
  if (!code) return 'Ditolak server';
  if (code === ROW_MISSING_CODE)
    return 'Data ini tidak ada di server (mungkin sudah dihapus permanen di perangkat lain)';
  if (/^PGRST[12]\d\d$/.test(code))
    return 'Tabel/kolom belum ada di server (migrasi database belum dijalankan?)';
  if (code === '23514')
    return 'Melanggar batas isian (mis. teks terlalu panjang atau nilai tidak valid)';
  if (code === '23503') return 'Mengacu ke data yang sudah tidak ada';
  if (code === '23502') return 'Ada isian wajib yang kosong';
  if (code === '23505') return 'Data dengan kunci yang sama sudah ada';
  if (code === '42501') return 'Ditolak izin akses (RLS)';
  if (code.startsWith('22')) return 'Format data tidak valid';
  return 'Ditolak server';
}

// ----------------------------------------------------------------------------- coba lagi
export interface UploadErrorRecord {
  op: string;
  table_name: string;
  row_id: string;
  payload: string | null;
}

export type RetryOutcome = { ok: true } | { ok: false; message: string };

export interface RetryDeps {
  /** Terapkan satu operasi ke server (connector.applyOp). */
  apply: (op: {
    op: UpdateType;
    table: string;
    id: string;
    opData?: Record<string, unknown>;
  }) => Promise<PostgrestLikeError | null>;
  /** Baris lokal saat ini (null bila tidak ada di perangkat). */
  localRow: (table: string, id: string) => Promise<Record<string, unknown> | null>;
}

const SYNCED = new Set<string>(EXPORT_TABLES);

const failure = (e: PostgrestLikeError): RetryOutcome => ({
  ok: false,
  message: [explainErrorCode(e.code ?? null), e.message].filter(Boolean).join(' — '),
});

/**
 * Kirim ulang satu perubahan yang ditolak LANGSUNG ke server (butuh online), dengan aturan yang
 * sama seperti antrean upload. Berguna setelah penyebabnya diperbaiki (migrasi dijalankan, data
 * induk dipulihkan, dsb). Hasilnya kembali ke perangkat lewat sync seperti biasa.
 *
 * PATCH ke baris yang tidak ada di server (TASKIFY_ROW_MISSING) dikirim ulang sebagai PUT berisi
 * baris lokal + perubahannya, bila baris itu masih ada di perangkat — sehingga baris yang dulu
 * gagal dibuat ikut terbuat.
 */
export async function retryUploadError(
  r: UploadErrorRecord,
  deps: RetryDeps,
): Promise<RetryOutcome> {
  if (!SYNCED.has(r.table_name)) return { ok: false, message: 'Tabel tidak dikenal' };
  const op = r.op as UpdateType;
  if (op !== UpdateType.PUT && op !== UpdateType.PATCH && op !== UpdateType.DELETE)
    return { ok: false, message: `Operasi tidak dikenal: ${r.op}` };

  let data: Record<string, unknown> | undefined;
  try {
    data = r.payload
      ? ((JSON.parse(r.payload) as Record<string, unknown> | null) ?? undefined)
      : undefined;
  } catch {
    return { ok: false, message: 'Isi perubahan rusak' };
  }

  const error = await deps.apply({ op, table: r.table_name, id: r.row_id, opData: data });
  if (!error) return { ok: true };
  if (op !== UpdateType.PATCH || error.code !== ROW_MISSING_CODE) return failure(error);

  const local = await deps.localRow(r.table_name, r.row_id);
  if (!local)
    return {
      ok: false,
      message:
        'Data aslinya sudah tidak ada di perangkat maupun server. Salin detail untuk memasukkan ulang secara manual.',
    };
  const { id: _id, ...rest } = local;
  const again = await deps.apply({
    op: UpdateType.PUT,
    table: r.table_name,
    id: r.row_id,
    opData: { ...rest, ...data },
  });
  return again ? failure(again) : { ok: true };
}
