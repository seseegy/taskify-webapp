/**
 * Logika murni Catatan (tanpa DOM/DB) — diuji di note-utils.test.ts.
 */
import { formatLocalDate, relativeDayLabel, type LocalDate } from '@/lib/date';

/** Filter jenis di daftar: semua, hanya yang ditempel ke tanggal, atau hanya catatan bebas. */
export type NoteScope = 'all' | 'dated' | 'free';

export const NOTE_SCOPES: { value: NoteScope; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'dated', label: 'Bertanggal' },
  { value: 'free', label: 'Bebas' },
];

export const isNoteScope = (v: string | null): v is NoteScope =>
  v === 'all' || v === 'dated' || v === 'free';

/**
 * Escape `%`, `_`, dan `\` agar dibaca apa adanya oleh `LIKE ... ESCAPE '\'`.
 * Tanpa ini, mengetik "100%" atau "_" di kotak cari akan cocok dengan hampir semua catatan.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Nama grup daftar: "Disematkan" ditangani terpisah; selebihnya per bulan atau "Tanpa tanggal". */
export const FREE_GROUP = 'bebas';

export interface NoteGroupable {
  id: string;
  note_date: LocalDate | null;
  is_pinned: number;
}

export interface NoteGroups<T extends NoteGroupable> {
  pinned: T[];
  /** Urutan: bulan terbaru dulu, "bebas" paling bawah. Kunci = 'YYYY-MM' atau FREE_GROUP. */
  groups: [string, T[]][];
}

/**
 * Kelompokkan hasil query (sudah terurut pin → tanggal → dibuat) menjadi:
 * "Disematkan" lalu per bulan, lalu "Tanpa tanggal". Di Sampah (`trash`) tidak ada pin.
 */
export function groupNotes<T extends NoteGroupable>(notes: T[], trash: boolean): NoteGroups<T> {
  const pinned = trash ? [] : notes.filter((n) => n.is_pinned === 1);
  const rest = trash ? notes : notes.filter((n) => n.is_pinned !== 1);
  const byKey = new Map<string, T[]>();
  for (const n of rest) {
    const key = n.note_date ? n.note_date.slice(0, 7) : FREE_GROUP;
    byKey.set(key, [...(byKey.get(key) ?? []), n]);
  }
  const groups = [...byKey.entries()].sort(([a], [b]) => {
    if (a === FREE_GROUP) return 1;
    if (b === FREE_GROUP) return -1;
    return b.localeCompare(a);
  });
  return { pinned, groups };
}

export const groupLabel = (key: string) =>
  key === FREE_GROUP ? 'Tanpa tanggal' : formatLocalDate(`${key}-01`, 'MMMM yyyy');

/** Label tanggal untuk kartu/daftar: "Hari ini", "Rab, 8 Okt", atau "Catatan bebas". */
export function noteDateLabel(date: LocalDate | null, today: LocalDate): string {
  return date ? relativeDayLabel(date, today) : 'Bebas';
}

/** Ekspor semua catatan menjadi satu file Markdown. */
export function notesToMarkdown(
  notes: { note_date: string | null; title: string | null; content: string }[],
): string {
  return notes
    .map((n) => {
      const head = `## ${n.title?.trim() || 'Tanpa judul'}`;
      const meta = n.note_date ? `\n_${n.note_date}_\n` : '';
      return `${head}\n${meta}\n${n.content.trim()}\n`;
    })
    .join('\n---\n\n');
}
