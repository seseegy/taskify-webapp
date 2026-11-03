import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Logo } from './Logo';

interface Props {
  title?: string;
  message?: string;
  action?: { label: string; onClick: () => void };
}

/** Layar penuh untuk loading / error fatal sebelum aplikasi siap. */
export function SplashScreen({ title, message, action }: Props) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo size="lg" />
      {title && <h1 className="text-xl font-semibold">{title}</h1>}
      {message && (
        <p className="flex max-w-md items-center gap-2 text-sm text-muted">
          {!action && <Loader2 className="size-4 animate-spin" />}
          {message}
        </p>
      )}
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
