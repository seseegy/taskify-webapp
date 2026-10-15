#!/usr/bin/env node
// Pemeriksa kontras token warna (WCAG 1.4.3, teks normal ≥ 4.5:1). Jalankan: pnpm check:contrast
//
// Membaca token LANGSUNG dari src/styles/index.css, jadi tidak bisa melenceng dari sumbernya.
// Pengukuran memakai kasus TERBURUK, bukan satu sampel:
//   latar  = tiap stop gradasi dasar, dan tiap blob (opacity --blob-opacity) di atas tiap stop
//   kaca   = --surface dan --surface-strong di atas latar itu
//   konteks (token status) = teks polos, teks di atas tint `bg-<token>/10` dan `/15` (Badge,
//            banner), serta teks dengan opacity 80% (`text-danger/80`)
import { readFileSync } from 'node:fs';

const MIN = 4.5;
const css = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');

const block = (selector) => {
  const m = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`Blok ${selector} tidak ditemukan di index.css`);
  return Object.fromEntries(
    [...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]),
  );
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexes = (s) => [...s.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => hex(m[0]));
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, a, bg) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
const rgba = (s) => {
  const m = s.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/);
  if (!m) throw new Error(`Format permukaan tidak dikenali: ${s}`);
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
};

function periksa(nama, vars) {
  const stops = hexes(vars['backdrop-base']);
  const blobs = [1, 2, 3, 4].map((n) => hex(vars[`blob-${n}`]));
  const blobA = parseFloat(vars['blob-opacity']);
  const latar = [...stops, ...stops.flatMap((s) => blobs.map((b) => over(b, blobA, s)))];
  const kaca = ['surface', 'surface-strong'].flatMap((k) => {
    const { rgb, a } = rgba(vars[k]);
    return latar.map((bg) => over(rgb, a, bg));
  });
  const basisTint = kaca.slice(0, latar.length); // tint ditumpuk di atas kaca --surface

  const gagal = [];
  const cek = (token, konteks, nilai) => {
    if (nilai < MIN) gagal.push(`${token} [${konteks}] = ${nilai.toFixed(2)}`);
  };

  for (const token of ['fg', 'muted', 'primary', 'danger', 'success', 'warning', 'mod-notes']) {
    const c = hex(vars[token]);
    for (const bg of kaca) cek(token, 'polos', ratio(c, bg));
  }
  for (const token of ['danger', 'success', 'warning']) {
    const c = hex(vars[token]);
    for (const bg of basisTint) {
      cek(token, 'tint/10', ratio(c, over(c, 0.1, bg)));
      cek(token, 'tint/15', ratio(c, over(c, 0.15, bg)));
    }
  }
  // `text-danger/80` dipakai di header & tanggal Minggu (CalendarPage). Hanya danger.
  // Jika token lain mulai dipakai dengan opacity, tambahkan di sini.
  {
    const c = hex(vars.danger);
    for (const bg of basisTint) cek('danger', 'teks /80', ratio(over(c, 0.8, bg), bg));
  }

  const unik = [...new Set(gagal)];
  console.log(
    `${unik.length ? '✖' : '✔'} tema ${nama}: ${unik.length ? `${unik.length} kegagalan` : 'semua token ≥ 4.5:1'}`,
  );
  for (const g of unik.slice(0, 12)) console.log(`    ${g}`);
  return unik.length === 0;
}

const hasil = [periksa('terang', block(':root')), periksa('gelap', block('\\.dark'))];
process.exit(hasil.every(Boolean) ? 0 : 1);
