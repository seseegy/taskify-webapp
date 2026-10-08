/**
 * Logika navigasi & penempatan untuk `Listbox`. Dipisah dari komponennya supaya bisa diuji
 * tanpa DOM — repo ini tidak punya infrastruktur tes DOM, jadi bagian yang paling mudah salah
 * (gulir indeks, lompat-ketik, dan buka ke atas/bawah) diuji di sini.
 */

export interface NavOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Tinggi satu baris opsi (px). HARUS sama dengan kelas tinggi di Listbox.tsx. */
export const OPTION_HEIGHT = 40;
/** Padding atas+bawah panel. */
export const POPUP_PADDING = 8;
/** Jumlah opsi yang terlihat sebelum panel mulai digulir. */
export const VISIBLE_OPTIONS = 7;
/** Jarak panel ke pemicunya. */
export const POPUP_GAP = 4;
/** Panel tidak pernah lebih pendek dari ini, walau ruang sempit — selalu ada yang bisa digulir. */
export const MIN_POPUP_HEIGHT = 120;

const enabledAt = (options: NavOption[], i: number) =>
  options[i] !== undefined && options[i]?.disabled !== true;

/** Opsi aktif pertama mulai dari `from` ke arah `dir`; -1 bila semuanya nonaktif. */
export function seek(options: NavOption[], from: number, dir: 1 | -1): number {
  const n = options.length;
  for (let k = 0; k < n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (enabledAt(options, i)) return i;
  }
  return -1;
}

/**
 * Indeks aktif berikutnya untuk tombol panah/Home/End. `null` = tombol tidak diurus di sini
 * (biarkan perilaku bawaan).
 *
 * Melingkar: dari opsi terakhir, panah bawah kembali ke awal. Opsi nonaktif dilewati.
 */
export function nextIndex(options: NavOption[], current: number, key: string): number | null {
  const n = options.length;
  if (n === 0) return null;

  switch (key) {
    case 'ArrowDown':
      return seek(options, current < 0 ? 0 : current + 1, 1);
    case 'ArrowUp':
      return seek(options, current < 0 ? n - 1 : current - 1, -1);
    case 'Home':
      return seek(options, 0, 1);
    case 'End':
      return seek(options, n - 1, -1);
    default:
      return null;
  }
}

/**
 * Lompat-ketik: cari opsi yang labelnya diawali `buffer`, mulai SETELAH `current` lalu
 * melingkar, supaya mengetik huruf yang sama berpindah ke kecocokan berikutnya.
 * -1 = tidak ada yang cocok.
 */
export function typeaheadIndex(options: NavOption[], buffer: string, current: number): number {
  const needle = buffer.trim().toLowerCase();
  if (!needle) return -1;

  const n = options.length;
  // Saat buffer masih satu huruf, mulai dari opsi berikutnya; kalau sudah dirangkai,
  // mulai dari opsi saat ini supaya pengetikan berlanjut tidak melompati kecocokan.
  const from = buffer.length === 1 ? current + 1 : Math.max(current, 0);
  for (let k = 0; k < n; k++) {
    const i = (((from + k) % n) + n) % n;
    const o = options[i];
    if (o && o.disabled !== true && o.label.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  /** true = panel dibuka ke atas karena ruang di bawah tidak cukup. */
  above: boolean;
}

/**
 * Posisi panel (koordinat viewport, untuk `position: fixed`).
 *
 * Panel memakai atribut `popover` sehingga berada di top layer — itulah sebabnya ia tidak
 * terpotong oleh `overflow-y-auto` milik `Sheet`, dan tetap terlihat di atas `<dialog>` modal.
 * Konsekuensinya posisinya harus dihitung sendiri terhadap viewport.
 */
export function computePlacement(
  rect: TriggerRect,
  viewportHeight: number,
  optionCount: number,
): Placement {
  const desired = Math.min(optionCount, VISIBLE_OPTIONS) * OPTION_HEIGHT + POPUP_PADDING * 2;
  const spaceBelow = viewportHeight - rect.bottom - POPUP_GAP * 2;
  const spaceAbove = rect.top - POPUP_GAP * 2;

  // Hanya pindah ke atas kalau bawah tidak cukup DAN atas memang lebih lega.
  const above = spaceBelow < desired && spaceAbove > spaceBelow;
  const room = above ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(MIN_POPUP_HEIGHT, Math.min(desired, room));

  return {
    left: rect.left,
    width: rect.width,
    top: above ? rect.top - maxHeight - POPUP_GAP : rect.bottom + POPUP_GAP,
    maxHeight,
    above,
  };
}
