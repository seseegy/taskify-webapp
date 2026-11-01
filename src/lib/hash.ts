/**
 * 16 hex pertama SHA-256 (teks UTF-8). SAMA dengan `public.vault_key_ref()` di Postgres
 * (migrasi …_vault_key_guard.sql): dipakai sebagai label kunci brankas dan sidik versi baris.
 * 64 bit cukup untuk membedakan, bukan untuk rahasia.
 */
export async function sha256Hex16(text: string): Promise<string> {
  const hash = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return [...hash.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
