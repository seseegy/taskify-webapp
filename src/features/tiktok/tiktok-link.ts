/**
 * Deteksi link TikTok di teks bebas — teks dari menu Bagikan aplikasi TikTok berbentuk
 * "<judul/ajakan> https://vt.tiktok.com/ZS…/", kadang dengan teks lain sesudahnya.
 *
 * Hanya untuk MEMUTUSKAN apakah kartu TikTok ditampilkan; teks utuhnya tetap dikirim ke Worker,
 * yang mengulang pengecekan yang sama (dan mengikuti link pendek).
 */
const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*tiktok\.com\/[^\s"'<>]+/i;

export function findTikTokLink(text: string): string | null {
  const match = text.match(URL_RE);
  if (!match) return null;
  let candidate = match[0].replace(/[.,;:!?)\]]+$/, '');
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) return null;
    // Halaman yang bukan postingan (profil, tag, beranda) tidak bisa diunduh
    const path = url.pathname;
    const isPost = /\/(video|photo)\/\d{17,21}/.test(path);
    const isShort =
      (/^(vt|vm)\./.test(host) && /^\/[\w-]+/.test(path)) || /^\/t\/[\w-]+/.test(path);
    return isPost || isShort ? url.href : null;
  } catch {
    return null;
  }
}
