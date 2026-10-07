import { CalendarDays, CodeXml, Eye, EyeOff, ListChecks, NotebookPen, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FieldError } from '@/components/ui/FieldError';
import { Input, Label } from '@/components/ui/Input';
import { focusField } from '@/lib/focus';
import { useAuth } from './auth-context';

const FEATURES = [
  { icon: ListChecks, gradient: 'bg-gradient-tasks', label: 'Tugas' },
  { icon: NotebookPen, gradient: 'bg-gradient-journal', label: 'Jurnal' },
  { icon: Wallet, gradient: 'bg-gradient-finance', label: 'Keuangan' },
  { icon: CalendarDays, gradient: 'bg-gradient-calendar', label: 'Kalender' },
  { icon: CodeXml, gradient: 'bg-gradient-vault', label: 'Vault' },
];

function translateError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Email atau kata sandi salah.';
  if (/email not confirmed/i.test(message)) return 'Email belum dikonfirmasi.';
  if (/failed to fetch|network/i.test(message))
    return 'Tidak bisa terhubung ke server. Login pertama kali butuh internet.';
  return message;
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Validasi di sini (bukan tombol disabled tanpa alasan): tiap kolom yang kosong dijelaskan
    const next: typeof fieldErrors = {};
    if (!email.trim()) next.email = 'Isi email';
    if (!password) next.password = 'Isi kata sandi';
    setFieldErrors(next);
    if (next.email || next.password) return focusField(next.email ? 'email' : 'password');
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(translateError(err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-5">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight">
            Selamat datang di <span className="text-gradient-brand">Taskify</span>
          </h1>
          <p className="mt-2 text-sm text-muted">Semua aktivitasmu, dalam satu tempat.</p>
          <div className="mt-5 flex gap-2" aria-hidden="true">
            {FEATURES.map((f) => (
              <span
                key={f.label}
                title={f.label}
                className={`shine flex size-9 items-center justify-center rounded-xl text-white shadow-md ${f.gradient}`}
              >
                <f.icon className="size-4" />
              </span>
            ))}
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="kamu@email.com"
                value={email}
                aria-invalid={!!fieldErrors.email || undefined}
                aria-describedby={fieldErrors.email ? 'email-err' : undefined}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (e.target.value.trim()) setFieldErrors((f) => ({ ...f, email: undefined }));
                }}
                required
              />
              <FieldError id="email-err">{fieldErrors.email}</FieldError>
            </div>
            <div>
              <Label htmlFor="password">Kata sandi</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  aria-invalid={!!fieldErrors.password || undefined}
                  aria-describedby={fieldErrors.password ? 'password-err' : undefined}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (e.target.value) setFieldErrors((f) => ({ ...f, password: undefined }));
                  }}
                  className="pr-12"
                  required
                />
                {/* Label tetap + aria-pressed (bukan label yang berganti) */}
                <button
                  type="button"
                  aria-label="Tampilkan kata sandi"
                  aria-pressed={showPassword}
                  // jaga fokus & posisi kursor di kolom sandi
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:text-fg"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <FieldError id="password-err">{fieldErrors.password}</FieldError>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Masuk
            </Button>
            <p role="status" className="sr-only">
              {loading ? 'Sedang masuk…' : ''}
            </p>
          </form>
        </Card>
        <p className="mt-5 text-center text-xs text-muted">
          Aplikasi pribadi — pendaftaran akun baru dinonaktifkan.
        </p>
      </div>
    </div>
  );
}
