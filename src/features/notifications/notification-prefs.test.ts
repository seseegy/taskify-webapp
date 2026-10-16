import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_PREFS_KEY, parseNotificationPrefs, PREFS_CACHE } from './notification-prefs';

describe('preferensi notifikasi', () => {
  it('nilai rusak/kosong → bawaan (isi notifikasi tampil)', () => {
    expect(parseNotificationPrefs(null)).toEqual({ hideContent: false });
    expect(parseNotificationPrefs({ hideContent: 'ya' })).toEqual({ hideContent: false });
    expect(parseNotificationPrefs({ hideContent: true })).toEqual({ hideContent: true });
  });

  it('service worker membaca cache & key yang sama', () => {
    const sw = readFileSync(new URL('../../../public/sw-extra.js', import.meta.url), 'utf8');
    expect(sw).toContain(`'${PREFS_CACHE}'`);
    expect(sw).toContain(`'${NOTIFICATION_PREFS_KEY}'`);
  });
});
