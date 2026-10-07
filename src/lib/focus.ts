/** Pindahkan fokus ke kolom (by id) setelah pesan error-nya dirender. */
export function focusField(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}
