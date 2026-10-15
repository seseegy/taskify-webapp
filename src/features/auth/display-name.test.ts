import { describe, expect, it } from 'vitest';
import {
  cleanDisplayName,
  homeGreeting,
  isLoginNameEnabled,
  LOGIN_NAME_KEY,
  LOGIN_NAME_OFF_KEY,
  loginGreeting,
  readLoginName,
  setLoginNameEnabled,
  writeLoginName,
  type KeyValueStore,
} from './display-name';

/** Penyimpanan palsu berbasis Map; `broken` meniru localStorage yang melempar (mode privat). */
function fakeStore(broken = false): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const boom = () => {
    if (broken) throw new Error('SecurityError');
  };
  return {
    data,
    getItem: (k) => (boom(), data.get(k) ?? null),
    setItem: (k, v) => (boom(), void data.set(k, v)),
    removeItem: (k) => (boom(), void data.delete(k)),
  };
}

describe('cleanDisplayName', () => {
  it('merapikan spasi, tab, dan baris baru menjadi satu spasi', () => {
    expect(cleanDisplayName('  Budi \t  Santoso\n')).toBe('Budi Santoso');
  });

  it('null/undefined/hanya spasi menjadi string kosong', () => {
    expect(cleanDisplayName(null)).toBe('');
    expect(cleanDisplayName(undefined)).toBe('');
    expect(cleanDisplayName('   \n ')).toBe('');
  });

  it('membuang karakter kontrol tetapi mempertahankan huruf beraksen & aksara lain', () => {
    expect(cleanDisplayName('Jos\u0000é\u0007 Núñez')).toBe('José Núñez');
    expect(cleanDisplayName('Siti Nur Aisyah')).toBe('Siti Nur Aisyah');
  });

  it('TIDAK membuang ZWNJ/ZWJ: dipakai nama Persia dan emoji majemuk', () => {
    expect(cleanDisplayName('می\u200Cخواهم')).toContain('\u200C');
    expect(cleanDisplayName('👨\u200D👩\u200D👧')).toContain('\u200D');
  });

  it('dipotong ke 60 KARAKTER (bukan unit UTF-16) dan tidak berakhir spasi', () => {
    expect(cleanDisplayName('a'.repeat(100))).toHaveLength(60);
    const emoji = cleanDisplayName('😀'.repeat(100));
    expect(Array.from(emoji)).toHaveLength(60);
    expect(() => encodeURIComponent(emoji)).not.toThrow();
    const out = cleanDisplayName(`${'a'.repeat(59)} b`);
    expect(out.endsWith(' ')).toBe(false);
  });

  it('idempoten', () => {
    const once = cleanDisplayName('  Budi   Santoso ');
    expect(cleanDisplayName(once)).toBe(once);
  });
});

describe('penyimpanan nama untuk layar masuk', () => {
  it('menyimpan dan membaca nama yang sudah dirapikan', () => {
    const s = fakeStore();
    writeLoginName('  Budi   Santoso ', s);
    expect(s.data.get(LOGIN_NAME_KEY)).toBe('Budi Santoso');
    expect(readLoginName(s)).toBe('Budi Santoso');
  });

  it('nama kosong menghapus yang tersimpan (pengguna mengosongkan namanya)', () => {
    const s = fakeStore();
    writeLoginName('Budi', s);
    writeLoginName('', s);
    expect(readLoginName(s)).toBeNull();
    expect(s.data.has(LOGIN_NAME_KEY)).toBe(false);
  });

  it('tanpa data tersimpan → null', () => {
    expect(readLoginName(fakeStore())).toBeNull();
  });

  it('bawaan: aktif. Dimatikan → nama LANGSUNG terhapus dan tidak tertulis lagi', () => {
    const s = fakeStore();
    writeLoginName('Budi', s);
    expect(isLoginNameEnabled(s)).toBe(true);

    setLoginNameEnabled(false, 'Budi', s);
    expect(isLoginNameEnabled(s)).toBe(false);
    expect(s.data.has(LOGIN_NAME_KEY)).toBe(false); // privasi: tidak tersisa di perangkat
    expect(s.data.get(LOGIN_NAME_OFF_KEY)).toBe('1');
    expect(readLoginName(s)).toBeNull();

    // sinkronisasi nama dari database tetap memanggil write — harus diabaikan saat dimatikan
    writeLoginName('Budi', s);
    expect(s.data.has(LOGIN_NAME_KEY)).toBe(false);
  });

  it('dihidupkan lagi → nama dari database langsung disimpan', () => {
    const s = fakeStore();
    setLoginNameEnabled(false, 'Budi', s);
    setLoginNameEnabled(true, 'Budi', s);
    expect(isLoginNameEnabled(s)).toBe(true);
    expect(readLoginName(s)).toBe('Budi');
  });

  it('dihidupkan tetapi belum punya nama → tidak menyimpan apa pun', () => {
    const s = fakeStore();
    setLoginNameEnabled(true, '', s);
    expect(s.data.size).toBe(0);
  });

  it('nilai rusak/terlalu panjang di penyimpanan dirapikan saat dibaca', () => {
    const s = fakeStore();
    s.data.set(LOGIN_NAME_KEY, `  ${'x'.repeat(200)}  `);
    expect(readLoginName(s)).toHaveLength(60);
  });

  it('penyimpanan yang melempar (mode privat) TIDAK merusak aplikasi', () => {
    const s = fakeStore(true);
    expect(() => writeLoginName('Budi', s)).not.toThrow();
    expect(() => setLoginNameEnabled(false, 'Budi', s)).not.toThrow();
    expect(readLoginName(s)).toBeNull();
    expect(isLoginNameEnabled(s)).toBe(true);
  });

  it('tanpa penyimpanan sama sekali (null) aman', () => {
    expect(() => writeLoginName('Budi', null)).not.toThrow();
    expect(readLoginName(null)).toBeNull();
  });
});

describe('teks sapaan', () => {
  it('layar masuk: dengan nama → "kembali", aksen = nama; tanpa → sapaan umum', () => {
    expect(loginGreeting('Budi Santoso')).toEqual({
      text: 'Selamat datang kembali, Budi Santoso',
      accent: 'Budi Santoso',
    });
    expect(loginGreeting(null)).toEqual({
      text: 'Selamat datang di Taskify',
      accent: 'Taskify',
    });
  });

  it('aksen selalu berupa AKHIRAN teks (syarat splitTyped)', () => {
    for (const n of ['Budi', 'José Núñez', null]) {
      const g = loginGreeting(n);
      expect(g.text.endsWith(g.accent)).toBe(true);
    }
  });

  it('Beranda: dengan atau tanpa nama', () => {
    expect(homeGreeting('Selamat pagi', 'Budi Santoso')).toBe('Selamat pagi, Budi Santoso');
    expect(homeGreeting('Selamat pagi', '')).toBe('Selamat pagi');
  });
});
