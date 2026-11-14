import { describe, expect, it } from 'vitest';
import type { TempFile } from '@/db/schema';
import {
  countsTowardQuota,
  directDownloadUrl,
  expiryLabel,
  expiryShort,
  fileKind,
  fileState,
  isExecutableName,
  isPublicDownloadPath,
  isShareable,
  mergeOverlay,
  quotaProblem,
  settledOverlayIds,
  shareTokenFromPath,
  shareUrl,
  TEMP_QUOTA_BYTES,
  usedBytes,
} from './tempfile-utils';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const MB = 1024 * 1024;

const row = (over: Partial<TempFile> = {}): TempFile => ({
  id: 'f1',
  user_id: 'u',
  created_at: '2026-11-01 11:00:00Z', // format sinkron PowerSync
  updated_at: '2026-11-01 11:00:00Z',
  deleted_at: null,
  file_name: 'a.pdf',
  mime_type: 'application/pdf',
  size_bytes: 10 * MB,
  storage_key: 'temp/u/f1',
  status: 'ready',
  etag: null,
  share_token: 'x'.repeat(43),
  is_public: 1,
  expires_at: null,
  download_count: 0,
  last_download_at: null,
  ...over,
});

describe('kuota (aturan SAMA dengan temp_files_used_bytes di SQL)', () => {
  it('siap = dihitung berapa pun umurnya; dihapus & kedaluwarsa tidak', () => {
    expect(countsTowardQuota(row({ created_at: '2025-01-01 00:00:00Z' }), NOW)).toBe(true);
    expect(countsTowardQuota(row({ deleted_at: '2026-11-01 11:30:00Z' }), NOW)).toBe(false);
    expect(countsTowardQuota(row({ expires_at: '2026-11-01 11:59:59Z' }), NOW)).toBe(false);
    expect(countsTowardQuota(row({ expires_at: '2026-11-01T12:00:01.000Z' }), NOW)).toBe(true);
  });

  it('pesanan unggah (pending) dihitung selama 2 jam, sesudahnya dianggap ditinggalkan', () => {
    expect(
      countsTowardQuota(row({ status: 'pending', created_at: '2026-11-01 10:30:00Z' }), NOW),
    ).toBe(true);
    expect(
      countsTowardQuota(row({ status: 'pending', created_at: '2026-11-01 09:59:00Z' }), NOW),
    ).toBe(false);
  });

  it('usedBytes menjumlahkan yang masih hidup saja', () => {
    expect(
      usedBytes(
        [
          row(),
          row({ id: 'b', size_bytes: 5 * MB }),
          row({ id: 'c', deleted_at: '2026-11-01 11:00:00Z' }),
        ],
        NOW,
      ),
    ).toBe(15 * MB);
  });

  it('pemeriksaan awal: kosong, > 1 GB, dan sisa kuota kurang ditolak dengan pesan', () => {
    expect(quotaProblem(0, [], NOW)).toMatch(/kosong/);
    expect(quotaProblem(TEMP_QUOTA_BYTES + 1, [], NOW)).toMatch(/1 GB/);
    expect(quotaProblem(TEMP_QUOTA_BYTES, [], NOW)).toBeNull();
    expect(quotaProblem(TEMP_QUOTA_BYTES - 10 * MB + 1, [row()], NOW)).toMatch(/Kuota/);
    expect(quotaProblem(TEMP_QUOTA_BYTES - 10 * MB, [row()], NOW)).toBeNull();
    // Berkas lain di antrean yang sama ikut dihitung, dan pesannya tetap soal kuota (bukan ukuran)
    expect(quotaProblem(600 * MB, [], NOW, 600 * MB)).toMatch(/Kuota/);
    expect(quotaProblem(400 * MB, [], NOW, 600 * MB)).toBeNull();
  });
});

describe('status & tautan', () => {
  it('kedaluwarsa mengalahkan status; hanya siap + publik yang bisa dibagikan', () => {
    expect(fileState(row(), NOW)).toBe('ready');
    expect(fileState(row({ status: 'pending' }), NOW)).toBe('pending');
    expect(fileState(row({ expires_at: '2026-11-01 11:00:00Z' }), NOW)).toBe('expired');
    expect(isShareable(row(), NOW)).toBe(true);
    expect(isShareable(row({ is_public: 0 }), NOW)).toBe(false);
    expect(isShareable(row({ status: 'pending' }), NOW)).toBe(false);
    expect(isShareable(row({ expires_at: '2026-11-01 11:00:00Z' }), NOW)).toBe(false);
  });

  it('URL halaman publik & unduhan langsung; token dibaca kembali dari path', () => {
    const t = 'A_b-'.repeat(10) + 'xyz';
    expect(shareUrl('https://app.example/', t)).toBe(`https://app.example/unduh/${t}`);
    expect(shareTokenFromPath(new URL(shareUrl('https://app.example', t)).pathname)).toBe(t);
    // Tautan terpotong tetap halaman publik (bukan layar login), tetapi tanpa token
    expect(isPublicDownloadPath('/unduh/pendek')).toBe(true);
    expect(isPublicDownloadPath('/unduh')).toBe(true);
    expect(isPublicDownloadPath('/unduhan')).toBe(false);
    expect(isPublicDownloadPath('/berkas')).toBe(false);
    expect(shareTokenFromPath('/unduh/pendek')).toBeNull();
    expect(directDownloadUrl('https://p.supabase.co/', t)).toBe(
      `https://p.supabase.co/functions/v1/tempfiles/d/${t}`,
    );
  });

  it('label masa berlaku: menit, jam, hari, tanpa batas, kedaluwarsa', () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    expect(expiryLabel(null, NOW)).toBe('Tanpa batas waktu');
    expect(expiryLabel(at(-1), NOW)).toBe('Kedaluwarsa');
    expect(expiryLabel(at(30_000), NOW)).toBe('Kedaluwarsa dalam 1 menit');
    expect(expiryLabel(at(59 * 60_000), NOW)).toBe('Kedaluwarsa dalam 59 menit');
    expect(expiryLabel(at(5 * 3600_000), NOW)).toBe('Kedaluwarsa dalam 5 jam');
    expect(expiryLabel(at(47 * 3600_000), NOW)).toBe('Kedaluwarsa dalam 47 jam');
    expect(expiryLabel(at(7 * 86_400_000), NOW)).toBe('Kedaluwarsa dalam 7 hari');
    // Regresi (audit UI): sisa sedikit di bawah 1 jam dulu tertulis "0 jam"
    expect(expiryLabel(at(3600_000 - 1500), NOW)).toBe('Kedaluwarsa dalam 1 jam');
    // Tepat setelah memilih "7 hari" (beberapa detik berlalu) tetap 7, bukan 6
    expect(expiryLabel(at(7 * 86_400_000 - 5000), NOW)).toBe('Kedaluwarsa dalam 7 hari');
    expect(expiryLabel(at(1), NOW)).toBe('Kedaluwarsa dalam 1 menit');
    // format sinkron (spasi) diperlakukan sama
    expect(expiryLabel('2026-11-01 13:00:00Z', NOW)).toBe('Kedaluwarsa dalam 1 jam');
  });

  it('label ringkas untuk baris daftar memakai pembulatan yang sama', () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    expect(expiryShort(null, NOW)).toBe('Tanpa batas');
    expect(expiryShort(at(0), NOW)).toBe('Kedaluwarsa');
    expect(expiryShort(at(30_000), NOW)).toBe('Sisa 1 menit');
    expect(expiryShort(at(3600_000 - 1500), NOW)).toBe('Sisa 1 jam');
    expect(expiryShort(at(7 * 86_400_000 - 5000), NOW)).toBe('Sisa 7 hari');
    expect(expiryShort(at(6 * 86_400_000 + 3 * 3600_000), NOW)).toBe('Sisa 6 hari');
  });
});

describe('overlay hasil server sampai sinkron menyusul', () => {
  it('baris server yang LEBIH BARU menang walau format waktunya beda; yang lebih lama diabaikan', () => {
    const local = [row({ id: 'a', file_name: 'lama.pdf' }), row({ id: 'b' })];
    const merged = mergeOverlay(local, {
      a: row({ id: 'a', file_name: 'baru.pdf', updated_at: '2026-11-01T11:05:00.123456+00:00' }),
      b: row({ id: 'b', file_name: 'basi.pdf', updated_at: '2026-11-01T10:00:00+00:00' }),
    });
    expect(merged.map((r) => r.file_name)).toEqual(['baru.pdf', 'a.pdf']);
  });

  it('dihapus di server (null) langsung hilang dari daftar', () => {
    expect(
      mergeOverlay([row({ id: 'a' }), row({ id: 'b' })], { a: null }).map((r) => r.id),
    ).toEqual(['b']);
  });

  it('overlay dibuang setelah sinkron menyusul (baris lokal sama baru / sudah hilang)', () => {
    const overlay = {
      a: row({ id: 'a', updated_at: '2026-11-01T11:05:00+00:00' }),
      b: row({ id: 'b', updated_at: '2026-11-01T11:05:00+00:00' }),
      gone: null,
      stillThere: null,
      fresh: row({ id: 'fresh' }),
    };
    const local = [
      row({ id: 'a', updated_at: '2026-11-01 11:05:00Z' }), // tersusul
      row({ id: 'b', updated_at: '2026-11-01 11:00:00Z' }), // belum
      row({ id: 'stillThere' }),
    ];
    expect(settledOverlayIds(local, overlay).sort()).toEqual(['a', 'gone']);
  });
});

describe('jenis berkas', () => {
  it('ikon menurut MIME lalu ekstensi', () => {
    expect(fileKind('image/png', 'x.png')).toBe('image');
    expect(fileKind('application/octet-stream', 'arsip.ZIP')).toBe('archive');
    expect(fileKind('application/octet-stream', 'data.csv')).toBe('sheet');
    expect(fileKind('application/pdf', 'a.pdf')).toBe('document');
    expect(fileKind('application/octet-stream', 'Makefile')).toBe('other');
  });

  it('berkas program ditandai untuk peringatan di halaman publik', () => {
    for (const n of ['setup.exe', 'app.APK', 'run.sh ', 'x.ps1'])
      expect(isExecutableName(n), n).toBe(true);
    for (const n of ['foto.jpg', 'exe.txt', 'laporan.pdf'])
      expect(isExecutableName(n), n).toBe(false);
  });
});
