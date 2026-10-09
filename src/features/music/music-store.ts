import { create } from 'zustand';

/** Tab di `MusicSheet`. Radio tidak ada — lihat docs/RANCANGAN-MUSIK.md. */
export type MusicTab = 'cari' | 'antrean' | 'lirik';

/**
 * Panel musik yang sedang terbuka. **Satu field, bukan beberapa boolean.**
 *
 * Ada dua panel: layar "Sedang diputar" dan `Sheet` tiga tab. Keduanya `<dialog>`, dan
 * keduanya terbuka sekaligus adalah keadaan yang tidak masuk akal — dialog bertumpuk membuat
 * Esc dan pengembalian fokus jadi tebak-tebakan. Dengan satu field, keadaan itu **mustahil
 * dibentuk**, bukan sekadar dihindari dengan disiplin.
 */
export type MusicPanel = 'none' | 'sekarang' | MusicTab;

/**
 * Keadaan panel musik, dipisahkan dari keadaan pemutarnya.
 *
 * Alasannya praktis: yang membuka panel ada di mana-mana — bilah mini, CommandPalette, baris
 * lagu yang sedang diputar — sementara keadaan pemutar (antrean, status, audio) hidup di satu
 * hook di `MusicBar`. Kalau keduanya disatukan, setiap pemicu harus punya akses ke hook itu.
 *
 * Mengikuti pola `ui/toast-store.ts` dan `ui/confirm-store.ts`: store singleton + fungsi
 * imperatif untuk dipanggil dari mana saja.
 */
interface MusicPanelState {
  panel: MusicPanel;
  /** Tab yang terakhir dilihat, supaya kembali dari "Sedang diputar" tidak kehilangan tempat. */
  tab: MusicTab;
  show: (panel: Exclude<MusicPanel, 'none'>) => void;
  hide: () => void;
}

export const useMusicPanel = create<MusicPanelState>((set) => ({
  panel: 'none',
  tab: 'cari',
  // Membuka tab juga mencatatnya sebagai tab terakhir; "sekarang" tidak mengubah catatan itu.
  show: (panel) => set(panel === 'sekarang' ? { panel } : { panel, tab: panel }),
  hide: () => set({ panel: 'none' }),
}));

/** Pemakaian: `openMusicSheet('antrean')`. Tanpa argumen = tab yang terakhir dilihat. */
export function openMusicSheet(tab?: MusicTab) {
  const state = useMusicPanel.getState();
  state.show(tab ?? state.tab);
}

/** Layar "Sedang diputar". Menutup `Sheet` tiga tab kalau sedang terbuka. */
export function openNowPlaying() {
  useMusicPanel.getState().show('sekarang');
}

/**
 * Ringkasan keadaan pemutar untuk pintu masuk di LUAR pemutar.
 *
 * Keadaan pemutar yang sebenarnya hidup di `useMusicPlayer` — satu hook di `MusicBar`, yang
 * memegang antrean dan elemen `<audio>`. CommandPalette adalah komponen bersaudara, jadi ia
 * tidak bisa membacanya. Yang dibutuhkannya pun sedikit: cukup untuk memutuskan item mana
 * yang masuk akal ditampilkan ("Lirik lagu ini" tidak ada gunanya kalau lagunya tanpa lirik).
 *
 * Jadi ini **cermin satu arah**, bukan sumber kebenaran kedua: hanya `MusicBar` yang menulis,
 * hanya primitif yang disimpan, dan tidak ada satu pun keputusan pemutar yang dibuat dari
 * sini. Kalau nanti ada yang perlu lebih dari ini, yang benar adalah memindahkan keadaan
 * pemutar ke store — bukan memperlebar cermin ini.
 */
export interface MusicRemoteState {
  /** Ada antrean, jadi ada yang bisa dijeda atau dilompati. */
  active: boolean;
  playing: boolean;
  /** Lagu sekarang punya lirik yang bisa diambil. */
  hasLyrics: boolean;
}

const INITIAL_REMOTE: MusicRemoteState = { active: false, playing: false, hasLyrics: false };

export const useMusicRemote = create<MusicRemoteState>(() => INITIAL_REMOTE);

/** Dipanggil `MusicBar`. Tidak menulis apa pun bila ringkasannya tidak berubah. */
export function publishMusicRemote(next: MusicRemoteState) {
  const current = useMusicRemote.getState();
  if (
    current.active === next.active &&
    current.playing === next.playing &&
    current.hasLyrics === next.hasLyrics
  ) {
    return;
  }
  useMusicRemote.setState(next);
}

/**
 * Putar/jeda dari luar pemutar.
 *
 * Disimpan sebagai variabel biasa, **bukan** di dalam store: fungsinya ikut berubah
 * identitasnya setiap keadaan pemutar berubah, dan menaruhnya di store berarti setiap
 * laporan progres memicu render di tiap pembacanya. Diikat ulang memang sering, tapi satu
 * penugasan variabel tidak ada biayanya.
 *
 * Harus selalu yang terbaru: `toggle()` memutuskan peristiwa mana yang dikirim berdasarkan
 * status saat itu, jadi handler yang basi akan mengambil keputusan dari status lama.
 */
let toggleHandler: (() => void) | null = null;

export function bindMusicToggle(handler: (() => void) | null) {
  toggleHandler = handler;
}

/** Tidak melakukan apa-apa kalau pemutarnya tidak terpasang (musik tidak dikonfigurasi). */
export function toggleMusicPlayback() {
  toggleHandler?.();
}
