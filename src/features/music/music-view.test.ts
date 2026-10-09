import { describe, expect, it } from 'vitest';

import {
  barAnnouncement,
  barControls,
  barStatus,
  elapsedPercent,
  formatClock,
  formatDuration,
  parseDuration,
  type BarStatusInput,
} from './music-view';

describe('durasi dari API', () => {
  it('pemisah TITIK berarti menit dan detik, bukan pecahan', () => {
    // Inti jebakannya: dengan hl=id hulu mengirim "6.38" untuk 6 menit 38 detik.
    expect(parseDuration('6.38')).toBe(6 * 60 + 38);
    // parseFloat akan memberi 6,38 — jauh berbeda.
    expect(parseDuration('6.38')).not.toBe(Math.round(parseFloat('6.38')));
  });

  it('pemisah titik dua juga diterima, karena bentuknya bisa berubah', () => {
    expect(parseDuration('6:38')).toBe(398);
    expect(parseDuration('3:05')).toBe(185);
  });

  it('tiga bagian dibaca sebagai jam:menit:detik', () => {
    expect(parseDuration('1.02.30')).toBe(3600 + 2 * 60 + 30);
    expect(parseDuration('1:02:30')).toBe(3750);
  });

  it('detik harus tepat dua angka — "3.5" bukan durasi', () => {
    expect(parseDuration('3.5')).toBeNull();
    expect(parseDuration('3.500')).toBeNull();
  });

  it('string kosong dan yang bukan durasi: null, bukan nol', () => {
    // Bedanya penting: nol akan ditampilkan sebagai "0:00" seolah lagunya tidak berdurasi.
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('Live')).toBeNull();
    expect(parseDuration('—')).toBeNull();
  });

  it('spasi di ujung tidak membuang durasinya', () => {
    expect(parseDuration(' 3.05 ')).toBe(185);
  });
});

describe('detik jadi teks jam', () => {
  it('menit:detik dengan detik selalu dua angka', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(398)).toBe('6:38');
  });

  it('lewat sejam memakai tiga bagian', () => {
    expect(formatClock(3750)).toBe('1:02:30');
  });

  it('nilai mustahil dijepit, tidak menghasilkan "NaN:aN"', () => {
    expect(formatClock(-10)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('detik pecahan dibulatkan ke bawah, jadi tidak pernah menampilkan durasi melebihi lagunya', () => {
    expect(formatClock(59.9)).toBe('0:59');
  });
});

describe('satu bentuk durasi untuk seluruh UI', () => {
  it('titik dari API jadi titik dua di layar', () => {
    // Supaya daftar hasil tidak menulis "3.38" sementara bilah pemutar menulis "3:38".
    expect(formatDuration('3.38')).toBe('3:38');
    expect(formatDuration('3:38')).toBe('3:38');
  });

  it('yang tidak dikenali jadi string kosong, bukan angka tebakan', () => {
    expect(formatDuration('')).toBe('');
    expect(formatDuration('Live')).toBe('');
  });
});

describe('baris status di bilah', () => {
  const base: BarStatusInput = {
    status: 'playing',
    label: '',
    error: '',
    awaitingMore: false,
    online: true,
    artist: 'Tulus',
    position: 3,
    total: 16,
  };
  const at = (patch: Partial<BarStatusInput>) => barStatus({ ...base, ...patch });

  it('sedang berbunyi: artis dan posisi antrean', () => {
    expect(at({})).toBe('Tulus · 3/16');
  });

  it('antrean satu lagu tidak menulis "1/1"', () => {
    expect(at({ position: 1, total: 1 })).toBe('Tulus');
  });

  it('tanpa artis: tidak menyisakan pemisah menggantung', () => {
    expect(at({ artist: '', total: 1 })).toBe('');
    expect(at({ artist: '' })).toBe('3/16');
  });

  it('dijeda tetap menampilkan artis — ikonnya yang berubah, bukan kalimatnya', () => {
    expect(at({ status: 'paused' })).toBe('Tulus · 3/16');
  });

  it('menyiapkan: kalimat berangka dari klien', () => {
    expect(at({ status: 'preparing', label: 'Menyiapkan audio… 45%' })).toBe(
      'Menyiapkan audio… 45%',
    );
  });

  it('menyiapkan tanpa kalimat: tetap ada keterangan, bukan kosong', () => {
    expect(at({ status: 'preparing', label: '' })).toBe('Menyiapkan audio…');
  });

  it('kosong: mengatakan apa yang bisa dilakukan, bukan mengulangi judulnya', () => {
    // Judul di bilah sudah menulis "Musik" saat antrean kosong.
    expect(at({ status: 'idle' })).toBe('Cari lagu untuk diputar');
  });

  it('menunggu lagu lanjutan dibedakan dari dijeda', () => {
    expect(at({ status: 'paused', awaitingMore: true })).toBe('Mencari lagu lanjutan…');
  });

  it('error memakai pesan dari Worker apa adanya', () => {
    expect(at({ status: 'error', error: 'Kuota konverter habis.' })).toBe('Kuota konverter habis.');
  });

  it('error tanpa pesan tetap mengatakan sesuatu', () => {
    expect(at({ status: 'error', error: '' })).toBe('Gagal memuat audio.');
  });

  it('error lebih spesifik daripada "Tidak ada koneksi", jadi error yang menang', () => {
    // Pesan dari klien sudah menyebut koneksi bila itu memang penyebabnya.
    expect(
      at({
        status: 'error',
        error: 'Tidak bisa menghubungi server musik. Periksa koneksi.',
        online: false,
      }),
    ).toBe('Tidak bisa menghubungi server musik. Periksa koneksi.');
  });

  it('offline disebut hanya saat keadaannya memang butuh jaringan', () => {
    expect(at({ status: 'preparing', label: 'Menyiapkan audio… 45%', online: false })).toBe(
      'Tidak ada koneksi',
    );
    expect(at({ status: 'paused', awaitingMore: true, online: false })).toBe('Tidak ada koneksi');
    expect(at({ status: 'idle', online: false })).toBe('Tidak ada koneksi');
  });

  it('offline TIDAK disebut saat musik sedang berbunyi', () => {
    // Audionya sudah ada di peramban; mengabarkan koneksi mati hanya kebisingan.
    expect(at({ status: 'playing', online: false })).toBe('Tulus · 3/16');
    expect(at({ status: 'paused', online: false })).toBe('Tulus · 3/16');
  });
});

describe('pengumuman untuk pembaca layar', () => {
  const at = (patch: Partial<Parameters<typeof barAnnouncement>[0]>) =>
    barAnnouncement({
      status: 'playing',
      error: '',
      awaitingMore: false,
      title: 'Monokrom',
      ...patch,
    });

  it('tidak mengumumkan apa pun saat lagu berganti biasa', () => {
    // Kalau tidak, pembaca layar membacakan tiap lagu baru di tengah pekerjaan pengguna.
    expect(at({ status: 'playing' })).toBe('');
    expect(at({ status: 'paused' })).toBe('');
    expect(at({ status: 'idle' })).toBe('');
  });

  it('mengumumkan saat ada yang perlu ditunggu', () => {
    expect(at({ status: 'preparing' })).toBe('Menyiapkan audio untuk Monokrom.');
    expect(at({ status: 'paused', awaitingMore: true })).toBe('Mencari lagu lanjutan.');
  });

  it('pengumuman TANPA angka, supaya tidak mengoceh tiap polling', () => {
    // Angkanya tetap terlihat di bilah progres; yang diumumkan kalimat yang tetap.
    expect(at({ status: 'preparing' })).not.toMatch(/\d/);
  });

  it('judul yang belum ada tidak menghasilkan kalimat menggantung', () => {
    expect(at({ status: 'preparing', title: '' })).toBe('Menyiapkan audio.');
  });

  it('error diumumkan, karena perlu ditindaklanjuti', () => {
    expect(at({ status: 'error', error: 'Kuota konverter habis.' })).toBe('Kuota konverter habis.');
  });
});

describe('kontrol yang aktif', () => {
  const at = (patch: Partial<Parameters<typeof barControls>[0]>) =>
    barControls({
      status: 'playing',
      online: true,
      hasUrl: true,
      hasNext: true,
      hasPrev: true,
      ...patch,
    });

  it('antrean kosong: tidak ada yang bisa ditekan', () => {
    expect(at({ status: 'idle', hasNext: false, hasPrev: false })).toEqual({
      canPlay: false,
      canNext: false,
      canPrev: false,
    });
  });

  it('pindah lagu dinonaktifkan saat offline — konversi butuh jaringan', () => {
    // Lebih jujur daripada tombol yang bisa ditekan lalu gagal.
    expect(at({ online: false })).toMatchObject({ canNext: false, canPrev: false });
  });

  it('putar/jeda tetap aktif saat offline kalau audionya sudah ada', () => {
    expect(at({ online: false, hasUrl: true }).canPlay).toBe(true);
  });

  it('putar dinonaktifkan saat offline dan audionya belum ada', () => {
    expect(at({ status: 'preparing', online: false, hasUrl: false }).canPlay).toBe(false);
  });

  it('ujung antrean: tombolnya mati, bukan menekan tanpa efek', () => {
    expect(at({ hasPrev: false }).canPrev).toBe(false);
    expect(at({ hasNext: false }).canNext).toBe(false);
  });

  it('keadaan error masih bisa ditekan untuk mencoba lagi', () => {
    expect(at({ status: 'error', hasUrl: false }).canPlay).toBe(true);
  });
});

describe('garis posisi lagu', () => {
  it('bagian yang sudah berjalan dihitung dari durasi lagu, bukan dari elemen audio', () => {
    // el.duration tidak bisa dipakai: respons konverter tanpa Content-Length.
    expect(elapsedPercent(99.5, 199)).toBeCloseTo(50);
  });

  it('dijepit 0–100, jadi tidak pernah meluber melewati bilahnya', () => {
    expect(elapsedPercent(500, 199)).toBe(100);
    expect(elapsedPercent(-5, 199)).toBe(0);
  });

  it('durasi tidak diketahui: nol, bukan NaN yang jadi width:NaN%', () => {
    expect(elapsedPercent(30, 0)).toBe(0);
    expect(elapsedPercent(30, Number.NaN)).toBe(0);
    expect(elapsedPercent(Number.NaN, 199)).toBe(0);
  });
});
