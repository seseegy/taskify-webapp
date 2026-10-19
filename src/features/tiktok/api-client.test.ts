import { describe, expect, it } from 'vitest';
import {
  createTikTokClient,
  fileNameFromDisposition,
  isStaleLink,
  readWithProgress,
  TikTokError,
} from './api-client';

const BASE = 'https://ttdl.contoh.workers.dev';

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

describe('fileNameFromDisposition', () => {
  it('filename* didahulukan, lalu filename', () => {
    expect(
      fileNameFromDisposition(
        `attachment; filename="a_1.mp4"; filename*=UTF-8''kre%C3%A1tor_1.mp4`,
        'x',
      ),
    ).toBe('kreátor_1.mp4');
    expect(fileNameFromDisposition('attachment; filename="a_1.mp4"', 'x')).toBe('a_1.mp4');
    expect(fileNameFromDisposition('attachment; filename=b.jpg', 'x')).toBe('b.jpg');
  });

  it('tanpa header / nama berbahaya', () => {
    expect(fileNameFromDisposition(null, 'cadangan.mp4')).toBe('cadangan.mp4');
    expect(fileNameFromDisposition('attachment', 'cadangan.mp4')).toBe('cadangan.mp4');
    expect(fileNameFromDisposition('attachment; filename="../../etc/x.mp4"', 'c')).toBe(
      '.._.._etc_x.mp4',
    );
    expect(fileNameFromDisposition(`attachment; filename*=UTF-8''a%2Fb%0A.mp4`, 'c')).toBe(
      'a_b.mp4',
    );
  });
});

describe('readWithProgress', () => {
  it('melaporkan progres dari Content-Length', async () => {
    const res = new Response(new Uint8Array(10), {
      headers: { 'Content-Length': '10', 'Content-Type': 'video/mp4' },
    });
    const seen: (number | null)[] = [];
    const blob = await readWithProgress(res, (f) => seen.push(f));
    expect(blob.size).toBe(10);
    expect(blob.type).toBe('video/mp4');
    expect(seen.at(-1)).toBe(1);
  });

  it('ukuran tidak diketahui → null', async () => {
    const seen: (number | null)[] = [];
    await readWithProgress(new Response('abc'), (f) => seen.push(f));
    expect(seen).toEqual([null]);
  });
});

describe('createTikTokClient', () => {
  it('extract: POST JSON tanpa kredensial', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ data: { id: '1' } }));
    const post = await createTikTokClient(`${BASE}/`, fn).extract('https://vt.tiktok.com/ZS/');
    expect(post.id).toBe('1');
    expect(calls[0]!.url).toBe(`${BASE}/v1/extract`);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.credentials).toBe('omit');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ url: 'https://vt.tiktok.com/ZS/' });
  });

  it('error Worker diteruskan apa adanya (pesan berbahasa Indonesia + kode)', async () => {
    const { fn } = fakeFetch(() =>
      Response.json({ error: { code: 'PRIVATE', message: 'Konten ini privat.' } }, { status: 403 }),
    );
    await expect(createTikTokClient(BASE, fn).extract('x')).rejects.toMatchObject({
      code: 'PRIVATE',
      message: 'Konten ini privat.',
      status: 403,
    });
  });

  it('origin ditolak → pesan yang menunjuk ke konfigurasi Worker', async () => {
    const { fn } = fakeFetch(() =>
      Response.json(
        { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin tidak diizinkan.' } },
        { status: 403 },
      ),
    );
    await expect(createTikTokClient(BASE, fn).extract('x')).rejects.toThrow(/ALLOWED_ORIGINS/);
  });

  it('jaringan putus → NETWORK; bukan JSON → pesan umum', async () => {
    const offline = createTikTokClient(BASE, (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await expect(offline.extract('x')).rejects.toMatchObject({ code: 'NETWORK' });

    const { fn } = fakeFetch(() => new Response('<html>502</html>', { status: 502 }));
    await expect(createTikTokClient(BASE, fn).extract('x')).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Server TikTok membalas HTTP 502.',
    });
  });

  it('download: nama file dari Content-Disposition', async () => {
    const { fn } = fakeFetch(
      () =>
        new Response('isi', {
          headers: {
            'Content-Disposition': 'attachment; filename="k_1.mp4"',
            'Content-Type': 'video/mp4',
          },
        }),
    );
    const file = await createTikTokClient(BASE, fn).download(
      `${BASE}/v1/media?t=a.b`,
      'cadangan.mp4',
    );
    expect(file.fileName).toBe('k_1.mp4');
    expect(await file.blob.text()).toBe('isi');
  });
});

describe('isStaleLink', () => {
  it('kedaluwarsa / ditolak CDN → perlu ekstrak ulang', () => {
    expect(isStaleLink(new TikTokError('', 'TOKEN_EXPIRED'))).toBe(true);
    expect(isStaleLink(new TikTokError('', 'UPSTREAM'))).toBe(true);
    expect(isStaleLink(new TikTokError('', 'NETWORK'))).toBe(false);
    expect(isStaleLink(new Error('x'))).toBe(false);
  });
});
