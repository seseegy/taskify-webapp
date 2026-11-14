import { describe, expect, it } from 'vitest';
import {
  EXPIRY_CHOICES,
  shareTokenFromPath,
  TEMP_QUOTA_BYTES as CLIENT_QUOTA,
} from '../../src/features/tempfiles/tempfile-limits';
import {
  attachmentDisposition,
  checkedPublicDownload,
  EXPIRY_OPTIONS,
  expiresAtFor,
  isExpiryOption,
  isShareToken,
  isValidSize,
  newShareToken,
  normalizeEtag,
  safeEqual,
  sanitizeFileName,
  sanitizeMime,
  tempStorageKey,
  TEMP_KEY_RE,
  TEMP_QUOTA_BYTES,
  tokenFromPath,
  uploadTtlFor,
} from '../functions/_shared/tempfiles';

const U = '0192f3a0-aaaa-7000-8000-000000000001';
const F = '0192f3a0-bbbb-7000-8000-000000000002';

describe('Edge Function tempfiles · aturan murni', () => {
  it('pilihan masa berlaku klien = yang diterima server', () => {
    expect(EXPIRY_CHOICES.map((c) => c.value)).toEqual([...EXPIRY_OPTIONS]);
    expect(CLIENT_QUOTA).toBe(TEMP_QUOTA_BYTES);
  });

  it('masa berlaku dihitung dari jam server; "never" = tanpa batas; nilai lain ditolak', () => {
    const now = Date.parse('2026-11-01T00:00:00Z');
    expect(expiresAtFor('1h', now)).toBe('2026-11-01T01:00:00.000Z');
    expect(expiresAtFor('7d', now)).toBe('2026-11-08T00:00:00.000Z');
    expect(expiresAtFor('30d', now)).toBe('2026-12-01T00:00:00.000Z');
    expect(expiresAtFor('never', now)).toBeNull();
    for (const bad of ['2h', '', null, 7, '__proto__']) expect(isExpiryOption(bad)).toBe(false);
  });

  it('ukuran: bilangan bulat 1 B – 1 GB', () => {
    expect(isValidSize(1)).toBe(true);
    expect(isValidSize(TEMP_QUOTA_BYTES)).toBe(true);
    for (const bad of [0, -1, TEMP_QUOTA_BYTES + 1, 1.5, '10', NaN, Infinity, null])
      expect(isValidSize(bad), String(bad)).toBe(false);
  });

  it('nama berkas: karakter kontrol & pemisah path dibuang, ≤ 255 code point, tidak pernah kosong', () => {
    expect(sanitizeFileName('laporan Q3.pdf')).toBe('laporan Q3.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileName('a\r\nSet-Cookie: x')).toBe('a__Set-Cookie: x');
    expect(sanitizeFileName('  ')).toBe('berkas');
    expect(sanitizeFileName(undefined)).toBe('berkas');
    const emoji = '😀'.repeat(300);
    const out = sanitizeFileName(emoji);
    expect([...out]).toHaveLength(255);
    expect(out.endsWith('😀')).toBe(true); // tidak terpotong di tengah pasangan surrogate
  });

  it('MIME: hanya bentuk type/subtype yang wajar; parameter dibuang; sisanya octet-stream', () => {
    expect(sanitizeMime('image/png')).toBe('image/png');
    expect(sanitizeMime('Text/HTML; charset=utf-8')).toBe('text/html');
    expect(
      sanitizeMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    for (const bad of ['', 'x', 'a/b/c', 'text/html\r\nX: y', 42, null])
      expect(sanitizeMime(bad), String(bad)).toBe('application/octet-stream');
  });

  it('token: 32 byte acak → 43 karakter base64url; acak berbeda tiap kali', () => {
    const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const a = newShareToken(rnd);
    const b = newShareToken(rnd);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isShareToken(a)).toBe(true);
    expect(a).not.toBe(b);
    // byte 0xFF semua → memakai '_' (bukan '/'), tanpa padding '='
    expect(newShareToken((n) => new Uint8Array(n).fill(255))).toBe(`${'_'.repeat(42)}8`);
    for (const bad of ['', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}+`, null])
      expect(isShareToken(bad)).toBe(false);
  });

  it('key R2: temp/<id> — tanpa nama berkas DAN tanpa id pemilik (terlihat di URL unduhan publik)', () => {
    expect(tempStorageKey(F)).toBe(`temp/${F}`);
    expect(tempStorageKey(F)).not.toContain(U);
    expect(TEMP_KEY_RE.test(tempStorageKey(F))).toBe(true);
    expect(TEMP_KEY_RE.test(`temp/${U}/${F}`)).toBe(false);
    expect(() => tempStorageKey('a/b')).toThrow();
  });

  it('masa berlaku presigned PUT mengikuti ukuran: 15 menit – 1 jam', () => {
    expect(uploadTtlFor(1)).toBe(15 * 60);
    expect(uploadTtlFor(100 * 1024 * 1024)).toBe(400 + 600); // 100 MB @256 KB/s + 10 menit
    expect(uploadTtlFor(TEMP_QUOTA_BYTES)).toBe(60 * 60);
  });

  it('ETag: diambil apa adanya (termasuk kutip); kosong/kepanjangan → null', () => {
    expect(normalizeEtag('"abc123"')).toBe('"abc123"');
    expect(normalizeEtag('  "x" ')).toBe('"x"');
    expect(normalizeEtag(null)).toBeNull();
    expect(normalizeEtag('')).toBeNull();
    expect(normalizeEtag('x'.repeat(201))).toBeNull();
  });

  it('Content-Disposition selalu attachment, aman untuk header, nama UTF-8 terjaga', () => {
    expect(attachmentDisposition('foto liburan.jpg')).toBe(
      `attachment; filename="foto liburan.jpg"; filename*=UTF-8''foto%20liburan.jpg`,
    );
    const d = attachmentDisposition('laporan "final"\r\n😀.pdf');
    expect(d.startsWith('attachment;')).toBe(true);
    expect(d).not.toMatch(/[\r\n]/);
    expect(d).toContain('filename="laporan _final____.pdf"');
    expect(d).toContain(`filename*=UTF-8''laporan%20%22final%22__%F0%9F%98%80.pdf`);
    expect(attachmentDisposition("it's (1).txt")).toContain(
      "filename*=UTF-8''it%27s%20%281%29.txt",
    );
  });

  it('token dari path unduhan publik (Edge Function) dan halaman /unduh (aplikasi)', () => {
    const t = 'a'.repeat(43);
    expect(tokenFromPath(`/tempfiles/d/${t}`)).toBe(t);
    expect(tokenFromPath(`/functions/v1/tempfiles/d/${t}/`)).toBe(t);
    expect(tokenFromPath(`/tempfiles/d/${t}x`)).toBeNull();
    expect(tokenFromPath('/tempfiles')).toBeNull();
    expect(shareTokenFromPath(`/unduh/${t}`)).toBe(t);
    expect(shareTokenFromPath(`/unduh/${t}/`)).toBe(t);
    expect(shareTokenFromPath(`/unduh/${t}/lain`)).toBeNull();
    expect(shareTokenFromPath('/unduh/pendek')).toBeNull();
  });

  it('safeEqual: sama persis saja; kosong selalu tidak sama', () => {
    expect(safeEqual('rahasia-cron', 'rahasia-cron')).toBe(true);
    expect(safeEqual('rahasia-cron', 'rahasia-cro')).toBe(false);
    expect(safeEqual('rahasia-cron', 'Rahasia-cron')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(null, 'x')).toBe(false);
    expect(safeEqual('x', undefined)).toBe(false);
  });
});

describe('checkedPublicDownload · periksa dulu, baru hitung', () => {
  const TOKEN = 'A'.repeat(43);
  type Row = { id: string; etag: string | null };
  const row: Row = { id: F, etag: '"abc"' };

  /** resolve palsu yang mencatat setiap panggilan (count = true berarti menambah hitungan). */
  function fakeResolve(answers: { peek: Row | null; counted?: Row | null }) {
    const calls: boolean[] = [];
    const resolve = async (_t: string, count: boolean) => {
      calls.push(count);
      return count
        ? answers.counted === undefined
          ? answers.peek
          : answers.counted
        : answers.peek;
    };
    return { resolve, calls };
  }
  const ok = async () => {};

  it('GET yang lolos: diperiksa lalu dihitung tepat sekali', async () => {
    const r = fakeResolve({ peek: row });
    const order: string[] = [];
    const got = await checkedPublicDownload(TOKEN, true, {
      resolve: async (t, c) => (order.push(c ? 'count' : 'peek'), r.resolve(t, c)),
      verify: async () => void order.push('verify'),
    });
    expect(got).toEqual(row);
    expect(order).toEqual(['peek', 'verify', 'count']);
  });

  it('isi berubah (verify melempar): TIDAK dihitung, error diteruskan', async () => {
    const r = fakeResolve({ peek: row });
    const boom = new Error('berubah');
    await expect(
      checkedPublicDownload(TOKEN, true, {
        resolve: r.resolve,
        verify: async () => Promise.reject(boom),
      }),
    ).rejects.toBe(boom);
    expect(r.calls).toEqual([false]);
  });

  it('tidak ada / tidak publik: null, tanpa verify & tanpa hitung', async () => {
    const r = fakeResolve({ peek: null });
    let verified = false;
    const got = await checkedPublicDownload(TOKEN, true, {
      resolve: r.resolve,
      verify: async () => void (verified = true),
    });
    expect(got).toBeNull();
    expect(verified).toBe(false);
    expect(r.calls).toEqual([false]);
  });

  it('token tidak valid: tidak menyentuh database', async () => {
    const r = fakeResolve({ peek: row });
    expect(
      await checkedPublicDownload('pendek', true, { resolve: r.resolve, verify: ok }),
    ).toBeNull();
    expect(await checkedPublicDownload(null, true, { resolve: r.resolve, verify: ok })).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('HEAD (count = false): diperiksa, tidak dihitung', async () => {
    const r = fakeResolve({ peek: row });
    expect(await checkedPublicDownload(TOKEN, false, { resolve: r.resolve, verify: ok })).toEqual(
      row,
    );
    expect(r.calls).toEqual([false]);
  });

  it('dihapus/dicabut di sela pemeriksaan dan penghitungan: null (404)', async () => {
    const r = fakeResolve({ peek: row, counted: null });
    expect(await checkedPublicDownload(TOKEN, true, { resolve: r.resolve, verify: ok })).toBeNull();
  });

  it('baris yang dihitung bukan yang diperiksa (id/etag beda): null', async () => {
    for (const counted of [
      { ...row, id: U },
      { ...row, etag: '"lain"' },
    ]) {
      const r = fakeResolve({ peek: row, counted });
      expect(
        await checkedPublicDownload(TOKEN, true, { resolve: r.resolve, verify: ok }),
      ).toBeNull();
    }
  });
});
