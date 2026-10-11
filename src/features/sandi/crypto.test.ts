import { describe, expect, it } from 'vitest';
import {
  changePassword,
  createVault,
  decryptConfig,
  encryptConfig,
  parseConfigPayload,
  reencryptConfigVersions,
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  decryptItem,
  encryptItem,
  formatRecoveryKey,
  fromB64,
  parsePayload,
  parseRecoveryKey,
  reencryptItems,
  resetPasswordWithRecovery,
  rotateRecoveryKey,
  SandiError,
  toB64,
  unlockWithPassword,
  unlockWithRecoveryKey,
  type ItemPayload,
  type KeyRecord,
} from './crypto';

// Batas minimum yang diizinkan (100 ribu) agar tes cepat. Satu tes memakai nilai produksi.
const FAST = { iterations: MIN_ITERATIONS };
const USER = '0192f3a0-aaaa-7000-8000-000000000001';
const OTHER_USER = '0192f3a0-bbbb-7000-8000-000000000002';
const PASSWORD = 'kuda-biru-minum-kopi-pagi';

const item = (over: Partial<ItemPayload> = {}): ItemPayload => ({
  totp: null,
  title: 'GitHub',
  url: 'https://github.com/login',
  username: 'rosyid',
  password: 'Zk9#mQ2$vL7!pXr4',
  notes: 'kode cadangan di buku',
  favorite: false,
  ...over,
});

async function setup() {
  const vault = await createVault(PASSWORD, USER, FAST);
  return vault;
}

describe('brankas · membuat & membuka', () => {
  it('master password benar membuka kunci yang bisa mendekripsi item', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'item-1', item());

    const dek = await unlockWithPassword(v.record, PASSWORD, USER);
    expect(dek).not.toBeNull();
    expect(await decryptItem(dek!, USER, 'item-1', enc)).toEqual(item());
  });

  it('master password salah → null (bukan error)', async () => {
    const v = await setup();
    expect(await unlockWithPassword(v.record, PASSWORD + 'x', USER)).toBeNull();
    expect(await unlockWithPassword(v.record, '', USER)).toBeNull();
    expect(await unlockWithPassword(v.record, PASSWORD.toUpperCase(), USER)).toBeNull();
  });

  it('password dinormalisasi NFKC: bentuk lebar-penuh dan biasa menghasilkan kunci sama', async () => {
    const v = await createVault('ｐａｓｓｗｏｒｄ-ｅｍｐａｔ', USER, FAST);
    expect(await unlockWithPassword(v.record, 'password-empat', USER)).not.toBeNull();
  });

  it('record tidak memuat password maupun DEK polos, dan parameter KDF tersimpan', async () => {
    const v = await setup();
    const json = JSON.stringify(v.record);
    expect(json).not.toContain(PASSWORD);
    expect(json).not.toContain(v.recoveryKey);
    expect(v.record).toMatchObject({
      kdf: 'pbkdf2-sha256',
      iterations: MIN_ITERATIONS,
      version: 1,
    });
    // IV 12 + DEK 32 + tag 16 = 60 byte
    expect(fromB64(v.record.wrapped_key)).toHaveLength(60);
    expect(fromB64(v.record.recovery_wrapped_key)).toHaveLength(60);
    expect(fromB64(v.record.salt)).toHaveLength(16);
  });

  it('dua brankas dengan password sama tidak berbagi salt/kunci', async () => {
    const a = await setup();
    const b = await setup();
    expect(a.record.salt).not.toBe(b.record.salt);
    expect(a.record.wrapped_key).not.toBe(b.record.wrapped_key);
    expect(a.recoveryKey).not.toBe(b.recoveryKey);
  });

  it('parameter produksi: 600 ribu iterasi dipakai bila tidak di-override', async () => {
    const v = await createVault(PASSWORD, USER);
    expect(v.record.iterations).toBe(DEFAULT_ITERATIONS);
    expect(DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(await unlockWithPassword(v.record, PASSWORD, USER)).not.toBeNull();
  }, 30_000);

  it('record milik pengguna lain tidak bisa dibuka walau password benar (AAD mengikat user)', async () => {
    const v = await setup();
    expect(await unlockWithPassword(v.record, PASSWORD, OTHER_USER)).toBeNull();
  });

  it('PAGAR: record dari server dengan iterasi terlalu rendah/tinggi/aneh ditolak SEBELUM menurunkan kunci', async () => {
    const v = await setup();
    for (const iterations of [
      1,
      1000,
      MIN_ITERATIONS - 1,
      MAX_ITERATIONS + 1,
      2 ** 31,
      0,
      -5,
      1.5,
      NaN,
    ]) {
      const forged = { ...v.record, iterations };
      const t0 = performance.now();
      await expect(
        unlockWithPassword(forged, PASSWORD, USER),
        `${iterations}`,
      ).rejects.toMatchObject({
        name: 'SandiError',
        code: 'invalid',
      });
      await expect(
        unlockWithRecoveryKey(forged, v.recoveryKey, USER),
        `${iterations}`,
      ).rejects.toMatchObject({
        code: 'invalid',
      });
      expect(performance.now() - t0, `${iterations} ditolak cepat`).toBeLessThan(500);
    }
    // batas itu sendiri sah
    expect(
      await unlockWithPassword({ ...v.record, iterations: MIN_ITERATIONS }, PASSWORD, USER),
    ).not.toBeNull();
  });

  it('PAGAR: ganti password / pemulihan dengan record bermasalah juga ditolak', async () => {
    const v = await setup();
    const forged = { ...v.record, iterations: 1000 };
    await expect(
      changePassword(forged, PASSWORD, 'baru-baru-baru-baru', USER, FAST),
    ).rejects.toBeInstanceOf(SandiError);
    await expect(rotateRecoveryKey(forged, PASSWORD, USER, FAST)).rejects.toBeInstanceOf(
      SandiError,
    );
    await expect(
      resetPasswordWithRecovery(forged, v.recoveryKey, 'baru-baru-baru-baru', USER, FAST),
    ).rejects.toBeInstanceOf(SandiError);
  });

  it('PAGAR: tidak bisa MEMBUAT brankas dengan iterasi di bawah batas', async () => {
    await expect(createVault(PASSWORD, USER, { iterations: 1000 })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      createVault(PASSWORD, USER, { iterations: MAX_ITERATIONS + 1 }),
    ).rejects.toBeInstanceOf(SandiError);
    await expect(
      changePassword((await setup()).record, PASSWORD, 'baru-baru-baru-baru', USER, {
        iterations: 5,
      }),
    ).rejects.toBeInstanceOf(SandiError);
  });

  it('versi/KDF yang tidak dikenal ditolak dengan pesan jelas, bukan dianggap password salah', async () => {
    const v = await setup();
    const future = { ...v.record, version: 99 };
    await expect(unlockWithPassword(future, PASSWORD, USER)).rejects.toMatchObject({
      name: 'SandiError',
      code: 'unsupported',
    });
    const otherKdf = { ...v.record, kdf: 'argon2id' } as unknown as KeyRecord;
    await expect(unlockWithPassword(otherKdf, PASSWORD, USER)).rejects.toBeInstanceOf(SandiError);
  });
});

describe('brankas · kunci pemulihan', () => {
  it('format: 26 karakter dalam kelompok 4, hanya alfabet Crockford', async () => {
    const v = await setup();
    expect(v.recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
  });

  it('membuka brankas dan mendekripsi item yang dibuat dengan password', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'a', item());
    const dek = await unlockWithRecoveryKey(v.record, v.recoveryKey, USER);
    expect(dek).not.toBeNull();
    expect((await decryptItem(dek!, USER, 'a', enc)).password).toBe('Zk9#mQ2$vL7!pXr4');
  });

  it('toleran: huruf kecil, spasi, tanpa tanda hubung, salah baca O/0 dan I/L/1', async () => {
    const v = await setup();
    const sloppy = v.recoveryKey.toLowerCase().replace(/-/g, ' ');
    expect(await unlockWithRecoveryKey(v.record, sloppy, USER)).not.toBeNull();
    const confusable = v.recoveryKey.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(await unlockWithRecoveryKey(v.record, confusable, USER)).not.toBeNull();
  });

  it('salah / salah format / kosong → null', async () => {
    const v = await setup();
    const other = await setup();
    expect(await unlockWithRecoveryKey(v.record, other.recoveryKey, USER)).toBeNull();
    expect(await unlockWithRecoveryKey(v.record, 'ABCD-EFGH', USER)).toBeNull();
    expect(await unlockWithRecoveryKey(v.record, '', USER)).toBeNull();
    expect(await unlockWithRecoveryKey(v.record, 'U'.repeat(26), USER)).toBeNull(); // U tidak ada di Crockford
  });

  it('encode/decode bolak-balik untuk 200 kunci acak', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const text = formatRecoveryKey(bytes);
      expect(Array.from(parseRecoveryKey(text)!)).toEqual(Array.from(bytes));
    }
  });
});

describe('brankas · ganti password & pemulihan', () => {
  it('changePassword: DEK BARU; item lama terbaca setelah dienkripsi ulang; password & pemulihan lama mati', async () => {
    const v = await setup();
    const enc0 = await encryptItem(v.dek, USER, 'a', item());

    const next = await changePassword(v.record, PASSWORD, 'password-baru-yang-panjang', USER, FAST);
    expect(next).not.toBeNull();
    const { updated, skipped } = await reencryptItems(
      [{ id: 'a', enc: enc0 }],
      next!.previousDek,
      next!.dek,
      USER,
    );
    expect(skipped).toEqual([]);
    const enc = updated[0]!.enc;

    expect(await unlockWithPassword(next!.record, PASSWORD, USER)).toBeNull(); // lama mati
    expect(await unlockWithRecoveryKey(next!.record, v.recoveryKey, USER)).toBeNull(); // pemulihan lama mati
    const dek = await unlockWithPassword(next!.record, 'password-baru-yang-panjang', USER);
    expect(dek).not.toBeNull();
    expect((await decryptItem(dek!, USER, 'a', enc)).title).toBe('GitHub');
    // DEK lama TIDAK lagi membuka data yang sudah dienkripsi ulang
    await expect(decryptItem(v.dek, USER, 'a', enc)).rejects.toBeInstanceOf(SandiError);
    // kunci pemulihan BARU berlaku
    expect(await unlockWithRecoveryKey(next!.record, next!.recoveryKey, USER)).not.toBeNull();
    expect(next!.recoveryKey).not.toBe(v.recoveryKey);
    expect(next!.record.salt).not.toBe(v.record.salt);
  });

  it('changePassword dengan password lama salah → null dan record asli tak berubah', async () => {
    const v = await setup();
    const before = JSON.stringify(v.record);
    expect(await changePassword(v.record, 'salah', 'baru-baru-baru-baru', USER, FAST)).toBeNull();
    expect(JSON.stringify(v.record)).toBe(before);
  });

  it('lupa password: kunci pemulihan + password baru → item terbaca setelah dienkripsi ulang', async () => {
    const v = await setup();
    const enc0 = await encryptItem(v.dek, USER, 'a', item());
    const next = await resetPasswordWithRecovery(
      v.record,
      v.recoveryKey,
      'master-baru-setelah-lupa',
      USER,
      FAST,
    );
    expect(next).not.toBeNull();
    const enc = (await reencryptItems([{ id: 'a', enc: enc0 }], next!.previousDek, next!.dek, USER))
      .updated[0]!.enc;
    const dek = await unlockWithPassword(next!.record, 'master-baru-setelah-lupa', USER);
    expect((await decryptItem(dek!, USER, 'a', enc)).username).toBe('rosyid');
    expect(await unlockWithRecoveryKey(next!.record, v.recoveryKey, USER)).toBeNull(); // dicabut
  });

  it('lupa password dengan kunci pemulihan salah → null', async () => {
    const v = await setup();
    const other = await setup();
    expect(
      await resetPasswordWithRecovery(
        v.record,
        other.recoveryKey,
        'baru-baru-baru-baru',
        USER,
        FAST,
      ),
    ).toBeNull();
  });

  it('rotateRecoveryKey: password tetap, kunci pemulihan lama dicabut, yang baru berlaku', async () => {
    const v = await setup();
    const next = await rotateRecoveryKey(v.record, PASSWORD, USER, FAST);
    expect(next).not.toBeNull();
    expect(await unlockWithPassword(next!.record, PASSWORD, USER)).not.toBeNull();
    expect(await unlockWithRecoveryKey(next!.record, v.recoveryKey, USER)).toBeNull();
    expect(await unlockWithRecoveryKey(next!.record, next!.recoveryKey, USER)).not.toBeNull();
    expect(await rotateRecoveryKey(v.record, 'salah', USER, FAST)).toBeNull();
  });

  // Inti temuan review #3: "dicabut" harus berarti kunci lama + salinan pw_keys LAMA tidak bisa
  // membuka data, termasuk item yang ditulis SETELAH rotasi.
  it('rotasi kunci pemulihan: kunci lama + record lama TIDAK membuka item (lama maupun baru)', async () => {
    const v = await setup();
    const enc0 = await encryptItem(v.dek, USER, 'a', item());
    const next = await rotateRecoveryKey(v.record, PASSWORD, USER, FAST);
    const { updated } = await reencryptItems(
      [{ id: 'a', enc: enc0 }],
      next!.previousDek,
      next!.dek,
      USER,
    );
    const encNew = await encryptItem(next!.dek, USER, 'b', item({ title: 'Setelah rotasi' }));

    // penyerang: kunci pemulihan LAMA + salinan record LAMA → mendapat DEK lama
    const stolen = await unlockWithRecoveryKey(v.record, v.recoveryKey, USER);
    expect(stolen).not.toBeNull(); // salinan lama memang masih bisa dibuka…
    await expect(decryptItem(stolen!, USER, 'a', updated[0]!.enc)).rejects.toBeInstanceOf(
      SandiError,
    ); // …tetapi isinya sudah tidak terbaca
    await expect(decryptItem(stolen!, USER, 'b', encNew)).rejects.toBeInstanceOf(SandiError);
  });

  it('rotasi: DEK selalu baru dan tidak sama dengan yang lama', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'a', item());
    for (const next of [
      await rotateRecoveryKey(v.record, PASSWORD, USER, FAST),
      await changePassword(v.record, PASSWORD, 'password-baru-yang-panjang', USER, FAST),
      await resetPasswordWithRecovery(
        v.record,
        v.recoveryKey,
        'master-baru-setelah-lupa',
        USER,
        FAST,
      ),
    ]) {
      await expect(decryptItem(next!.dek, USER, 'a', enc)).rejects.toBeInstanceOf(SandiError);
      expect((await decryptItem(next!.previousDek, USER, 'a', enc)).title).toBe('GitHub');
    }
  });
});

describe('item dengan kunci TOTP', () => {
  const totp = {
    secret: 'JBSWY3DPEHPK3PXP',
    digits: 6 as const,
    period: 30,
    algorithm: 'SHA1' as const,
  };

  it('kunci TOTP tersimpan utuh melewati enkripsi & dekripsi', async () => {
    const v = await setup();
    const payload = item({ title: 'GitHub', totp });
    const enc = await encryptItem(v.dek, USER, 'id-totp', payload);
    expect(await decryptItem(v.dek, USER, 'id-totp', enc)).toEqual(payload);
  });

  it('kunci TOTP tidak terbaca sebagai teks terang di ciphertext', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'id-totp', item({ totp }));
    expect(enc).not.toContain(totp.secret);
    expect(atob(enc)).not.toContain(totp.secret);
  });

  it('item TANPA sandi (hanya nama + TOTP) tetap bolak-balik utuh', async () => {
    const v = await setup();
    const payload = item({ title: 'Binance', password: '', username: '', url: '', totp });
    const enc = await encryptItem(v.dek, USER, 'x', payload);
    const back = await decryptItem(v.dek, USER, 'x', enc);
    expect(back.totp).toEqual(totp);
    expect(back.password).toBe('');
  });

  it('parameter TOTP yang aneh dinormalkan saat dibaca kembali; yang rusak jadi null', async () => {
    const v = await setup();
    // ditulis oleh versi lain / data rusak: periode mustahil & algoritma tak dikenal
    const odd = await encryptItem(v.dek, USER, 'y', {
      ...item(),
      totp: { secret: 'jbsw y3dp ehpk 3pxp', digits: 7, period: 0, algorithm: 'MD5' } as never,
    });
    const back = await decryptItem(v.dek, USER, 'y', odd);
    expect(back.totp).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      period: 5,
      algorithm: 'SHA1',
    });

    const broken = await encryptItem(v.dek, USER, 'z', {
      ...item(),
      totp: { secret: 'bukan-base32-0189' } as never,
    });
    expect((await decryptItem(v.dek, USER, 'z', broken)).totp).toBeNull();
  });

  it('kunci TOTP ikut dienkripsi ulang saat DEK dirotasi', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'a', item({ totp }));
    const next = await changePassword(v.record, PASSWORD, 'password-baru-yang-panjang', USER, FAST);
    const { updated } = await reencryptItems(
      [{ id: 'a', enc }],
      next!.previousDek,
      next!.dek,
      USER,
    );
    expect((await decryptItem(next!.dek, USER, 'a', updated[0]!.enc)).totp).toEqual(totp);
  });
});

describe('reencryptItems', () => {
  it('mengenkripsi ulang semua, mempertahankan id, dan IV baru', async () => {
    const a = await setup();
    const b = await setup();
    const rows = [
      { id: 'i1', enc: await encryptItem(a.dek, USER, 'i1', item({ title: 'Satu' })) },
      { id: 'i2', enc: await encryptItem(a.dek, USER, 'i2', item({ title: 'Dua' })) },
    ];
    const { updated, skipped } = await reencryptItems(rows, a.dek, b.dek, USER);
    expect(skipped).toEqual([]);
    expect(updated.map((r) => r.id)).toEqual(['i1', 'i2']);
    expect((await decryptItem(b.dek, USER, 'i1', updated[0]!.enc)).title).toBe('Satu');
    expect((await decryptItem(b.dek, USER, 'i2', updated[1]!.enc)).title).toBe('Dua');
    expect(updated[0]!.enc).not.toBe(rows[0]!.enc);
  });

  it('baris yang tidak bisa dibuka dilewati (tidak ditimpa) dan dilaporkan', async () => {
    const a = await setup();
    const foreign = await setup();
    const b = await setup();
    const rows = [
      { id: 'ok', enc: await encryptItem(a.dek, USER, 'ok', item()) },
      { id: 'asing', enc: await encryptItem(foreign.dek, USER, 'asing', item()) },
      { id: 'rusak', enc: 'bukan-base64!!' },
      { id: 'tertukar', enc: await encryptItem(a.dek, USER, 'lain', item()) },
    ];
    const { updated, skipped } = await reencryptItems(rows, a.dek, b.dek, USER);
    expect(updated.map((r) => r.id)).toEqual(['ok']);
    expect(skipped).toEqual(['asing', 'rusak', 'tertukar']);
  });

  it('daftar kosong → tidak ada yang diubah', async () => {
    const a = await setup();
    expect(await reencryptItems([], a.dek, a.dek, USER)).toEqual({ updated: [], skipped: [] });
  });
});

describe('item · enkripsi', () => {
  it('bolak-balik dengan Unicode, emoji, dan catatan panjang', async () => {
    const v = await setup();
    const p = item({
      title: 'Bank ✨ 銀行',
      notes: 'baris 1\nbaris 2\n' + 'x'.repeat(5000),
      password: 'p@ss"w\\ord\u0000kontrol',
      favorite: true,
    });
    const enc = await encryptItem(v.dek, USER, 'id-uni', p);
    expect(await decryptItem(v.dek, USER, 'id-uni', enc)).toEqual(p);
  });

  it('IV acak: payload sama menghasilkan ciphertext berbeda', async () => {
    const v = await setup();
    const a = await encryptItem(v.dek, USER, 'x', item());
    const b = await encryptItem(v.dek, USER, 'x', item());
    expect(a).not.toBe(b);
  });

  it('ciphertext tidak memuat isi polos', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'x', item({ password: 'RAHASIA-SANGAT-UNIK-123' }));
    expect(enc).not.toContain('RAHASIA');
    expect(atob(enc)).not.toContain('RAHASIA-SANGAT-UNIK-123');
    expect(atob(enc)).not.toContain('github');
  });

  it('padding: sandi pendek dan agak panjang di blok yang sama punya panjang ciphertext sama', async () => {
    const v = await setup();
    const a = fromB64(await encryptItem(v.dek, USER, 'x', item({ password: 'a' })));
    const b = fromB64(await encryptItem(v.dek, USER, 'x', item({ password: 'a'.repeat(60) })));
    expect(a.length).toBe(b.length);
    const c = fromB64(await encryptItem(v.dek, USER, 'x', item({ notes: 'z'.repeat(1000) })));
    expect(c.length).toBeGreaterThan(a.length);
    expect((c.length - 12 - 16) % 256).toBe(0);
  });

  it('diubah satu byte → ditolak (autentikasi GCM)', async () => {
    const v = await setup();
    const bytes = fromB64(await encryptItem(v.dek, USER, 'x', item()));
    const at = bytes.length - 20;
    bytes[at] = bytes[at]! ^ 1;
    await expect(decryptItem(v.dek, USER, 'x', toB64(bytes))).rejects.toMatchObject({
      name: 'SandiError',
      code: 'corrupt',
    });
  });

  it('ditukar ke baris lain (id item berbeda) → ditolak', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'item-A', item({ title: 'A' }));
    await expect(decryptItem(v.dek, USER, 'item-B', enc)).rejects.toBeInstanceOf(SandiError);
  });

  it('dipindah ke akun lain (user berbeda) → ditolak', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'item-A', item());
    await expect(decryptItem(v.dek, OTHER_USER, 'item-A', enc)).rejects.toBeInstanceOf(SandiError);
  });

  it('dengan kunci brankas lain → ditolak', async () => {
    const v = await setup();
    const other = await setup();
    const enc = await encryptItem(v.dek, USER, 'x', item());
    await expect(decryptItem(other.dek, USER, 'x', enc)).rejects.toBeInstanceOf(SandiError);
  });

  it('terpotong / kosong / bukan base64 → ditolak dengan SandiError, tidak melempar error lain', async () => {
    const v = await setup();
    const enc = await encryptItem(v.dek, USER, 'x', item());
    for (const bad of ['', 'AAAA', enc.slice(0, 20), '%%%bukan-base64%%%']) {
      await expect(decryptItem(v.dek, USER, 'x', bad), bad).rejects.toBeInstanceOf(SandiError);
    }
  });

  it('kunci hasil unlock tidak bisa diekspor (non-extractable)', async () => {
    const v = await setup();
    expect(v.dek.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', v.dek)).rejects.toThrow();
    const dek = await unlockWithPassword(v.record, PASSWORD, USER);
    expect(dek!.extractable).toBe(false);
  });
});

describe('parsePayload & base64', () => {
  it('field yang hilang diberi nilai bawaan; tipe salah diabaikan', () => {
    expect(parsePayload({ title: 'x', password: 5, favorite: 'ya' })).toEqual({
      title: 'x',
      totp: null,
      url: '',
      username: '',
      password: '',
      notes: '',
      favorite: false,
    });
  });

  it('bukan objek → SandiError', () => {
    for (const bad of [null, 'teks', 12, [1, 2]]) {
      expect(() => parsePayload(bad)).toThrow(SandiError);
    }
  });

  it('base64 bolak-balik untuk data besar (> 32 KB, tanpa stack overflow)', () => {
    // getRandomValues dibatasi 65.536 byte per panggilan
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 65_536)
      crypto.getRandomValues(big.subarray(i, i + 65_536));
    expect(Array.from(fromB64(toB64(big))).length).toBe(200_000);
    expect(fromB64(toB64(big))[199_999]).toBe(big[199_999]);
  });
});

describe('konfigurasi Vault · enkripsi', () => {
  const payload = { text: 'API_URL=https://api.example.com\nTOKEN=rahasia-sekali', note: 'awal' };
  const FILE = 'file-1';
  const VER = 'ver-1';

  it('bolak-balik utuh, termasuk teks mentah multi-baris dan catatan', async () => {
    const v = await setup();
    const enc = await encryptConfig(v.dek, USER, FILE, VER, payload);
    expect(await decryptConfig(v.dek, USER, FILE, VER, enc)).toEqual(payload);
  });

  it('komentar, baris kosong, dan urutan bertahan apa adanya (teks mentah = sumber kebenaran)', async () => {
    const v = await setup();
    const text = '# atas\n\nB=2\nA=1\n\n# bawah\n';
    const enc = await encryptConfig(v.dek, USER, FILE, VER, { text, note: '' });
    expect((await decryptConfig(v.dek, USER, FILE, VER, enc)).text).toBe(text);
  });

  it('ciphertext tidak memuat isi polos maupun catatannya', async () => {
    const v = await setup();
    const enc = await encryptConfig(v.dek, USER, FILE, VER, payload);
    for (const needle of ['rahasia-sekali', 'API_URL', 'api.example.com', 'awal'])
      expect(enc).not.toContain(needle);
  });

  it('padding: isi pendek dan agak panjang menghasilkan panjang ciphertext yang sama', async () => {
    const v = await setup();
    const a = await encryptConfig(v.dek, USER, FILE, VER, { text: 'A=1', note: '' });
    const b = await encryptConfig(v.dek, USER, FILE, VER, { text: 'A=1234567890', note: '' });
    expect(a.length).toBe(b.length);
  });

  it('AAD: ciphertext tidak bisa dipindah ke berkas lain, versi lain, atau akun lain', async () => {
    const v = await setup();
    const enc = await encryptConfig(v.dek, USER, FILE, VER, payload);
    await expect(decryptConfig(v.dek, USER, 'file-2', VER, enc)).rejects.toThrow(SandiError);
    await expect(decryptConfig(v.dek, USER, FILE, 'ver-2', enc)).rejects.toThrow(SandiError);
    await expect(decryptConfig(v.dek, OTHER_USER, FILE, VER, enc)).rejects.toThrow(SandiError);
  });

  it('domain terpisah: versi konfigurasi tidak bisa dibaca sebagai item Sandi, dan sebaliknya', async () => {
    const v = await setup();
    const cfg = await encryptConfig(v.dek, USER, FILE, VER, payload);
    await expect(decryptItem(v.dek, USER, VER, cfg)).rejects.toThrow(SandiError);

    const it0 = await encryptItem(v.dek, USER, VER, item());
    await expect(decryptConfig(v.dek, USER, FILE, VER, it0)).rejects.toThrow(SandiError);
  });

  it('kunci brankas lain, data diubah, atau bukan base64 → SandiError (bukan error lain)', async () => {
    const v = await setup();
    const other = await createVault('lain-lain-lain-lain', USER, FAST);
    const enc = await encryptConfig(v.dek, USER, FILE, VER, payload);

    await expect(decryptConfig(other.dek, USER, FILE, VER, enc)).rejects.toThrow(SandiError);
    const bytes = fromB64(enc);
    bytes[bytes.length - 1]! ^= 1;
    await expect(decryptConfig(v.dek, USER, FILE, VER, toB64(bytes))).rejects.toThrow(SandiError);
    for (const bad of ['', 'x', 'bukan-base64!!'])
      await expect(decryptConfig(v.dek, USER, FILE, VER, bad)).rejects.toThrow(SandiError);
  });

  it('field yang hilang diberi nilai bawaan (kompatibel ke depan)', () => {
    expect(parseConfigPayload({})).toEqual({ text: '', note: '' });
    expect(parseConfigPayload({ text: 'A=1', note: 123 })).toEqual({ text: 'A=1', note: '' });
    for (const bad of [null, 'teks', [], 42])
      expect(() => parseConfigPayload(bad)).toThrow(SandiError);
  });

  it('reencryptConfigVersions: memakai file_id masing-masing baris, melewati yang tak terbaca', async () => {
    const v = await setup();
    const next = (await rotateRecoveryKey(v.record, PASSWORD, USER, FAST))!;
    const foreign = await createVault('lain-lain-lain-lain', USER, FAST);

    const rows = [
      { id: 'v1', file_id: 'f1', enc: await encryptConfig(v.dek, USER, 'f1', 'v1', payload) },
      {
        id: 'v2',
        file_id: 'f2',
        enc: await encryptConfig(v.dek, USER, 'f2', 'v2', { text: 'B=2', note: '' }),
      },
      {
        id: 'v3',
        file_id: 'f3',
        enc: await encryptConfig(foreign.dek, USER, 'f3', 'v3', { text: 'C=3', note: '' }),
      },
    ];
    // `next.previousDek` adalah DEK lama hasil rotasi; sama dengan `v.dek` yang dipakai di atas
    const res = await reencryptConfigVersions(rows, next.previousDek, next.dek, USER);
    expect(res.skipped).toEqual(['v3']);
    expect(res.updated.map((r) => r.id)).toEqual(['v1', 'v2']);

    const byId = new Map(res.updated.map((r) => [r.id, r.enc]));
    expect(await decryptConfig(next.dek, USER, 'f1', 'v1', byId.get('v1')!)).toEqual(payload);
    expect((await decryptConfig(next.dek, USER, 'f2', 'v2', byId.get('v2')!)).text).toBe('B=2');
  });
});
