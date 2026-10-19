import { describe, expect, it } from 'vitest';
import { findTikTokLink } from './tiktok-link';

describe('findTikTokLink', () => {
  it('teks dari menu Bagikan aplikasi TikTok', () => {
    expect(
      findTikTokLink(
        'Lihat video @kreator di TikTok! #fyp https://vt.tiktok.com/ZSabc123/ Dibagikan',
      ),
    ).toBe('https://vt.tiktok.com/ZSabc123/');
  });

  it('link postingan video & foto, dengan atau tanpa https://', () => {
    expect(findTikTokLink('https://www.tiktok.com/@si.a/video/7123456789012345678?lang=id')).toBe(
      'https://www.tiktok.com/@si.a/video/7123456789012345678?lang=id',
    );
    expect(findTikTokLink('www.tiktok.com/@b/photo/7123456789012345679.')).toBe(
      'https://www.tiktok.com/@b/photo/7123456789012345679',
    );
    expect(findTikTokLink('https://www.tiktok.com/t/ZTxyz/')).toBe(
      'https://www.tiktok.com/t/ZTxyz/',
    );
    expect(findTikTokLink('vm.tiktok.com/ZMabc/')).toBe('https://vm.tiktok.com/ZMabc/');
  });

  it('bukan postingan atau bukan TikTok → null', () => {
    expect(findTikTokLink('https://www.tiktok.com/@kreator')).toBeNull();
    expect(findTikTokLink('https://www.tiktok.com/tag/fyp')).toBeNull();
    expect(findTikTokLink('https://vt.tiktok.com/')).toBeNull();
    expect(findTikTokLink('https://tiktok.com.evil.io/@a/video/7123456789012345678')).toBeNull();
    expect(findTikTokLink('https://youtube.com/watch?v=x')).toBeNull();
    expect(findTikTokLink('beli susu besok')).toBeNull();
    expect(findTikTokLink('')).toBeNull();
  });
});
