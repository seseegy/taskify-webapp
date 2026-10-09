/**
 * Perapian keadaan antrean: dua transisi yang murni, dan karena itu tidak boleh hidup di
 * `useEffect`.
 *
 * Keduanya dulu berupa efek di hook pemutar (begitu bentuknya di `music-taskify`), dan
 * keduanya hanya membaca keadaan lalu mengirim peristiwa lanjutan — tidak menyentuh dunia
 * luar sama sekali. Efek yang memanggil `setState` di badannya memicu render berantai, dan
 * `react-hooks/set-state-in-effect` memang melarangnya. Jadi dipindahkan ke sini: dijalankan
 * **di dalam reducer**, satu kali per peristiwa, sebagai bagian dari perhitungan keadaan
 * berikutnya.
 *
 * Ini **tidak mengubah** `queue-core.ts` (yang dipindahkan apa adanya beserta 60 tesnya) —
 * ia hanya menumpuk di atasnya memakai peristiwa yang sudah ada.
 */

import { continuationSource, currentUrl, reduceYt, type YtState } from './queue-core';

/**
 * Batas pengulangan penyambungan dalam satu perapian.
 *
 * Penyambungan bisa memicu penyambungan berikutnya: lagu tambahan yang keterangannya sudah
 * pernah diambil di sesi ini (`details` disimpan selamanya) langsung memenuhi syarat untuk
 * disambung lagi. Tanpa batas, keadaan yang tidak terduga bisa membuat putaran tak berujung
 * di dalam reducer — dan itu akan membekukan tab, bukan sekadar salah menampilkan sesuatu.
 * Delapan sudah jauh lebih dari cukup: tiap penyambungan menambah sampai 49 lagu.
 */
const MAX_CONTINUATIONS = 8;

/**
 * Keadaan setelah transisi yang tidak perlu menunggu jaringan diterapkan.
 *
 * Dua transisi itu:
 *
 *  1. **Menyambung antrean** begitu keterangan lagu terakhir tiba — bukan saat lagunya
 *     habis. Bedanya terasa: kalau ditunggu sampai habis, ada jeda sunyi selama
 *     permintaannya jalan, dan lagu tambahannya belum bisa diprefetch.
 *  2. **Melewati status `preparing`** untuk lagu yang URL-nya sudah ada — hasil prefetch,
 *     atau lagu yang pernah diputar di sesi ini. Tanpa ini, lagu yang audionya sudah siap
 *     tetap menampilkan "Menyiapkan audio…" sekejap dan menunggu satu putaran efek.
 *
 * Urutannya penting: penyambungan bisa memindahkan posisi (saat lagu terakhir sudah habis
 * dan pemutar sedang menunggu), jadi pemeriksaan URL harus terjadi **sesudahnya** supaya
 * yang diperiksa adalah lagu yang benar.
 */
export function settleQueue(state: YtState): YtState {
  let s = state;
  for (let i = 0; i < MAX_CONTINUATIONS; i += 1) {
    const cont = continuationSource(s);
    if (!cont) break;
    s = reduceYt(s, { type: 'continueQueue', from: cont.from, songs: cont.songs });
  }
  return s.status === 'preparing' && currentUrl(s) ? reduceYt(s, { type: 'playing' }) : s;
}
