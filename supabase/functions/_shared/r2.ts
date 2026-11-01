// =============================================================================
// Klien Cloudflare R2 (S3 API) untuk Edge Function. Key R2 HANYA ada di secret fungsi.
// Secret: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// Opsional: R2_ENDPOINT (default https://<account>.r2.cloudflarestorage.com)
// =============================================================================
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const env = (k: string) => Deno.env.get(k) ?? '';

export const R2_BUCKET = env('R2_BUCKET');
export const R2_ENDPOINT = (
  env('R2_ENDPOINT') || `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
).replace(/\/$/, '');

export const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});

/** URL objek; setiap segmen key di-encode (key tidak pernah berisi masukan mentah pengguna). */
export const objectUrl = (key: string) =>
  `${R2_ENDPOINT}/${R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;

export const bucketUrl = () => `${R2_ENDPOINT}/${R2_BUCKET}`;

export function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseListing(xml: string) {
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: decodeXml(m[1]!.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? ''),
    modified: Date.parse(m[1]!.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? ''),
  }));
}
