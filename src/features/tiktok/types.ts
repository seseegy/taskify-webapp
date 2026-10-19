/**
 * Jawaban `POST /v1/extract` Worker ttdl-taskify (kontrak lengkap: README repo ttdl-taskify).
 * Semua URL di sini adalah link Worker (`/v1/media?t=…`), bukan URL CDN TikTok.
 */
export interface TikTokPost {
  id: string;
  type: 'video' | 'photo';
  description: string;
  /** Detik Unix */
  created_at: number;
  canonical_url: string;
  author: {
    unique_id: string;
    nickname: string;
    verified: boolean;
  };
  stats: {
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    bookmarks: number;
  };
  video: { duration_seconds: number; width: number; height: number } | null;
  music: { title: string; author: string; duration_seconds: number; original: boolean } | null;
  hashtags: string[];
  photo_count: number;
  cover: string | null;
  downloads: {
    video: string | null;
    photos: string[];
    audio: string | null;
  };
}

/** Yang bisa diunduh dari satu postingan. `photo` memakai indeks foto. */
export type TikTokAsset = { kind: 'video' } | { kind: 'audio' } | { kind: 'photo'; index: number };
