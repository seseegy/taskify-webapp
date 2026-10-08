import { describe, expect, it } from 'vitest';
import { avatarGradient, avatarInitial } from './avatar';
import { displayHost, safeUrl } from './url';

describe('safeUrl', () => {
  it('menerima http(s) dan menambah https:// bila tanpa skema', () => {
    expect(safeUrl('https://github.com/login')).toBe('https://github.com/login');
    expect(safeUrl('github.com/login')).toBe('https://github.com/login');
    expect(safeUrl('  http://router.local.lan  ')).toBe('http://router.local.lan/');
    expect(safeUrl('localhost:3000')).toBeNull(); // "localhost:" terbaca sebagai skema → ditolak
    expect(safeUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('MENOLAK skema berbahaya (XSS lewat href) dan skema non-web', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://x.com',
      'chrome://settings',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });

  it('menolak teks yang jelas bukan URL', () => {
    for (const bad of ['', '   ', 'bukan url', 'abc', '<b>x</b>', 'a"b.com', "x'y.com"]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });

  it('displayHost: host ringkas tanpa www; teks asli bila bukan URL', () => {
    expect(displayHost('https://www.github.com/login?x=1')).toBe('github.com');
    expect(displayHost('Kartu kredit BCA')).toBe('Kartu kredit BCA');
  });
});

describe('avatar', () => {
  it('warna deterministik dan tidak peka huruf besar/kecil', () => {
    expect(avatarGradient('GitHub')).toBe(avatarGradient('github'));
    expect(avatarGradient('GitHub')).toMatch(/^from-/);
  });

  it('beragam: judul berbeda tidak semuanya jatuh ke satu warna', () => {
    const set = new Set(
      ['GitHub', 'Google', 'Netflix', 'Bank BCA', 'Tokopedia', 'Spotify', 'Shopee', 'Dropbox'].map(
        avatarGradient,
      ),
    );
    expect(set.size).toBeGreaterThanOrEqual(3);
  });

  it('inisial: huruf/angka pertama kapital, lewati simbol, "?" bila kosong', () => {
    expect(avatarInitial('github')).toBe('G');
    expect(avatarInitial('  🔒 bank')).toBe('B');
    expect(avatarInitial('123 abc')).toBe('1');
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('!!!')).toBe('?');
  });
});
