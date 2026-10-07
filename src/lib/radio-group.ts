import type { KeyboardEvent } from 'react';

/**
 * Pola ARIA radio group (APG): hanya satu radio yang masuk urutan Tab ("roving tabindex"),
 * sedangkan panah berpindah + memilih. Pasang `onKeyDown={onRadioGroupKeyDown}` pada elemen
 * `role="radiogroup"` dan `tabIndex={radioTabIndex(...)}` pada tiap `role="radio"`.
 *
 * Hanya untuk pilihan tunggal yang SELALU terpilih. Pilihan yang boleh dikosongkan (klik ulang =
 * batal) bukan radio — pakai tombol toggle `aria-pressed`.
 */
export function onRadioGroupKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')].filter(
    (r) => !(r as HTMLButtonElement).disabled && r.getAttribute('aria-disabled') !== 'true',
  );
  const current = radios.findIndex((r) => r === document.activeElement);
  if (current < 0 || radios.length < 2) return;

  let next: number;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (current + 1) % radios.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (current - 1 + radios.length) % radios.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = radios.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  radios[next]!.focus();
  radios[next]!.click(); // memilih = sama dengan mengklik
}

/** tabIndex untuk radio ke-`index`: yang terpilih (atau yang pertama bila belum ada) saja yang 0. */
export const radioTabIndex = (checked: boolean, hasChecked: boolean, index: number) =>
  checked || (!hasChecked && index === 0) ? 0 : -1;
