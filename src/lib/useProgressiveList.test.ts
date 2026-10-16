import { describe, expect, it } from 'vitest';
import { countGrouped, limitGroups } from './useProgressiveList';

describe('limitGroups', () => {
  const groups: [string, number[]][] = [
    ['okt', [1, 2, 3]],
    ['sep', [4, 5]],
    ['agu', [6]],
  ];

  it('memotong lintas kelompok sesuai urutan tampil', () => {
    expect(limitGroups(groups, 4)).toEqual([
      ['okt', [1, 2, 3]],
      ['sep', [4]],
    ]);
    expect(limitGroups(groups, 3)).toEqual([['okt', [1, 2, 3]]]);
  });

  it('batas ≥ total → semua, tanpa menyalin kelompok yang utuh', () => {
    const out = limitGroups(groups, 100);
    expect(out).toEqual(groups);
    expect(out[0]![1]).toBe(groups[0]![1]);
    expect(countGrouped(groups)).toBe(6);
  });
});
