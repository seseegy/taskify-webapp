import { describe, expect, it, vi } from 'vitest';

import {
  CONVERT_TIMEOUT_MS,
  DEFAULT_AUDIO_FORMAT,
  MusicError,
  POLL_INTERVAL_MS,
  createMusicClient,
  progressLabel,
  type MusicClientDeps,
  type StreamProgress,
} from './api-client';

const BASE = 'https://music-taskify.contoh.workers.dev';

interface Call {
  path: string;
  token: string | null;
  body: Record<string, unknown>;
}

type Handler = (path: string, body: Record<string, unknown>) => Response;

/**
 * `fetch` palsu yang merekam apa yang dikirim. Memakai `Response` sungguhan (tersedia di
 * Node) supaya jalur `res.ok` / `res.json()` yang dipakai klien benar-benar ikut teruji,
 * bukan ditiru.
 */
function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({
      path: url.slice(BASE.length),
      token: auth ? auth.replace(/^Bearer /, '') : null,
      body,
    });
    if (init?.signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
    return handler(url.slice(BASE.length), body);
  });
  return { fetch: fn as unknown as typeof fetch, calls, fn };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Klien dengan token tetap dan polling yang tidak benar-benar menunggu. */
function client(handler: Handler, options: { token?: string | (() => string) } = {}) {
  const { fetch, calls, fn } = fakeFetch(handler);
  const pick = options.token ?? 'jwt-1';
  const getToken = vi.fn(async () => (typeof pick === 'function' ? pick() : pick));
  const deps: MusicClientDeps = { fetch, sleep: async () => {}, now: () => 0 };
  return { c: createMusicClient({ baseUrl: BASE, getToken }, deps), calls, getToken, fn };
}

describe('autentikasi', () => {
  it('mengirim access_token Supabase sebagai Bearer', async () => {
    const { c, calls } = client(() => json({ songs: [] }));
    await c.search('tulus');
    expect(calls[0]?.token).toBe('jwt-1');
  });

  it('mengambil token BARU setiap permintaan, bukan memakai yang pertama', async () => {
    // Inti kenapa token tidak boleh di-cache: umurnya ~1 jam dan supabase-js menggantinya
    // di tengah sesi mendengarkan. Token yang disimpan sendiri akan menghasilkan 401.
    let n = 0;
    const { c, calls, getToken } = client(() => json({ songs: [] }), {
      token: () => `jwt-${++n}`,
    });
    await c.search('a');
    await c.search('b');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(calls.map((x) => x.token)).toEqual(['jwt-1', 'jwt-2']);
  });

  it('tanpa sesi: menolak sebelum menyentuh jaringan', async () => {
    const { c, fn } = client(() => json({ songs: [] }), { token: '' });
    await expect(c.search('a')).rejects.toMatchObject({
      name: 'MusicError',
      status: 401,
      message: 'Sesi berakhir. Masuk ulang.',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('pengambilan token yang gagal juga jadi 401, bukan error mentah', async () => {
    const { fetch } = fakeFetch(() => json({}));
    const c = createMusicClient(
      {
        baseUrl: BASE,
        getToken: () => Promise.reject(new Error('storage rusak')),
      },
      { fetch, sleep: async () => {} },
    );
    await expect(c.search('a')).rejects.toBeInstanceOf(MusicError);
    await expect(c.search('a')).rejects.toMatchObject({ status: 401 });
  });
});

describe('bentuk permintaan', () => {
  it('pencarian tanpa filter tidak mengirim field filter sama sekali', async () => {
    const { c, calls } = client(() => json({ songs: [] }));
    await c.search('tulus monokrom');
    expect(calls[0]?.path).toBe('/v1/search');
    expect(calls[0]?.body).toEqual({ q: 'tulus monokrom' });
  });

  it('pencarian dengan filter mengirimkannya', async () => {
    const { c, calls } = client(() => json({ songs: [] }));
    await c.search('tulus', 'songs');
    expect(calls[0]?.body).toEqual({ q: 'tulus', filter: 'songs' });
  });

  it('halaman berikutnya dikirim HANYA dengan cursor', async () => {
    // Menyertakan `q` sekaligus ditolak Worker dengan 400.
    const { c, calls } = client(() => json({ songs: [] }));
    await c.searchMore('kursor-buram');
    expect(calls[0]?.body).toEqual({ cursor: 'kursor-buram' });
  });

  it('garis miring di akhir baseUrl tidak membuat URL berisi //', async () => {
    const { fetch, calls } = fakeFetch(() => json({ songs: [] }));
    const c = createMusicClient(
      { baseUrl: `${BASE}///`, getToken: async () => 'jwt-1' },
      { fetch },
    );
    await c.search('a');
    expect(calls[0]?.path).toBe('/v1/search');
  });

  it('track mengirim videoId', async () => {
    const { c, calls } = client(() => json({ videoId: 'x', lyricsId: '', upNext: [] }));
    await c.track('1RrF6Ee_io0');
    expect(calls[0]).toMatchObject({ path: '/v1/track', body: { videoId: '1RrF6Ee_io0' } });
  });
});

describe('hasil pencarian', () => {
  it('tanpa cursor di respons = halaman terakhir', async () => {
    const { c } = client(() => json({ songs: [] }));
    expect((await c.search('a')).cursor).toBeUndefined();
  });

  it('cursor diteruskan apa adanya saat masih ada lanjutan', async () => {
    const { c } = client(() => json({ songs: [], cursor: 'eyJrIjoic2Vhcm' }));
    expect((await c.search('a')).cursor).toBe('eyJrIjoic2Vhcm');
  });
});

describe('pesan error', () => {
  const message = async (res: Response) => {
    const { c } = client(() => res);
    return await c.search('a').then(
      () => '(tidak melempar)',
      (e: unknown) => (e as Error).message,
    );
  };

  it('memakai pesan dari Worker apa adanya — sudah berbahasa Indonesia', async () => {
    expect(await message(json({ error: 'Parameter "q" wajib diisi' }, 400))).toBe(
      'Parameter "q" wajib diisi',
    );
  });

  it('401 tanpa body JSON tetap memberi arahan yang bisa ditindaklanjuti', async () => {
    expect(await message(new Response('bukan json', { status: 401 }))).toBe(
      'Sesi berakhir. Masuk ulang.',
    );
  });

  it('403 dijelaskan sebagai akun tidak diizinkan, bukan "masuk ulang"', async () => {
    // Bedanya penting: 401 berarti masuk ulang, 403 berarti akun ini memang tidak boleh.
    // Menyamakan keduanya membuat pesannya tidak bisa membantu.
    expect(await message(new Response('', { status: 403 }))).toBe(
      'Akun ini tidak diizinkan memakai pemutar musik.',
    );
  });

  it('5xx disebut masalah server, bukan kesalahan pengguna', async () => {
    expect(await message(new Response('', { status: 502 }))).toBe(
      'Server musik sedang bermasalah. Coba lagi sebentar.',
    );
  });

  it('status lain tetap menyebut angkanya supaya bisa dilaporkan', async () => {
    expect(await message(new Response('', { status: 418 }))).toBe('Server musik balas HTTP 418.');
  });

  it('status ikut dibawa di error, bukan hanya pesannya', async () => {
    const { c } = client(() => json({ error: 'x' }, 429));
    await expect(c.search('a')).rejects.toMatchObject({ status: 429 });
  });

  it('jaringan mati jadi pesan tentang koneksi', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const c = createMusicClient({ baseUrl: BASE, getToken: async () => 'jwt-1' }, { fetch });
    await expect(c.search('a')).rejects.toMatchObject({
      message: 'Tidak bisa menghubungi server musik. Periksa koneksi.',
      status: 0,
    });
  });
});

describe('lirik', () => {
  it('mengembalikan teksnya saja', async () => {
    const { c, calls } = client(() => json({ text: 'Lembaran foto hitam putih' }));
    expect(await c.lyrics('MPLYt_4TEBtGA3cZb-10')).toBe('Lembaran foto hitam putih');
    expect(calls[0]).toMatchObject({
      path: '/v1/lyrics',
      body: { lyricsId: 'MPLYt_4TEBtGA3cZb-10' },
    });
  });

  it('teks kosong bukan error — lagu instrumental memang tanpa lirik', async () => {
    const { c } = client(() => json({ text: '' }));
    expect(await c.lyrics('MPLY1')).toBe('');
  });
});

describe('menyiapkan audio', () => {
  /** Pencatat laporan progres, untuk memastikan angkanya tidak pernah mundur. */
  const recorder = () => {
    const seen: number[] = [];
    return { seen, onProgress: (p: StreamProgress) => seen.push(p.percent) };
  };

  it('init yang langsung memberi url tidak di-polling sama sekali', async () => {
    // Konverter kadang sudah punya hasilnya di cache. Dua bentuk balasan, keduanya sah.
    const { c, calls } = client(() => json({ url: 'https://ricky4.savenow.to/a.m4a' }));
    expect(await c.resolveStream('1RrF6Ee_io0')).toBe('https://ricky4.savenow.to/a.m4a');
    expect(calls.map((x) => x.path)).toEqual(['/v1/stream/init']);
  });

  it('init yang memberi job di-polling sampai url muncul', async () => {
    let poll = 0;
    const { c, calls } = client((path) => {
      if (path === '/v1/stream/init') return json({ job: 'tugas-1' });
      poll += 1;
      return poll < 3
        ? json({ progress: poll * 20, text: 'Downloading' })
        : json({ progress: 100, url: 'https://ricky4.savenow.to/b.m4a' });
    });
    expect(await c.resolveStream('1RrF6Ee_io0')).toBe('https://ricky4.savenow.to/b.m4a');
    expect(calls.filter((x) => x.path === '/v1/stream/poll')).toHaveLength(3);
    expect(calls[1]?.body).toEqual({ job: 'tugas-1' });
  });

  it('progress 100 TANPA url belum berarti siap', async () => {
    // Penanda selesai adalah ADANYA url. Mengandalkan progress == 100 akan memasang
    // src kosong ke <audio> dan terlihat seperti lagu yang gagal diputar.
    let poll = 0;
    const { c } = client((path) => {
      if (path === '/v1/stream/init') return json({ job: 'tugas-1' });
      poll += 1;
      return poll < 4 ? json({ progress: 100 }) : json({ url: 'https://ricky4.savenow.to/c.m4a' });
    });
    expect(await c.resolveStream('x')).toBe('https://ricky4.savenow.to/c.m4a');
    expect(poll).toBe(4);
  });

  it('progres yang mundur tidak dilaporkan — bilahnya tidak boleh berjalan ke belakang', async () => {
    const { seen, onProgress } = recorder();
    const urutan = [30, 10, 45, 20, 90];
    let poll = 0;
    const { c } = client((path) => {
      if (path === '/v1/stream/init') return json({ job: 'tugas-1' });
      const p = urutan[poll++];
      return p === undefined ? json({ url: 'https://x/d.m4a' }) : json({ progress: p });
    });
    await c.resolveStream('x', { onProgress });
    // 10 dan 20 dibuang karena lebih kecil dari yang pernah dilihat.
    expect(seen).toEqual([0, 30, 45, 90, 100]);
    // Dan urutannya memang tidak menurun.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('melaporkan 0 lebih dulu supaya judul lagu bisa tampil seketika', async () => {
    const { seen, onProgress } = recorder();
    const { c } = client(() => json({ url: 'https://x/e.m4a' }));
    await c.resolveStream('x', { onProgress });
    expect(seen[0]).toBe(0);
  });

  it('format SELALU dikirim — bawaan Worker (m4a) tidak bisa diputar', async () => {
    /*
     * Ini bukan sekadar kerapian. Kalau `format` dibiarkan kosong, Worker memakai
     * bawaannya `m4a`, dan m4a dari konverter adalah fragmented MP4 dengan `moof`
     * berukuran 0 — Chrome menolaknya dengan MEDIA_ERR_SRC_NOT_SUPPORTED setelah
     * berkasnya terunduh penuh dengan 200 OK. Jadi mengandalkan bawaan sisi server
     * berarti diam-diam memilih format yang rusak.
     */
    const { c, calls } = client(() => json({ url: 'https://x/f.mp3' }));
    await c.resolveStream('x');
    expect(calls[0]?.body).toEqual({ videoId: 'x', format: DEFAULT_AUDIO_FORMAT });
    expect(DEFAULT_AUDIO_FORMAT).toBe('mp3');
  });

  it('format yang diminta pemanggil menang atas bawaan', async () => {
    const { c, calls } = client(() => json({ url: 'https://x/f.webm' }));
    await c.resolveStream('x', { format: 'webm' });
    expect(calls[0]?.body).toEqual({ videoId: 'x', format: 'webm' });
  });

  it('balasan tanpa url dan tanpa job diberi pesan, bukan menggantung', async () => {
    const { c } = client(() => json({}));
    await expect(c.resolveStream('x')).rejects.toMatchObject({
      message: 'Server musik tidak memberi tugas konversi.',
    });
  });

  it('menyerah setelah batas waktu, bukan polling selamanya', async () => {
    let clock = 0;
    const { fetch } = fakeFetch((path) =>
      path === '/v1/stream/init' ? json({ job: 'tugas-1' }) : json({ progress: 10 }),
    );
    const c = createMusicClient(
      { baseUrl: BASE, getToken: async () => 'jwt-1' },
      {
        fetch,
        now: () => clock,
        sleep: async () => {
          clock += POLL_INTERVAL_MS;
        },
      },
    );
    await expect(c.resolveStream('x')).rejects.toMatchObject({
      message: 'Menyiapkan audio terlalu lama. Coba lagu lain.',
    });
    expect(clock).toBeGreaterThanOrEqual(CONVERT_TIMEOUT_MS);
  });

  it('pembatalan dilempar sebagai AbortError, bukan dibungkus MusicError', async () => {
    // Pemutar membedakan keduanya: pembatalan diabaikan, MusicError ditampilkan.
    const ctrl = new AbortController();
    const { fetch } = fakeFetch((path) =>
      path === '/v1/stream/init' ? json({ job: 'tugas-1' }) : json({ progress: 10 }),
    );
    const c = createMusicClient(
      { baseUrl: BASE, getToken: async () => 'jwt-1' },
      {
        fetch,
        sleep: async () => {
          ctrl.abort();
        },
      },
    );
    await expect(c.resolveStream('x', { signal: ctrl.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('kalimat progres', () => {
  it('0 atau kurang: belum ada angka yang berarti', () => {
    expect(progressLabel(0)).toBe('Menghubungi server…');
    expect(progressLabel(-5)).toBe('Menghubungi server…');
  });

  it('di tengah: menyebut angkanya, karena angka yang bergerak = tanda hidup', () => {
    expect(progressLabel(45)).toBe('Menyiapkan audio… 45%');
  });

  it('mendekati akhir: tidak menjanjikan 100% yang belum tentu segera', () => {
    expect(progressLabel(90)).toBe('Hampir siap…');
    expect(progressLabel(100)).toBe('Hampir siap…');
  });
});
