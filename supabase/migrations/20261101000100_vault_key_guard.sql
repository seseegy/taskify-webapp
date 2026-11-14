-- =============================================================================
-- Sandi · penjaga kunci brankas (rotasi DEK yang tidak bisa menghilangkan data)
-- =============================================================================
-- Masalah yang ditutup: mengganti master password / kunci pemulihan membuat DEK BARU dan menulis
-- ulang semua baris terenkripsi. Dulu tulisan itu diunggah per baris tanpa pemeriksaan apa pun,
-- sehingga data bisa menjadi tidak terbuka SELAMANYA bila:
--   (a) perangkat lain offline menyimpan/mengubah sandi dengan DEK lama lalu mengunggahnya
--       setelah rotasi (menimpa versi yang sudah dienkripsi ulang);
--   (b) perangkat yang merotasi belum menerima semua baris (sinkron belum selesai), jadi baris
--       yang belum tiba tetap memakai DEK lama yang kini sudah dibuang;
--   (c) dua perangkat merotasi bersamaan dan saling menimpa.
--
-- Lapisan di server (klien punya prasyaratnya sendiri, lihat src/features/sandi/vault-rotation.ts):
--   1. Label kunci di setiap ciphertext: `enc` = '<16 hex>.<base64>', label = 16 hex pertama
--      SHA-256(pw_keys.wrapped_key) — `public.vault_key_ref()`, sama persis dengan `keyRef()` di
--      src/features/sandi/crypto.ts. Trigger `vault_enc_guard` menolak tulisan yang labelnya
--      bukan kunci saat ini (23V03) → kasus (a). Trigger mengunci baris kunci (FOR SHARE), jadi
--      tulisan yang datang bersamaan dengan rotasi menunggu lalu diperiksa terhadap kunci BARU.
--   2. Kunci HANYA berganti lewat RPC atomik `apply_vault_rotation`. RPC memeriksa
--      compare-and-swap kunci asal (23V01) → kasus (c), bahwa SETIAP baris terenkripsi milik
--      user di server ikut di dalam transaksi (23V02) → kasus (b), dan bahwa setiap baris masih
--      versi yang dienkripsi ulang klien (23V02; edit perangkat lain tidak tertimpa salinan basi).
--      Satu transaksi Postgres: diterima semua atau tidak sama sekali. Mengulang rotasi yang
--      SUDAH diterima (respons hilang di jaringan) dianggap sukses, bukan ditolak.
--   3. Kompatibilitas klien versi lama (cache PWA sebelum pembaruan):
--      * Baris lama tanpa label tetap TERBACA, dan tulisan tanpa label tetap DITERIMA sampai
--        `labels_required_at` terisi.
--      * `labels_required_at` terisi saat rotasi pertama lewat RPC diterima, ATAU saat ada upaya
--        mengganti kunci dengan cara lama (PATCH langsung / RPC tanpa `rotated_from`). Sejak itu
--        tulisan tanpa label ditolak, karena server tidak bisa lagi tahu kunci mana yang dipakai —
--        tulisan berikutnya dari klien lama itu memakai DEK yang tidak pernah diterima server.
--      * PATCH kunci langsung dari klien lama TIDAK ditolak dengan error, melainkan DINETRALKAN
--        (materi kunci tetap yang lama) — kalau ditolak, klien lama mengulangnya selamanya dan
--        seluruh antrean sinkronnya macet. Perangkatnya kembali ke kunci lama setelah sinkron.
--
-- Kode error di kelas SQLSTATE 23 (integrity constraint) dengan subkelas V: dianggap PERMANEN
-- oleh src/db/upload-policy.ts baru MAUPUN lama (/^23...$/) → masuk upload_errors, antrean
-- tidak macet.
--   23V01 kunci di server sudah berubah   23V02 baris di server tidak tercakup
--   23V03 kunci lama / tanpa brankas      23V05 bentuk tidak valid
--   (23V04 = permintaan terlalu besar, dibuat klien dari HTTP 413)
--
-- Daftar tabel terenkripsi = VAULT_ENCRYPTED_TABLES di src/db/schema.ts (diuji sama di
-- supabase/tests/migrations.test.ts). Jenis data baru yang dienkripsi DEK Sandi WAJIB ditambah
-- di trigger & RPC ini, di rekeyVaultRows, dan di daftar itu.
-- =============================================================================

alter table public.pw_keys
  add column rotated_from       text check (rotated_from is null or rotated_from ~ '^[0-9a-f]{16}$'),
  add column labels_required_at timestamptz;

comment on column public.pw_keys.rotated_from is
  'Label kunci (vault_key_ref) asal rotasi terakhir. Diisi klien, diverifikasi apply_vault_rotation.';
comment on column public.pw_keys.labels_required_at is
  'Sejak kapan ciphertext TANPA label kunci ditolak (rotasi pertama, atau upaya ganti kunci cara lama). Diisi server.';

-- -----------------------------------------------------------------------------
-- Label kunci: SAMA dengan keyRef() di klien (UTF-8 → SHA-256 → 16 hex pertama)
-- -----------------------------------------------------------------------------
create or replace function public.vault_key_ref(p_wrapped_key text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select left(encode(sha256(convert_to(p_wrapped_key, 'UTF8')), 'hex'), 16);
$$;
revoke all on function public.vault_key_ref(text) from public, anon;
grant execute on function public.vault_key_ref(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Setiap tulisan ciphertext harus memakai kunci brankas SAAT INI
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: membaca pw_keys pemilik baris tanpa bergantung pada RLS pemanggil (FORCE RLS).
-- Tidak mengembalikan data; hanya menerima atau menolak.
create or replace function public.vault_enc_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k_wrapped text;
  k_required timestamptz;
  ref text;
begin
  -- UPDATE yang tidak mengubah isi (hapus lunak, sentuh updated_at) tidak perlu diperiksa
  if tg_op = 'UPDATE' and new.enc is not distinct from old.enc then
    return new;
  end if;

  -- FOR SHARE: bila rotasi sedang berjalan (FOR UPDATE di apply_vault_rotation), tunggu sampai
  -- selesai lalu baca kunci yang BARU. Tanpa ini, baris baru dari perangkat lain bisa lolos
  -- dengan kunci lama di sela pemeriksaan kelengkapan dan commit rotasi.
  select k.wrapped_key, k.labels_required_at into k_wrapped, k_required
    from public.pw_keys k where k.user_id = new.user_id
    for share;
  if not found then
    raise exception 'Belum ada brankas Sandi untuk akun ini; data terenkripsi ditolak'
      using errcode = '23V03';
  end if;

  ref := substring(new.enc from '^([0-9a-f]{16})\.');
  if ref is null then
    if k_required is not null then
      raise exception 'Data terenkripsi tanpa label kunci ditolak (kunci brankas sudah diganti). Perbarui aplikasi.'
        using errcode = '23V03';
    end if;
    return new;
  end if;

  if ref <> public.vault_key_ref(k_wrapped) then
    raise exception 'Kunci brankas sudah diganti; perubahan yang dienkripsi dengan kunci lama ditolak'
      using errcode = '23V03';
  end if;
  return new;
end;
$$;
revoke all on function public.vault_enc_guard() from public, anon, authenticated;

create trigger vault_enc_guard before insert or update of enc on public.pw_items
  for each row execute function public.vault_enc_guard();
create trigger vault_enc_guard before insert or update of enc on public.pw_totp_log
  for each row execute function public.vault_enc_guard();
create trigger vault_enc_guard before insert or update of enc on public.config_versions
  for each row execute function public.vault_enc_guard();

-- -----------------------------------------------------------------------------
-- 2a. Kunci hanya berubah di dalam apply_vault_rotation
-- -----------------------------------------------------------------------------
create or replace function public.pw_keys_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Brankas baru belum pernah dirotasi; klien tidak boleh mengarang riwayat rotasi
    new.rotated_from := null;
    new.labels_required_at := null;
    return new;
  end if;

  if coalesce(current_setting('taskify.vault_rotation', true), '') <> 'on' then
    if (new.version, new.kdf, new.iterations, new.salt, new.wrapped_key,
        new.recovery_salt, new.recovery_wrapped_key)
       is distinct from
       (old.version, old.kdf, old.iterations, old.salt, old.wrapped_key,
        old.recovery_salt, old.recovery_wrapped_key) then
      -- Upaya ganti kunci di luar RPC (klien versi lama): DINETRALKAN, bukan ditolak (lihat
      -- kepala berkas). Sejak saat ini tulisan tanpa label tidak bisa dipercaya lagi.
      new.version := old.version;
      new.kdf := old.kdf;
      new.iterations := old.iterations;
      new.salt := old.salt;
      new.wrapped_key := old.wrapped_key;
      new.recovery_salt := old.recovery_salt;
      new.recovery_wrapped_key := old.recovery_wrapped_key;
      new.labels_required_at := coalesce(old.labels_required_at, now());
    else
      new.labels_required_at := old.labels_required_at;
    end if;
    new.rotated_from := old.rotated_from;
  end if;
  return new;
end;
$$;
revoke all on function public.pw_keys_guard() from public, anon, authenticated;

create trigger pw_keys_guard before insert or update on public.pw_keys
  for each row execute function public.pw_keys_guard();

-- -----------------------------------------------------------------------------
-- 2b. Rotasi atomik
-- -----------------------------------------------------------------------------
-- p_key  : { id, wrapped_key, rotated_from, salt?, iterations?, kdf?, version?, recovery_salt?,
--            recovery_wrapped_key?, … } — kolom yang tidak dikirim (tidak berubah) dipertahankan.
-- p_rows : [{ t: 'pw_items'|'pw_totp_log'|'config_versions', id, enc: text|null, v: int|null,
--             b: vault_key_ref(enc LAMA yang didekripsi klien) }]
--          enc null = baris dipertimbangkan tetapi isinya tidak diubah (tidak bisa dibuka klien).
--
-- Hasil: { reencrypted } bila diterima; { replayed: true } bila rotasi yang sama sudah diterima;
-- { code: '23V05', message } untuk rotasi format lama (dicatat, lalu dilaporkan sebagai error oleh
-- connector). Penolakan lain = exception (tidak ada yang berubah).
--
-- SECURITY INVOKER: RLS pemilik + mfa_aal2 berlaku seperti tulisan biasa — RPC ini tidak memberi
-- hak tambahan apa pun, hanya menjamin atomik + compare-and-swap + kelengkapan.
create or replace function public.apply_vault_rotation(p_key jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  key_id uuid;
  current_wrapped text;
  missing text;
  n integer := 0;
  c integer;
begin
  if uid is null then
    raise exception 'Butuh sesi login' using errcode = '42501';
  end if;
  if jsonb_typeof(p_key) is distinct from 'object'
     or jsonb_typeof(p_rows) is distinct from 'array'
     or nullif(p_key->>'id', '') is null
     or nullif(p_key->>'wrapped_key', '') is null then
    raise exception 'Bentuk rotasi kunci tidak valid' using errcode = '23V05';
  end if;

  key_id := (p_key->>'id')::uuid;
  -- FOR UPDATE: rotasi lain & tulisan terenkripsi (vault_enc_guard, FOR SHARE) menunggu
  select k.wrapped_key into current_wrapped
    from public.pw_keys k where k.id = key_id and k.user_id = uid
    for update;
  if not found then
    raise exception 'Brankas tidak ditemukan' using errcode = '23V05';
  end if;

  -- Rotasi format lama (tanpa label asal) — antrean klien versi lama yang baru diunggah setelah
  -- aplikasi diperbarui: jangan diterapkan, tetapi CATAT bahwa tulisan tanpa label tidak bisa
  -- dipercaya lagi (tulisan berikutnya di antrean itu memakai DEK yang tidak diterima). Diperiksa
  -- SEBELUM validasi baris (antrean lama tidak punya `b`), dan harus COMMIT → dikembalikan
  -- sebagai hasil, bukan raise.
  if nullif(p_key->>'rotated_from', '') is null then
    perform set_config('taskify.vault_rotation', 'on', true);
    update public.pw_keys k set labels_required_at = coalesce(k.labels_required_at, now())
     where k.id = key_id;
    perform set_config('taskify.vault_rotation', '', true);
    return jsonb_build_object(
      'code', '23V05',
      'message', 'Ganti kunci brankas dari aplikasi versi lama ditolak. Perbarui aplikasi lalu ulangi.');
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
     where jsonb_typeof(e) <> 'object'
        or coalesce(e->>'t', '') not in ('pw_items', 'pw_totp_log', 'config_versions')
        or nullif(e->>'id', '') is null
        -- b = sidik (vault_key_ref) `enc` yang DIDEKRIPSI klien: versi baris yang dirotasi
        or coalesce(e->>'b', '') !~ '^[0-9a-f]{16}$'
  ) then
    raise exception 'Baris rotasi kunci tidak valid' using errcode = '23V05';
  end if;

  -- Respons rotasi ini hilang di jaringan lalu diulang: sudah diterima, jangan laporkan ditolak
  if current_wrapped = p_key->>'wrapped_key' then
    return jsonb_build_object('reencrypted', 0, 'replayed', true);
  end if;

  if p_key->>'rotated_from' <> public.vault_key_ref(current_wrapped) then
    raise exception 'Kunci brankas di server sudah berubah sejak perangkat ini membukanya'
      using errcode = '23V01';
  end if;

  -- Kelengkapan: setiap baris terenkripsi milik user di server harus ada di p_rows
  with provided as (
    select e->>'t' as t, (e->>'id')::uuid as id from jsonb_array_elements(p_rows) e
  )
  select string_agg(m.t, ', ') into missing from (
    select 'pw_items' as t from public.pw_items i
     where i.user_id = uid
       and not exists (select 1 from provided p where p.t = 'pw_items' and p.id = i.id)
    union all
    select 'pw_totp_log' from public.pw_totp_log l
     where l.user_id = uid
       and not exists (select 1 from provided p where p.t = 'pw_totp_log' and p.id = l.id)
    union all
    select 'config_versions' from public.config_versions v
     where v.user_id = uid
       and not exists (select 1 from provided p where p.t = 'config_versions' and p.id = v.id)
    limit 1
  ) m;
  if missing is not null then
    raise exception 'Sinkronisasi belum lengkap: ada data brankas di server (%) yang belum ada di perangkat ini', missing
      using errcode = '23V02';
  end if;

  -- Versi: baris di server harus PERSIS yang dibuka & dienkripsi ulang klien. Edit dari perangkat
  -- lain yang tiba di sela pemeriksaan klien dan RPC ini tidak boleh tertimpa salinan yang basi
  -- (atau, untuk baris yang tidak bisa dibuka klien, dibiarkan dengan kunci yang akan dibuang).
  with provided as (
    select e->>'t' as t, (e->>'id')::uuid as id, e->>'b' as b from jsonb_array_elements(p_rows) e
  )
  select string_agg(m.t, ', ') into missing from (
    select 'pw_items' as t from public.pw_items i join provided p on p.t = 'pw_items' and p.id = i.id
     where i.user_id = uid and public.vault_key_ref(i.enc) <> p.b
    union all
    select 'pw_totp_log' from public.pw_totp_log l join provided p on p.t = 'pw_totp_log' and p.id = l.id
     where l.user_id = uid and public.vault_key_ref(l.enc) <> p.b
    union all
    select 'config_versions' from public.config_versions v
      join provided p on p.t = 'config_versions' and p.id = v.id
     where v.user_id = uid and public.vault_key_ref(v.enc) <> p.b
    limit 1
  ) m;
  if missing is not null then
    raise exception 'Data brankas (%) baru saja diubah di perangkat lain; ulangi setelah sinkron', missing
      using errcode = '23V02';
  end if;

  perform set_config('taskify.vault_rotation', 'on', true);

  update public.pw_keys k set
    version              = coalesce((p_key->>'version')::smallint, k.version),
    kdf                  = coalesce(p_key->>'kdf', k.kdf),
    iterations           = coalesce((p_key->>'iterations')::integer, k.iterations),
    salt                 = coalesce(p_key->>'salt', k.salt),
    wrapped_key          = p_key->>'wrapped_key',
    recovery_salt        = coalesce(p_key->>'recovery_salt', k.recovery_salt),
    recovery_wrapped_key = coalesce(p_key->>'recovery_wrapped_key', k.recovery_wrapped_key),
    rotated_from         = p_key->>'rotated_from',
    labels_required_at   = coalesce(k.labels_required_at, now())
  where k.id = key_id;

  -- Isi baru. Trigger vault_enc_guard memeriksa label tiap baris terhadap kunci yang BARU saja
  -- dipasang di atas (transaksi yang sama). Baris yang sudah tidak ada di server dilewati.
  with x as (
    select (e->>'id')::uuid as id, e->>'enc' as enc, (e->>'v')::smallint as v
      from jsonb_array_elements(p_rows) e where e->>'t' = 'pw_items' and e->>'enc' is not null
  )
  update public.pw_items pi set enc = x.enc, v = coalesce(x.v, pi.v)
    from x where pi.id = x.id and pi.user_id = uid;
  get diagnostics c = row_count; n := n + c;

  with x as (
    select (e->>'id')::uuid as id, e->>'enc' as enc, (e->>'v')::smallint as v
      from jsonb_array_elements(p_rows) e where e->>'t' = 'pw_totp_log' and e->>'enc' is not null
  )
  update public.pw_totp_log tl set enc = x.enc, v = coalesce(x.v, tl.v)
    from x where tl.id = x.id and tl.user_id = uid;
  get diagnostics c = row_count; n := n + c;

  with x as (
    select (e->>'id')::uuid as id, e->>'enc' as enc, (e->>'v')::smallint as v
      from jsonb_array_elements(p_rows) e where e->>'t' = 'config_versions' and e->>'enc' is not null
  )
  update public.config_versions cv set enc = x.enc, v = coalesce(x.v, cv.v)
    from x where cv.id = x.id and cv.user_id = uid;
  get diagnostics c = row_count; n := n + c;

  perform set_config('taskify.vault_rotation', '', true);
  return jsonb_build_object('reencrypted', n);
end;
$$;
revoke all on function public.apply_vault_rotation(jsonb, jsonb) from public, anon;
grant execute on function public.apply_vault_rotation(jsonb, jsonb) to authenticated;
