/**
 * Quick capture: satu kalimat bebas → tugas, transaksi, atau jurnal.
 *
 *   "makan siang 25rb"            → pengeluaran Rp25.000 "makan siang" (kategori ditebak: Makan)
 *   "+5jt gaji oktober"           → pemasukan
 *   "grab ke kantor 18rb kemarin" → pengeluaran kemarin
 *   "besok deploy jam 9 #kerja"   → tugas besok 09:00 bertag #kerja
 *   "j: hari ini capek tapi puas" → jurnal
 */
import { addLocalDays, type LocalDate } from '@/lib/date';
import { parseIDR } from '@/lib/money';
import { parseQuickAdd } from '@/features/tasks/quick-parse';

export type CaptureKind = 'task' | 'expense' | 'income' | 'journal';

export interface Capture {
  kind: CaptureKind;
  title: string;
  tags: string[];
  amount?: number;
  date?: LocalDate;
  time?: string;
  priority?: number;
  /** Kata kunci untuk menebak kategori transaksi */
  categoryHint?: string;
  /**
   * Judul jika jenisnya diganti menjadi transaksi. Hanya diisi saat nominal terdeteksi tetapi
   * kalimatnya dibaca sebagai rencana (tugas): `title` masih memuat nominal ("bayar listrik 150rb"),
   * sedangkan `txTitle` sudah bersih ("bayar listrik").
   */
  txTitle?: string;
}

const INCOME_WORDS =
  /\b(gaji|gajian|bonus|thr|terima|diterima|dapat|pemasukan|transferan|freelance|komisi|dividen|refund)\b/i;

/** Kata kunci → kata pada nama kategori (dicocokkan dengan awalan nama kategori). */
export const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [
    /\b(makan|minum|kopi|sarapan|siang|malam|jajan|snack|resto|warteg|bakso|nasi|mie|cafe|kafe|gofood|grabfood)\b/i,
    'makan',
  ],
  [
    /\b(grab|gojek|gocar|goride|ojek|ojol|bensin|pertalite|parkir|tol|kereta|krl|mrt|busway|taksi|bus|transport)\b/i,
    'transport',
  ],
  [/\b(listrik|pln|air|pdam|internet|wifi|indihome|pulsa|kuota|token|tagihan|bpjs)\b/i, 'tagihan'],
  [/\b(netflix|spotify|youtube|langganan|icloud|disney|chatgpt|github)\b/i, 'langganan'],
  [/\b(belanja|shopee|tokopedia|lazada|indomaret|alfamart|supermarket|baju)\b/i, 'belanja'],
  [/\b(obat|dokter|apotek|klinik|rs|vitamin)\b/i, 'kesehatan'],
  [/\b(nonton|bioskop|game|steam|konser|hiburan)\b/i, 'hiburan'],
  [/\b(buku|kursus|kuliah|sekolah|ujian)\b/i, 'pendidikan'],
  [/\b(gaji|gajian)\b/i, 'gaji'],
  [/\b(freelance|proyek|project|klien)\b/i, 'freelance'],
  [/\b(bonus|thr)\b/i, 'bonus'],
];

// Nominal: wajib ber-"rp", bersufiks (rb/k/jt…), atau ≥ 4 digit / berpemisah ribuan
const MONEY =
  /(^|\s)(\+?)((?:rp\.?\s?)\d[\d.,]*(?:\s?(?:rb|ribu|k|jt|juta))?|\d+(?:[.,]\d+)?\s?(?:rb|ribu|k|jt|juta)|\d{1,3}(?:\.\d{3})+|\d{4,})(?=\s|$)/i;

/**
 * Kata yang, jika mengikuti angka polos, menandakan itu BUKAN uang ("1000 kata", "10000 langkah").
 * Sengaja tidak memuat kata waktu (hari/jam/tahun) karena "50000 hari ini" adalah nominal + tanggal.
 */
const COUNT_UNITS = new Set([
  'kata',
  'karakter',
  'langkah',
  'kali',
  'orang',
  'halaman',
  'hal',
  'baris',
  'item',
  'pcs',
  'km',
  'kg',
  'gram',
  'meter',
  'liter',
  'mb',
  'gb',
  'kb',
  'kalori',
  'kkal',
  'step',
  'steps',
  'words',
]);

/** Nominal pertama yang masuk akal. Angka polos yang mirip nomor telepon/ID atau berisi satuan dilewati. */
function findMoney(text: string): RegExpMatchArray | null {
  for (const m of text.matchAll(new RegExp(MONEY.source, 'gi'))) {
    const raw = m[3]!;
    if (/^[\d.,]+$/.test(raw)) {
      // Tanpa "rp" maupun sufiks (rb/jt/…). Nomor telepon/ID: berawalan 0 atau lebih dari 9 digit.
      if (/^\d+$/.test(raw) && (raw.startsWith('0') || raw.length > 9)) continue;
      const next = text
        .slice(m.index! + m[0].length)
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase();
      if (next && COUNT_UNITS.has(next)) continue;
    }
    return m;
  }
  return null;
}

/** Penanda tanggal MENDATANG yang jelas. Nama hari tanpa "depan" sengaja tidak termasuk. */
const FUTURE_WORD =
  /\s(?:besok|lusa|minggu\s+depan|(?:senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad)\s+depan)(?=\s)/i;

export function parseCapture(input: string, today: LocalDate): Capture {
  let text = ` ${input.trim()} `;

  // Tag #nama
  const tags: string[] = [];
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, t: string) => {
    tags.push(t.toLowerCase());
    return ' ';
  });

  // Jurnal eksplisit
  const journal = text.match(/^\s*(?:j|jurnal|journal|catatan)\s*:\s*(.*)$/is);
  if (journal) return { kind: 'journal', title: journal[1]!.trim(), tags, date: today };

  // Transaksi: ada nominal uang
  const money = findMoney(text);
  // Angka 4 digit 1900–2100 tanpa penanda uang kemungkinan besar tahun, bukan nominal
  const looksLikeYear =
    money && /^\d{4}$/.test(money[3]!) && Number(money[3]) >= 1900 && Number(money[3]) <= 2100;
  if (money && !looksLikeYear) {
    const amount = parseIDR(money[3]!);
    if (amount && amount > 0) {
      let rest = text.replace(money[0], ' ');

      // Nominal + "besok/lusa/minggu depan" = rencana membayar, bukan transaksi yang sudah terjadi.
      // Jadikan tugas bertanggal; nominal tetap disimpan agar jenisnya bisa diganti di palette.
      if (FUTURE_WORD.test(rest)) {
        const plan = parseQuickAdd(text, today);
        const planTx = parseQuickAdd(rest, today);
        if (plan.due_date && plan.due_date > today) {
          return {
            kind: 'task',
            title: plan.title,
            tags,
            amount,
            date: plan.due_date,
            time: plan.due_time,
            priority: plan.priority,
            txTitle: planTx.title,
            categoryHint: CATEGORY_KEYWORDS.find(([re]) => re.test(planTx.title))?.[1],
          };
        }
      }

      let date: LocalDate = today;
      rest = rest.replace(/\s(kemarin|kmrn)(?=\s)/i, () => {
        date = addLocalDays(today, -1);
        return ' ';
      });
      rest = rest.replace(/\s(hari ini)(?=\s)/i, ' ');
      const title = rest.replace(/\s+/g, ' ').trim();
      const income = money[2] === '+' || INCOME_WORDS.test(title);
      const hint = CATEGORY_KEYWORDS.find(([re]) => re.test(title))?.[1];
      return { kind: income ? 'income' : 'expense', title, tags, amount, date, categoryHint: hint };
    }
  }

  // Default: tugas
  const t = parseQuickAdd(text, today);
  return {
    kind: 'task',
    title: t.title,
    tags,
    date: t.due_date,
    time: t.due_time,
    priority: t.priority,
  };
}

/** Pilih kategori yang cocok dengan petunjuk (awalan nama, tanpa beda huruf besar). */
export function matchCategory<T extends { id: string; name: string; kind: string }>(
  categories: T[],
  kind: 'income' | 'expense',
  hint: string | undefined,
  title: string,
): T | undefined {
  const pool = categories.filter((c) => c.kind === kind);
  const lower = title.toLowerCase();
  return (
    (hint && pool.find((c) => c.name.toLowerCase().startsWith(hint))) ||
    pool.find((c) =>
      lower.split(/\s+/).some((w) => w.length > 2 && c.name.toLowerCase().startsWith(w)),
    ) ||
    undefined
  );
}
