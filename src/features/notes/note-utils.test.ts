import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  escapeLike,
  FREE_GROUP,
  groupLabel,
  groupNotes,
  isNoteScope,
  noteDateLabel,
  notesToMarkdown,
} from './note-utils';

const n = (id: string, note_date: string | null, is_pinned = 0) => ({ id, note_date, is_pinned });

describe('escapeLike', () => {
  it('meng-escape %, _, dan \\ agar dibaca apa adanya', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\dir')).toBe('c:\\\\dir');
    expect(escapeLike('biasa')).toBe('biasa');
  });

  // Bukti perilaku di SQLite sungguhan — query yang sama dengan useNotes.
  const SEARCH = `SELECT id FROM notes
    WHERE (?1 = '' OR LOWER(COALESCE(title, '') || ' ' || content) LIKE '%' || ?1 || '%' ESCAPE '\\')
    ORDER BY id`;
  const setup = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE notes (id TEXT, title TEXT, content TEXT);
      INSERT INTO notes VALUES ('a', 'Diskon', 'potongan 100% hari ini');
      INSERT INTO notes VALUES ('b', 'Rapat', 'bahas anggaran');
      INSERT INTO notes VALUES ('c', NULL, 'nama_file.txt');`);
    return (q: string) =>
      (db.prepare(SEARCH).all(escapeLike(q.trim().toLowerCase())) as { id: string }[]).map(
        (r) => r.id,
      );
  };

  it('mengetik "%" hanya cocok dengan tanda % sungguhan, bukan semua catatan', () => {
    expect(setup()('%')).toEqual(['a']);
  });

  it('mengetik "_" hanya cocok dengan garis bawah sungguhan', () => {
    expect(setup()('_')).toEqual(['c']);
  });

  it('pencarian biasa tidak peka huruf besar/kecil, mencari di judul dan isi', () => {
    const find = setup();
    expect(find('RAPAT')).toEqual(['b']);
    expect(find('anggaran')).toEqual(['b']);
    expect(find('nama_file')).toEqual(['c']);
  });

  it('kata kunci kosong menampilkan semua', () => {
    expect(setup()('   ')).toEqual(['a', 'b', 'c']);
  });
});

describe('groupNotes', () => {
  it('menyematkan yang di-pin, lalu per bulan (terbaru dulu), catatan bebas paling bawah', () => {
    const { pinned, groups } = groupNotes(
      [
        n('p', '2026-08-01', 1),
        n('okt1', '2026-10-07'),
        n('bebas', null),
        n('sep', '2026-09-30'),
        n('okt2', '2026-10-02'),
      ],
      false,
    );
    expect(pinned.map((x) => x.id)).toEqual(['p']);
    expect(groups.map(([k]) => k)).toEqual(['2026-10', '2026-09', FREE_GROUP]);
    expect(groups[0]![1].map((x) => x.id)).toEqual(['okt1', 'okt2']); // urutan masuk dipertahankan
  });

  it('catatan bebas yang di-pin tampil di Disematkan, bukan di "Tanpa tanggal"', () => {
    const { pinned, groups } = groupNotes([n('a', null, 1), n('b', null)], false);
    expect(pinned.map((x) => x.id)).toEqual(['a']);
    expect(groups).toEqual([[FREE_GROUP, [n('b', null)]]]);
  });

  it('di Sampah tidak ada grup Disematkan', () => {
    const { pinned, groups } = groupNotes([n('a', '2026-10-01', 1)], true);
    expect(pinned).toEqual([]);
    expect(groups[0]![1].map((x) => x.id)).toEqual(['a']);
  });

  it('daftar kosong', () => {
    expect(groupNotes([], false)).toEqual({ pinned: [], groups: [] });
  });
});

describe('label', () => {
  it('groupLabel: nama bulan Indonesia atau "Tanpa tanggal"', () => {
    expect(groupLabel('2026-10')).toBe('Oktober 2026');
    expect(groupLabel(FREE_GROUP)).toBe('Tanpa tanggal');
  });

  it('noteDateLabel: relatif untuk bertanggal, "Bebas" untuk tanpa tanggal', () => {
    expect(noteDateLabel('2026-10-07', '2026-10-07')).toBe('Hari ini');
    expect(noteDateLabel('2026-10-06', '2026-10-07')).toBe('Kemarin');
    expect(noteDateLabel(null, '2026-10-07')).toBe('Bebas');
  });

  it('isNoteScope hanya menerima tiga nilai yang dikenal', () => {
    expect(['all', 'dated', 'free'].every(isNoteScope)).toBe(true);
    expect(isNoteScope('lain')).toBe(false);
    expect(isNoteScope(null)).toBe(false);
  });
});

describe('notesToMarkdown', () => {
  it('judul, tanggal (jika ada), isi; dipisah garis', () => {
    const md = notesToMarkdown([
      { note_date: '2026-10-07', title: 'Rapat', content: '- bahas A\n' },
      { note_date: null, title: null, content: 'ide bebas' },
    ]);
    expect(md).toBe(
      '## Rapat\n\n_2026-10-07_\n\n- bahas A\n\n---\n\n## Tanpa judul\n\nide bebas\n',
    );
  });

  it('daftar kosong menghasilkan string kosong', () => {
    expect(notesToMarkdown([])).toBe('');
  });
});
