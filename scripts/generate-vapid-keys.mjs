#!/usr/bin/env node
// Membuat pasangan kunci VAPID untuk Web Push (sekali saja). Jalankan: pnpm vapid:generate
//
// Output:
//   1. VITE_VAPID_PUBLIC_KEY → tempel ke .env.local (& env Cloudflare Pages). Publik, aman.
//   2. VAPID_KEYS_JSON       → secret Edge Function. RAHASIA, jangan di-commit.
//   3. CRON_SECRET           → secret Edge Function + Vault (schedule-reminders.sql).
//
// Format kunci = JWK, kompatibel dengan importVapidKeys() dari jsr:@negrel/webpush.
import { randomBytes, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);

const publicJwk = await subtle.exportKey('jwk', keys.publicKey);
const privateJwk = await subtle.exportKey('jwk', keys.privateKey);
const raw = Buffer.from(await subtle.exportKey('raw', keys.publicKey));

const vapidJson = JSON.stringify({ publicKey: publicJwk, privateKey: privateJwk });
const cronSecret = randomBytes(24).toString('base64url');

console.log('\n# 1) .env.local + Cloudflare Pages');
console.log(`VITE_VAPID_PUBLIC_KEY=${raw.toString('base64url')}`);
console.log('\n# 2) + 3) Secret Edge Function (jalankan di folder project):');
console.log(`npx supabase secrets set VAPID_KEYS_JSON='${vapidJson}'`);
console.log(`npx supabase secrets set CRON_SECRET='${cronSecret}'`);
console.log(`npx supabase secrets set VAPID_SUBJECT='mailto:<email-kamu>'`);
console.log('\n# CRON_SECRET yang sama dipakai di supabase/sql/schedule-reminders.sql\n');
