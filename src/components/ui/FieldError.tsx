import type { ReactNode } from 'react';

/**
 * Pesan error inline di bawah kolom form. Diumumkan pembaca layar saat muncul (`role="alert"`).
 * Hubungkan ke kolomnya: `aria-invalid` + `aria-describedby={id}` pada input/select.
 */
export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 px-1 text-xs font-medium text-danger">
      {children}
    </p>
  );
}
