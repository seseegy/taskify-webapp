import { CalendarDays, CodeXml, ListChecks, NotebookPen, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { TypedText } from '@/components/ui/TypedText';
import { useAuth } from './auth-context';
import { loginGreeting, readLoginName } from './display-name';

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
  // Dibaca SEKALI saat mount dari penyimpanan perangkat (belum ada sesi/database di layar ini).
  const [greeting] = useState(() => loginGreeting(readLoginName()));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
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
          <TypedText
            as="h1"
            className="mt-5 text-3xl font-extrabold tracking-tight"
            text={greeting.text}
            accent={greeting.accent}
            accentClassName="text-gradient-brand"
            onceKey="taskify-fx-login-greet"
          />
          <p className="mt-2 text-sm text-muted">Semua aktivitasmu, dalam satu tempat.</p>
          <div className="mt-5 flex gap-2">
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
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Kata sandi</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={loading}
              disabled={!email || !password}
            >
              Masuk
            </Button>
          </form>
        </Card>
        <p className="mt-5 text-center text-xs text-muted">
          Aplikasi pribadi — pendaftaran akun baru dinonaktifkan.
        </p>
      </div>
    </div>
  );
}
