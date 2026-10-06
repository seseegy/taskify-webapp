#!/usr/bin/env bash
# =============================================================================
# Backup Postgres Supabase → Cloudflare R2 (dipanggil .github/workflows/backup.yml)
# =============================================================================
# Isi arsip  taskify-<UTC timestamp>.tar.gz[.enc]:
#   public.dump      pg_dump -Fc skema public (struktur + data semua tabel aplikasi)
#   auth_users.dump  pg_dump -Fc data auth.users (dibutuhkan FK user_id saat restore)
#   manifest.txt     waktu, versi pg_dump, ukuran
# Dienkripsi AES-256-CBC + PBKDF2 (openssl, 600 ribu iterasi) jika BACKUP_PASSPHRASE
# di-set — sangat disarankan, karena berisi jurnal & data keuangan. Dekripsi:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in X.tar.gz.enc -out X.tar.gz
#
# Env wajib:  SUPABASE_DB_URL  R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BACKUP_BUCKET
# Env opsional: BACKUP_PASSPHRASE, BACKUP_KEEP (default 12 arsip terbaru), BACKUP_PREFIX (default backups/)
# Bisa diganti untuk pengujian: PG_DUMP, AWS
# =============================================================================
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL belum di-set}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID belum di-set}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID belum di-set}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY belum di-set}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET belum di-set}"

PG_DUMP="${PG_DUMP:-pg_dump}"
AWS="${AWS:-aws}"
KEEP="${BACKUP_KEEP:-12}"
PREFIX="${BACKUP_PREFIX:-backups/}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# AWS CLI → R2
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
# AWS CLI ≥ 2.23 menambah checksum CRC default yang belum didukung penuh R2
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "▶ Dump skema public"
$PG_DUMP --dbname="$SUPABASE_DB_URL" --format=custom --schema=public --no-owner --no-privileges > "$WORK/public.dump"
echo "▶ Dump data auth.users"
$PG_DUMP --dbname="$SUPABASE_DB_URL" --format=custom --data-only --table=auth.users > "$WORK/auth_users.dump"

{
  echo "taskify backup"
  echo "created_utc=$STAMP"
  echo "pg_dump=$($PG_DUMP --version)"
  echo "public_bytes=$(wc -c < "$WORK/public.dump")"
  echo "auth_users_bytes=$(wc -c < "$WORK/auth_users.dump")"
} > "$WORK/manifest.txt"

# Sanity check: dump kosong = ada yang salah
if [ "$(wc -c < "$WORK/public.dump")" -lt 1024 ]; then
  echo "✖ public.dump terlalu kecil — periksa SUPABASE_DB_URL" >&2
  exit 1
fi

NAME="taskify-${STAMP}.tar.gz"
tar -C "$WORK" -czf "$WORK/$NAME" public.dump auth_users.dump manifest.txt

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  echo "▶ Enkripsi AES-256 (PBKDF2)"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE \
    -in "$WORK/$NAME" -out "$WORK/$NAME.enc"
  NAME="$NAME.enc"
else
  echo "⚠ BACKUP_PASSPHRASE kosong — arsip TIDAK dienkripsi"
fi

echo "▶ Unggah s3://$R2_BACKUP_BUCKET/$PREFIX$NAME ($(wc -c < "$WORK/$NAME") byte)"
$AWS s3 cp "$WORK/$NAME" "s3://$R2_BACKUP_BUCKET/$PREFIX$NAME" --endpoint-url "$ENDPOINT" --only-show-errors

echo "▶ Retensi: simpan $KEEP arsip terbaru"
# Nama memuat timestamp UTC → urutan nama = urutan waktu
mapfile -t ALL < <($AWS s3 ls "s3://$R2_BACKUP_BUCKET/$PREFIX" --endpoint-url "$ENDPOINT" | awk '{print $4}' | grep -E '^taskify-[0-9]{8}T[0-9]{6}Z\.tar\.gz(\.enc)?$' | sort)
COUNT=${#ALL[@]}
if [ "$COUNT" -gt "$KEEP" ]; then
  for old in "${ALL[@]:0:$((COUNT - KEEP))}"; do
    echo "  hapus $old"
    $AWS s3 rm "s3://$R2_BACKUP_BUCKET/$PREFIX$old" --endpoint-url "$ENDPOINT" --only-show-errors
  done
fi
echo "✔ Backup selesai: $NAME (total arsip: $(( COUNT > KEEP ? KEEP : COUNT )))"
