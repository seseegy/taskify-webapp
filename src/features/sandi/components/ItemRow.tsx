import { KeyRound, Star, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarGradient, avatarInitial } from '../avatar';
import type { DecryptedItem } from '../sandi-data';
import { displayHost } from '../url';
import { CopyButton } from './CopyButton';

export function Avatar({ title, className }: { title: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br text-base font-bold text-white shadow-sm',
        avatarGradient(title),
        className,
      )}
    >
      {avatarInitial(title)}
    </span>
  );
}

/**
 * Satu baris sandi. Tombol buka dan tombol salin adalah SAUDARA (bukan bersarang) agar tiap
 * kontrol punya nama aksesibel sendiri dan bisa dijangkau keyboard.
 */
export function ItemRow({ item, onOpen }: { item: DecryptedItem; onOpen: () => void }) {
  const p = item.payload;
  const name = p.title || 'Tanpa judul';
  const secondary = p.username || (p.url ? displayHost(p.url) : '');

  return (
    <li className="flex items-center gap-1 rounded-2xl p-1.5 glass transition hover:bg-surface-strong">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left"
      >
        <Avatar title={name} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="truncate">{name}</span>
            {p.favorite && (
              <>
                <Star
                  className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                  aria-hidden="true"
                />
                <span className="sr-only">(favorit)</span>
              </>
            )}
          </span>
          {secondary && <span className="block truncate text-xs text-muted">{secondary}</span>}
        </span>
      </button>
      <div className="flex shrink-0">
        {p.username && (
          <CopyButton
            value={p.username}
            label={`Salin username ${name}`}
            what="Username"
            icon={UserRound}
            className="hidden sm:flex"
          />
        )}
        <CopyButton
          value={p.password}
          label={`Salin sandi ${name}`}
          what="Sandi"
          icon={KeyRound}
          secret
        />
      </div>
    </li>
  );
}
