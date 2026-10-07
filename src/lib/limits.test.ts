import { describe, expect, it } from 'vitest';
import { clip, LIMITS } from './limits';

describe('clip', () => {
  it('tidak mengubah teks yang cukup pendek', () => {
    expect(clip('halo', 10)).toBe('halo');
    expect(clip('x'.repeat(120), LIMITS.transactionTitle)).toHaveLength(120);
  });

  it('memotong ke batas', () => {
    expect(clip('x'.repeat(500), LIMITS.taskTitle)).toHaveLength(300);
  });

  it('menghitung karakter seperti char_length Postgres (emoji = 1), bukan unit UTF-16', () => {
    const emoji = '😀'.repeat(150); // 150 karakter, 300 unit UTF-16
    expect(clip(emoji, 120)).toBe('😀'.repeat(120));
    // 100 emoji = 100 karakter ≤ 120 → utuh walau 200 unit UTF-16
    expect(clip('😀'.repeat(100), 120)).toBe('😀'.repeat(100));
  });

  it('tidak pernah menghasilkan pasangan surrogate yang terbelah', () => {
    const out = clip('a' + '😀'.repeat(200), 2);
    expect(out).toBe('a😀');
    expect(() => encodeURIComponent(out)).not.toThrow(); // lone surrogate akan melempar URIError
  });
});
