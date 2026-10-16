import { Copy, KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Disclosure } from '@/components/ui/Disclosure';
import { Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast-store';
import { copySecret } from '@/features/sandi/clipboard';
import { supabase } from '@/lib/supabase';
import { useAuth } from './auth-context';
import { isTotpCode, normalizeTotpCode, translateMfaError, type MfaStatus } from './mfa';

/**
 * Layar penuh pengganti aplikasi selama sesi belum aal2 (lihat mfa.ts). Database lokal & sync
 * BELUM dibuka di sini, jadi tidak ada data yang tampil atau tersinkron dengan token aal1.
 */
export function MfaScreen({ status }: { status: Exclude<MfaStatus, 'ok'> }) {
  const { signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size="lg" />
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight">
            {status === 'challenge' ? 'Verifikasi dua langkah' : 'Aktifkan verifikasi dua langkah'}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {status === 'challenge'
              ? 'Masukkan kode 6 digit dari aplikasi authenticator di HP-mu.'
              : 'Taskify menyimpan jurnal, keuangan, dan brankas sandi. Agar password yang bocor saja tidak cukup untuk membukanya, setiap login wajib memakai kode dari aplikasi authenticator.'}
          </p>
        </div>

        <Card className="p-6">{status === 'challenge' ? <MfaChallenge /> : <MfaEnrollGate />}</Card>

        <div className="mt-5 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={leaving}
            onClick={async () => {
              setLeaving(true);
              try {
                await signOut();
              } catch (e) {
                toast(translateMfaError(e), { tone: 'danger' });
              } finally {
                setLeaving(false);
              }
            }}
          >
            <LogOut /> Keluar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================ kode masuk
function MfaChallenge() {
  const { state, verifyMfa } = useAuth();
  // Faktor dibaca dari sesi tersimpan → layar ini tampil walau offline (verifikasinya tetap online)
  const factors =
    state.status === 'signed_in'
      ? (state.user.factors ?? []).filter(
          (f) => f.status === 'verified' && f.factor_type === 'totp',
        )
      : [];
  const [factorId, setFactorId] = useState(factors[0]?.id ?? '');

  return (
    <div className="space-y-4">
      {factors.length > 1 && (
        <div>
          <Label htmlFor="mfa-factor">Authenticator</Label>
          <select
            id="mfa-factor"
            value={factorId}
            onChange={(e) => setFactorId(e.target.value)}
            className="h-11 w-full rounded-xl px-3 text-sm text-fg glass"
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.friendly_name || 'Authenticator'}
              </option>
            ))}
          </select>
        </div>
      )}
      <CodeForm submitLabel="Verifikasi" onSubmit={(code) => verifyMfa(factorId, code)} />
      <LostDeviceHelp />
    </div>
  );
}

function LostDeviceHelp() {
  return (
    <Disclosure summary="HP dengan authenticator hilang?" summaryClassName="text-sm text-muted">
      <div className="mt-2 space-y-2 text-sm text-muted">
        <p>
          Kalau kamu mendaftarkan authenticator cadangan (Pengaturan → Verifikasi dua langkah),
          pilih yang itu di atas.
        </p>
        <p>
          Kalau tidak ada, pemilik project Supabase bisa menghapus faktor MFA akun ini lewat SQL
          Editor, lalu login dan daftarkan authenticator baru. Langkahnya ada di docs/SETUP.md
          bagian “Verifikasi dua langkah”.
        </p>
      </div>
    </Disclosure>
  );
}

// ============================================================================ pendaftaran wajib
/**
 * Sebelum mendaftar, pastikan sesi tidak usang: bila akun SUDAH punya authenticator (didaftarkan
 * di perangkat lain) tetapi sesi ini belum tahu, segarkan sesi → status berubah jadi `challenge`.
 * Tanpa ini pengguna diminta mendaftar ulang dan server menolaknya.
 */
function MfaEnrollGate() {
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.mfa.listFactors();
        if (data?.totp.some((f) => f.status === 'verified')) {
          await supabase.auth.refreshSession();
          return;
        }
      } catch {
        /* offline: pendaftaran di bawah akan menampilkan pesan yang jelas */
      }
      if (alive) setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (checking) return <p className="text-sm text-muted">Memeriksa status akun…</p>;
  return <TotpEnroll defaultName="HP utama" />;
}

/**
 * Pendaftaran satu authenticator TOTP: QR/kunci → kode pertama → terverifikasi. Dipakai di layar
 * wajib (authenticator pertama) dan di Pengaturan (authenticator cadangan).
 */
export function TotpEnroll({
  defaultName,
  onDone,
}: {
  defaultName: string;
  /** Dipanggil setelah terverifikasi. Untuk pendaftaran pertama, sesi berubah aal2 sendiri. */
  onDone?: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factor, setFactor] = useState<{
    id: string;
    qr: string;
    secret: string;
    uri: string;
  } | null>(null);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setStarting(true);
    try {
      // Sisa pendaftaran yang dulu tidak diselesaikan (unverified) dibuang dulu: tiap akun punya
      // batas jumlah faktor, dan nama faktor harus unik.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const friendlyName = name.trim() || defaultName;
      if (list?.all.some((f) => f.status === 'verified' && f.friendly_name === friendlyName)) {
        setError('Nama itu sudah dipakai authenticator lain. Pakai nama lain.');
        return;
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName,
        issuer: 'Taskify',
      });
      if (err) throw err;
      setFactor({
        id: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
    } catch (e2) {
      setError(translateMfaError(e2));
    } finally {
      setStarting(false);
    }
  };

  const verify = async (code: string) => {
    if (!factor) return;
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });
    if (err) throw err;
    toast('Verifikasi dua langkah aktif', { tone: 'success' });
    onDone?.();
  };

  if (!factor)
    return (
      <form onSubmit={start} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Pasang aplikasi authenticator (Google Authenticator, Aegis, 2FAS, 1Password, dll.).
          </li>
          <li>Pindai kode QR yang muncul berikutnya.</li>
          <li>Masukkan kode 6 digit dari aplikasinya.</li>
        </ol>
        <div>
          <Label htmlFor="mfa-name">Nama authenticator</Label>
          <Input
            id="mfa-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
          />
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <Button type="submit" size="lg" className="w-full" loading={starting}>
          <ShieldCheck /> Lanjut
        </Button>
      </form>
    );

  return (
    <div className="space-y-4">
      {/* Latar putih tetap: pemindai QR butuh kontras gelap-di-atas-terang, juga di tema gelap */}
      <div className="mx-auto w-fit rounded-2xl bg-white p-3">
        <img src={factor.qr} alt="Kode QR untuk aplikasi authenticator" className="size-48" />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <a
          href={factor.uri}
          className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-primary glass"
        >
          <Smartphone className="size-4" /> Buka di authenticator (HP ini)
        </a>
      </div>
      <Disclosure summary="Tidak bisa memindai? Masukkan kunci manual" summaryClassName="text-sm">
        <div className="mt-2 flex items-center gap-2 rounded-xl p-2 glass">
          <code className="min-w-0 flex-1 font-mono text-sm break-all select-all">
            {factor.secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Salin kunci"
            onClick={async () => {
              const ok = await copySecret(factor.secret);
              toast(ok ? 'Kunci disalin' : 'Gagal menyalin', { tone: ok ? 'success' : 'danger' });
            }}
          >
            <Copy />
          </Button>
        </div>
      </Disclosure>
      <CodeForm submitLabel="Aktifkan" onSubmit={verify} />
    </div>
  );
}

// ============================================================================ bersama
function CodeForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = normalizeTotpCode(code);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isTotpCode(clean)) {
      setError('Kode terdiri dari 6 angka.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(clean);
    } catch (e2) {
      setError(translateMfaError(e2));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="mfa-code">Kode 6 digit</Label>
        <Input
          id="mfa-code"
          data-autofocus
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          className="text-center font-mono text-lg tracking-[0.4em]"
        />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={clean.length < 6}>
        <KeyRound /> {submitLabel}
      </Button>
    </form>
  );
}

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
