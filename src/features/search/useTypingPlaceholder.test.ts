import { describe, expect, it } from 'vitest';
import { parseCapture } from '@/features/capture/parse-capture';
import { PLACEHOLDER_EXAMPLES, PLACEHOLDER_PREFIX } from './useTypingPlaceholder';

const TODAY = '2026-10-15';
const parse = (i: number) => parseCapture(PLACEHOLDER_EXAMPLES[i]!, TODAY);

// Placeholder ini MENGAJARKAN sintaks catat cepat. Contoh yang tidak diurai seperti yang
// diiklankan menyesatkan pengguna, jadi tiap contoh dikunci ke perilaku parser sungguhan.
describe('contoh placeholder kotak cari', () => {
  it('"makan siang 25rb" → pengeluaran Rp25.000', () => {
    expect(parse(0)).toMatchObject({ kind: 'expense', amount: 25000 });
  });

  it('"rapat 09.00 #kerja" → tugas dengan jam 09:00 dan tag kerja', () => {
    expect(parse(1)).toMatchObject({ kind: 'task', time: '09:00', tags: ['kerja'] });
  });

  it('"c: ide fitur baru" → catatan bebas', () => {
    expect(parse(2)).toMatchObject({ kind: 'note', rawText: 'ide fitur baru' });
    expect(parse(2).date).toBeUndefined();
  });

  it('"+5jt gaji oktober" → pemasukan Rp5.000.000', () => {
    expect(parse(3)).toMatchObject({ kind: 'income', amount: 5_000_000 });
  });

  it('"j: hari ini puas" → jurnal', () => {
    expect(parse(4)).toMatchObject({ kind: 'journal' });
  });

  it('mengajarkan kelima jenis: pengeluaran, pemasukan, tugas, catatan, jurnal', () => {
    const kinds = new Set(PLACEHOLDER_EXAMPLES.map((_, i) => parse(i).kind));
    expect(kinds).toEqual(new Set(['expense', 'income', 'task', 'note', 'journal']));
  });

  it('tiap contoh cukup pendek (batas kasar 320px: ≤ 28 karakter dengan awalan)', () => {
    // Pengukuran asli di browser: 'Coba: rapat 09.00 #kerja' (25 kar.) = 182px dari 201px yang ada;
    // 'Coba: besok rapat jam 9 #kerja' (30 kar.) = 221px → terpotong. Batas 28 menjaga margin.
    for (const ex of PLACEHOLDER_EXAMPLES)
      expect((PLACEHOLDER_PREFIX + ex).length, ex).toBeLessThanOrEqual(28);
  });

  it('tidak ada contoh kosong atau duplikat', () => {
    expect(new Set(PLACEHOLDER_EXAMPLES).size).toBe(PLACEHOLDER_EXAMPLES.length);
    for (const ex of PLACEHOLDER_EXAMPLES) expect(ex.trim()).not.toBe('');
  });
});
