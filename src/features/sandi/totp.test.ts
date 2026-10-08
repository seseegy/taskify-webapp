import { describe, expect, it } from 'vitest';
import {
  counterAt,
  decodeBase32,
  DEFAULT_ALGORITHM,
  DEFAULT_PERIOD,
  formatSecret,
  hotpFromBytes,
  parseTotpConfig,
  parseTotpInput,
  PERIOD_MAX,
  PERIOD_MIN,
  totpProblem,
  totpWindow,
  type TotpAlgorithm,
  type TotpDigits,
} from './totp';

const hex = (s: string) =>
  new Uint8Array((s.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16))) as Uint8Array<ArrayBuffer>;

// RFC 6238 Appendix A/B — kunci uji resmi (ASCII "12345678901234567890" dan perpanjangannya).
const SEED = {
  SHA1: hex('3132333435363738393031323334353637383930'),
  SHA256: hex('3132333435363738393031323334353637383930313233343536373839303132'),
  SHA512: hex(
    '31323334353637383930313233343536373839303132333435363738393031323334353637383930313233343536373839303132333435363738393031323334',
  ),
} satisfies Record<TotpAlgorithm, Uint8Array<ArrayBuffer>>;

/** base32 dari ASCII "12345678901234567890" (20 byte = 32 karakter, tanpa padding). */
const SEED_SHA1_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP · vektor uji RFC 6238', () => {
  // Tabel Appendix B, mode 8 digit, periode 30 detik, T0 = 0.
  const VECTORS: [seconds: number, algorithm: TotpAlgorithm, code: string][] = [
    [59, 'SHA1', '94287082'],
    [59, 'SHA256', '46119246'],
    [59, 'SHA512', '90693936'],
    [1111111109, 'SHA1', '07081804'],
    [1111111109, 'SHA256', '68084774'],
    [1111111109, 'SHA512', '25091201'],
    [1111111111, 'SHA1', '14050471'],
    [1111111111, 'SHA256', '67062674'],
    [1111111111, 'SHA512', '99943326'],
  ];

  for (const [seconds, algorithm, expected] of VECTORS) {
    it(`t=${seconds} ${algorithm} → ${expected}`, async () => {
      const counter = counterAt(seconds * 1000, 30);
      expect(await hotpFromBytes(SEED[algorithm], counter, 8, algorithm)).toBe(expected);
    });
  }

  it('6 digit = 6 angka terakhir dari kode 8 digit yang sama', async () => {
    const counter = counterAt(59_000, 30);
    expect(await hotpFromBytes(SEED.SHA1, counter, 6, 'SHA1')).toBe('287082');
  });

  it('kunci yang sama lewat base32 + totpWindow menghasilkan kode RFC yang sama', async () => {
    const w = await totpWindow(
      { secret: SEED_SHA1_B32, digits: 8, period: 30, algorithm: 'SHA1' },
      59_000,
    );
    expect(w?.code).toBe('94287082');
    // periode berikutnya (t = 60..89) harus sama dengan vektor t=1111111109? tidak — cukup beda.
    expect(w?.next).not.toBe(w?.code);
  });
});

describe('TOTP · jendela waktu', () => {
  const config = {
    secret: SEED_SHA1_B32,
    digits: 6 as TotpDigits,
    period: 30,
    algorithm: 'SHA1' as const,
  };

  it('sisa waktu dihitung sampai akhir periode, bukan dari awal pemanggilan', async () => {
    expect((await totpWindow(config, 0))!.remainingMs).toBe(30_000);
    expect((await totpWindow(config, 29_000))!.remainingMs).toBe(1_000);
    expect((await totpWindow(config, 29_999))!.remainingMs).toBe(1);
    expect((await totpWindow(config, 30_000))!.remainingMs).toBe(30_000);
  });

  it('kode tetap sama di dalam satu periode dan berubah di batas periode', async () => {
    const a = await totpWindow(config, 0);
    const b = await totpWindow(config, 29_999);
    const c = await totpWindow(config, 30_000);
    expect(b!.code).toBe(a!.code);
    expect(c!.code).not.toBe(a!.code);
    // kode "berikutnya" pada periode pertama = kode yang berlaku pada periode kedua
    expect(a!.next).toBe(c!.code);
  });

  it('kunci yang tidak bisa diurai atau terlalu pendek → null', async () => {
    expect(await totpWindow({ ...config, secret: 'bukan base32 !!!' }, 0)).toBeNull();
    expect(await totpWindow({ ...config, secret: 'JBSW' }, 0)).toBeNull();
  });
});

describe('base32 (RFC 4648)', () => {
  const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

  it('vektor RFC 4648 bolak-balik', () => {
    expect(text(decodeBase32('MY======'))).toBe('f');
    expect(text(decodeBase32('MZXQ===='))).toBe('fo');
    expect(text(decodeBase32('MZXW6==='))).toBe('foo');
    expect(text(decodeBase32('MZXW6YQ='))).toBe('foob');
    expect(text(decodeBase32('MZXW6YTB'))).toBe('fooba');
    expect(text(decodeBase32('MZXW6YTBOI======'))).toBe('foobar');
    expect(text(decodeBase32('JBSWY3DP'))).toBe('Hello');
  });

  it('toleran: huruf kecil, spasi, tanda hubung, dan tanpa padding', () => {
    const want = Array.from(decodeBase32('JBSWY3DPEHPK3PXP')!);
    for (const variant of [
      'jbswy3dpehpk3pxp',
      'JBSW Y3DP EHPK 3PXP',
      'JBSW-Y3DP-EHPK-3PXP',
      '  JBSWY3DPEHPK3PXP  ',
    ])
      expect(Array.from(decodeBase32(variant)!), variant).toEqual(want);
  });

  it('menolak karakter di luar alfabet (0, 1, 8, 9, tanda baca)', () => {
    for (const bad of ['JBSWY3D0', 'JBSWY3D1', 'JBSWY3D8', 'JBSWY3D9', 'JBSW_Y3D', 'JBSWY3D!'])
      expect(decodeBase32(bad), bad).toBeNull();
  });

  it('menolak panjang yang mustahil (sisa 1, 3, atau 6 karakter)', () => {
    expect(decodeBase32('JBSWY3DPE')).toBeNull(); // 9 → sisa 1
    expect(decodeBase32('JBSWY3DPEHP')).toBeNull(); // 11 → sisa 3
    expect(decodeBase32('JBSWY3DPEHPK3P')).toBeNull(); // 14 → sisa 6
    expect(decodeBase32('')).toBeNull();
  });

  it('formatSecret mengelompokkan 4 karakter', () => {
    expect(formatSecret('jbswy3dpehpk3pxp')).toBe('JBSW Y3DP EHPK 3PXP');
  });
});

describe('parseTotpInput', () => {
  it('kunci base32 saja → nilai bawaan 6 digit / 30 detik / SHA1', () => {
    const r = parseTotpInput('JBSWY3DPEHPK3PXP');
    expect(r?.config).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      period: DEFAULT_PERIOD,
      algorithm: DEFAULT_ALGORITHM,
    });
    expect(r?.name).toBe('');
    expect(r?.username).toBe('');
  });

  it('URI otpauth lengkap: nama, username, dan parameter terbaca', () => {
    const r = parseTotpInput(
      'otpauth://totp/GitHub:rosyid%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=8&period=60&algorithm=SHA256',
    );
    expect(r?.name).toBe('GitHub');
    expect(r?.username).toBe('rosyid@example.com');
    expect(r?.config.digits).toBe(8);
    expect(r?.config.period).toBe(60);
    expect(r?.config.algorithm).toBe('SHA256');
  });

  it('issuer dari label dipakai bila parameter issuer tidak ada', () => {
    const r = parseTotpInput('otpauth://totp/Binance:budi?secret=JBSWY3DPEHPK3PXP');
    expect(r?.name).toBe('Binance');
    expect(r?.username).toBe('budi');
  });

  it('label tanpa issuer: username saja, nama kosong', () => {
    const r = parseTotpInput('otpauth://totp/budi?secret=JBSWY3DPEHPK3PXP');
    expect(r?.name).toBe('');
    expect(r?.username).toBe('budi');
  });

  it('parameter aneh jatuh ke nilai bawaan, bukan gagal', () => {
    const r = parseTotpInput(
      'otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&digits=7&period=0&algorithm=MD5',
    );
    expect(r?.config.digits).toBe(6);
    expect(r?.config.period).toBe(PERIOD_MIN);
    expect(r?.config.algorithm).toBe('SHA1');
  });

  it('periode dibatasi pada rentang yang masuk akal', () => {
    expect(parseTotpConfig({ secret: 'JBSWY3DPEHPK3PXP', period: 99999 })?.period).toBe(PERIOD_MAX);
    expect(parseTotpConfig({ secret: 'JBSWY3DPEHPK3PXP', period: -5 })?.period).toBe(PERIOD_MIN);
    expect(parseTotpConfig({ secret: 'JBSWY3DPEHPK3PXP', period: NaN })?.period).toBe(
      DEFAULT_PERIOD,
    );
  });

  it('hotp (berbasis penghitung) dan URI rusak ditolak', () => {
    expect(parseTotpInput('otpauth://hotp/X?secret=JBSWY3DPEHPK3PXP&counter=1')).toBeNull();
    expect(parseTotpInput('otpauth://totp/X?secret=tidak-valid-0189')).toBeNull();
    expect(parseTotpInput('otpauth://totp/X')).toBeNull();
    expect(parseTotpInput('')).toBeNull();
  });
});

describe('parseTotpConfig (dari hasil dekripsi item)', () => {
  it('bentuk yang tidak masuk akal → null (item tetap bisa dibuka)', () => {
    for (const bad of [null, undefined, 'JBSWY3DPEHPK3PXP', [], 42, {}, { secret: 123 }])
      expect(parseTotpConfig(bad), JSON.stringify(bad)).toBeNull();
  });

  it('kunci terlalu pendek ditolak', () => {
    expect(parseTotpConfig({ secret: 'JBSWY3DP' })).toBeNull(); // 5 byte
  });

  it('spasi dan huruf kecil dinormalkan saat disimpan', () => {
    expect(parseTotpConfig({ secret: 'jbsw y3dp ehpk 3pxp' })?.secret).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('totpProblem (pesan untuk pengguna)', () => {
  it('menerima kunci dan URI yang sah', () => {
    expect(totpProblem('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(totpProblem('otpauth://totp/X?secret=JBSWY3DPEHPK3PXP')).toBeNull();
  });

  it('pesan menyebut penyebabnya', () => {
    expect(totpProblem('')).toMatch(/Tempel/);
    expect(totpProblem('JBSWY3D0')).toMatch(/base32/);
    expect(totpProblem('JBSWY3DP')).toMatch(/pendek/);
    expect(totpProblem('otpauth://hotp/X?secret=JBSWY3DPEHPK3PXP')).toMatch(/otpauth:\/\/totp/);
    expect(totpProblem('otpauth://totp/X')).toMatch(/tidak bisa dibaca|tidak valid/);
  });
});
