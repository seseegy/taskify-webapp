import { Check } from 'lucide-react';
import { findNavItem } from '@/app/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

interface Props {
  path: string;
  subtitle: string;
  phase: number;
  emptyTitle: string;
  emptyDescription: string;
  planned: string[];
}

/** Halaman sementara untuk modul yang belum dibangun — menjelaskan apa yang akan hadir. */
export function ModulePlaceholder({
  path,
  subtitle,
  phase,
  emptyTitle,
  emptyDescription,
  planned,
}: Props) {
  const nav = findNavItem(path)!;

  return (
    <>
      <PageHeader
        title={nav.label}
        subtitle={subtitle}
        icon={nav.icon}
        gradient={nav.gradient}
        actions={<Badge tone="neutral">Tahap {phase}</Badge>}
      />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="animate-fade-up">
          <EmptyState
            icon={nav.icon}
            gradient={nav.gradient}
            title={emptyTitle}
            description={emptyDescription}
          />
        </Card>
        <Card className="animate-fade-up">
          <h2 className="mb-3 font-bold">Yang akan hadir</h2>
          <ul className="space-y-2.5">
            {planned.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm">
                <span
                  className={`shine mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white ${nav.gradient}`}
                >
                  <Check className="size-3" />
                </span>
                <span className="text-muted">{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 rounded-xl bg-surface px-3 py-2 text-xs text-muted">
            Tabel database, sinkronisasi, dan keamanan (RLS) untuk modul ini sudah siap.
          </p>
        </Card>
      </div>
    </>
  );
}
