import { describe, expect, it } from 'vitest';
import {
  ROTATION_BLOCKER_MESSAGE,
  RotationBlockedError,
  RotationRejectedError,
  rotationBlocker,
  rotationOutcome,
  rotationRejectedMessage,
  VAULT_ERROR,
  type RotationProbe,
} from './vault-rotation';

const LOCAL = 'wrapped-lokal';

const probe = (over: Partial<RotationProbe> = {}): RotationProbe => ({
  online: true,
  connected: true,
  hasSynced: true,
  downloading: false,
  pendingUploads: async () => 0,
  remoteWrappedKey: async () => LOCAL,
  ...over,
});

describe('rotationBlocker (prasyarat sebelum ganti kunci)', () => {
  it('semua terpenuhi → boleh', async () => {
    expect(await rotationBlocker(probe(), LOCAL)).toBeNull();
  });

  it.each<[string, Partial<RotationProbe>]>([
    ['offline', { online: false }],
    ['offline', { connected: false }],
    ['not-synced', { hasSynced: false }],
    ['downloading', { downloading: true }],
    ['pending-uploads', { pendingUploads: async () => 3 }],
    ['unreachable', { remoteWrappedKey: async () => 'unreachable' }],
    ['key-changed', { remoteWrappedKey: async () => 'kunci-perangkat-lain' }],
    ['key-changed', { remoteWrappedKey: async () => null }],
  ])('%s', async (expected, over) => {
    expect(await rotationBlocker(probe(over), LOCAL)).toBe(expected);
  });

  it('pemeriksaan murah dulu: offline tidak memanggil server', async () => {
    let asked = false;
    const res = await rotationBlocker(
      probe({
        online: false,
        remoteWrappedKey: async () => {
          asked = true;
          return LOCAL;
        },
      }),
      LOCAL,
    );
    expect(res).toBe('offline');
    expect(asked).toBe(false);
  });

  it('setiap alasan punya pesan, dan error-nya membawa pesan itu', () => {
    for (const [k, msg] of Object.entries(ROTATION_BLOCKER_MESSAGE)) {
      expect(msg.length, k).toBeGreaterThan(20);
      expect(new RotationBlockedError(k as keyof typeof ROTATION_BLOCKER_MESSAGE).message).toBe(
        msg,
      );
    }
  });
});

describe('rotationOutcome (menunggu jawaban server)', () => {
  const fast = { timeoutMs: 50, pollMs: 5 };

  it('antrean kosong tanpa penolakan → diterima', async () => {
    let n = 0;
    const res = await rotationOutcome(
      { pending: async () => ++n < 3, rejected: async () => undefined },
      fast,
    );
    expect(res).toEqual({ kind: 'accepted' });
  });

  it('penolakan tercatat → ditolak dengan kodenya', async () => {
    const res = await rotationOutcome(
      { pending: async () => true, rejected: async () => VAULT_ERROR.keyChanged },
      fast,
    );
    expect(res).toEqual({ kind: 'rejected', code: '23V01' });
  });

  it('ditolak TEPAT saat antrean kosong (catatan baru ditulis) → tetap dianggap ditolak', async () => {
    let checks = 0;
    const res = await rotationOutcome(
      {
        pending: async () => false,
        rejected: async () => (++checks >= 2 ? VAULT_ERROR.incomplete : undefined),
      },
      fast,
    );
    expect(res).toEqual({ kind: 'rejected', code: '23V02' });
  });

  it('tidak ada jawaban sampai batas waktu → belum pasti (bukan "diterima")', async () => {
    const res = await rotationOutcome(
      { pending: async () => true, rejected: async () => undefined },
      fast,
    );
    expect(res).toEqual({ kind: 'unconfirmed' });
  });
});

describe('pesan penolakan', () => {
  it('setiap kode punya pesan spesifik; semuanya menyebut bahwa server tidak berubah', () => {
    const codes = [
      VAULT_ERROR.keyChanged,
      VAULT_ERROR.incomplete,
      VAULT_ERROR.tooLarge,
      null,
      'X1',
    ];
    const msgs = codes.map(rotationRejectedMessage);
    expect(new Set(msgs).size).toBe(msgs.length);
    for (const m of msgs) expect(m).toMatch(/Tidak ada yang berubah di server/);
    expect(new RotationRejectedError('23V01')).toMatchObject({ code: '23V01', message: msgs[0] });
  });
});
