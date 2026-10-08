/**
 * URL pada item sandi berasal dari input pengguna (atau hasil impor/sinkron perangkat lain),
 * jadi TIDAK boleh langsung dijadikan `href`: `javascript:`/`data:` bisa mengeksekusi skrip saat
 * diklik. Hanya http(s) yang dibuka.
 */
export function safeUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /[\s<>"'`]/.test(text)) return null;
  // Tanpa skema ("github.com/login") dianggap https
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** "https://www.github.com/login" → "github.com" (untuk tampilan ringkas). */
export function displayHost(input: string): string {
  const safe = safeUrl(input);
  if (!safe) return input.trim();
  return new URL(safe).hostname.replace(/^www\./, '');
}
