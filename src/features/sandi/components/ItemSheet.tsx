import { ExternalLink, Eye, EyeOff, Pencil, Star, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { FieldError } from '@/components/ui/FieldError';
import { Textarea } from '@/components/ui/Field';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { useSheetDirty } from '@/components/ui/sheet-dirty';
import { toast } from '@/components/ui/toast-store';
import { isoToLocal, relativeDayLabel } from '@/lib/date';
import { focusField } from '@/lib/focus';
import { cn } from '@/lib/utils';
import { EMPTY_PAYLOAD, type ItemPayload } from '../crypto';
import { estimatePasswordStrength } from '../generator';
import type { DecryptedItem } from '../sandi-data';
import { displayHost, safeUrl } from '../url';
import { CopyButton } from './CopyButton';
import { GeneratorPanel } from './GeneratorPanel';
import { Avatar } from './ItemRow';
import { PasswordField } from './PasswordField';
import { StrengthMeter } from './StrengthMeter';
import { Switch } from '@/components/ui/Switch';
import { TotpCode } from './TotpCode';
import { TotpField } from './TotpField';

const REVEAL_MS = 15_000;

/**
 * Panel sandi. `item` null + open = sandi baru. Setelah disimpan, panel ditutup dan daftar
 * (yang reaktif) menampilkan hasilnya.
 */
export function ItemSheet({
  open,
  item,
  onClose,
  onSave,
  onDelete,
  onUseCode,
}: {
  open: boolean;
  item: DecryptedItem | null;
  onClose: () => void;
  onSave: (payload: ItemPayload, id?: string) => Promise<unknown>;
  onDelete: (item: DecryptedItem) => Promise<void>;
  /** Kode TOTP item ini disalin — dicatat ke riwayat. */
  onUseCode: (item: DecryptedItem, code: string) => void;
}) {
  const title = item ? item.payload.title || 'Tanpa judul' : 'Sandi baru';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        item ? (
          <span className="flex min-w-0 items-center gap-3">
            <Avatar title={title} />
            <span className="truncate">{title}</span>
          </span>
        ) : (
          title
        )
      }
    >
      {open && (
        <ItemBody
          key={item?.id ?? 'baru'}
          item={item}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
          onUseCode={onUseCode}
        />
      )}
    </Sheet>
  );
}

function ItemBody({
  item,
  onClose,
  onSave,
  onDelete,
  onUseCode,
}: {
  item: DecryptedItem | null;
  onClose: () => void;
  onSave: (payload: ItemPayload, id?: string) => Promise<unknown>;
  onDelete: (item: DecryptedItem) => Promise<void>;
  onUseCode: (item: DecryptedItem, code: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(item ? 'view' : 'edit');
  if (mode === 'edit')
    return (
      <ItemForm
        item={item}
        onCancel={() => (item ? setMode('view') : onClose())}
        onSave={onSave}
        onSaved={onClose}
      />
    );
  return (
    <ItemView
      item={item!}
      onEdit={() => setMode('edit')}
      onDelete={onDelete}
      onClose={onClose}
      onUseCode={onUseCode}
    />
  );
}

// ============================================================================ lihat
function Field({
  label,
  children,
  actions,
}: {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 rounded-2xl p-3 glass">
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold text-muted">{label}</dt>
        <dd className="mt-0.5 text-sm break-words">{children}</dd>
      </div>
      {actions && <div className="flex shrink-0">{actions}</div>}
    </div>
  );
}

function ItemView({
  item,
  onEdit,
  onDelete,
  onClose,
  onUseCode,
}: {
  item: DecryptedItem;
  onEdit: () => void;
  onDelete: (item: DecryptedItem) => Promise<void>;
  onClose: () => void;
  onUseCode: (item: DecryptedItem, code: string) => void;
}) {
  const p = item.payload;
  const name = p.title || 'Tanpa judul';
  const [reveal, setReveal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const href = p.url ? safeUrl(p.url) : null;

  // Sandi tersembunyi lagi otomatis: layar yang ditinggalkan tidak menampilkannya terus
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setReveal(false), REVEAL_MS);
    return () => clearTimeout(t);
  }, [reveal]);

  return (
    <div className="space-y-3">
      <dl className="space-y-3">
        {p.username && (
          <Field
            label="Username"
            actions={
              <CopyButton value={p.username} label={`Salin username ${name}`} what="Username" />
            }
          >
            <span className="font-medium">{p.username}</span>
          </Field>
        )}

        <Field
          label="Sandi"
          actions={
            <>
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                aria-pressed={reveal}
                aria-label={reveal ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                className="flex size-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-fg"
              >
                {reveal ? (
                  <EyeOff className="size-[18px]" aria-hidden="true" />
                ) : (
                  <Eye className="size-[18px]" aria-hidden="true" />
                )}
              </button>
              <CopyButton value={p.password} label={`Salin sandi ${name}`} what="Sandi" secret />
            </>
          }
        >
          {p.password ? (
            reveal ? (
              <span className="font-mono text-base font-semibold break-all select-all">
                {p.password}
              </span>
            ) : (
              // Jumlah titik tetap: tidak membocorkan panjang sandi
              <span aria-label="Sandi disembunyikan" className="tracking-widest">
                ••••••••••••
              </span>
            )
          ) : (
            <span className="text-muted">Tidak ada sandi</span>
          )}
        </Field>

        {p.totp && (
          <Field label="Kode TOTP">
            <TotpCode config={p.totp} name={name} onUse={(code) => onUseCode(item, code)} />
          </Field>
        )}

        {p.url && (
          <Field
            label="Situs"
            actions={
              href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Buka ${displayHost(p.url)} di tab baru`}
                  className="flex size-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-fg"
                >
                  <ExternalLink className="size-[18px]" aria-hidden="true" />
                </a>
              )
            }
          >
            {href ? displayHost(p.url) : <span>{p.url}</span>}
            {!href && <span className="block text-xs text-muted">Bukan alamat web yang valid</span>}
          </Field>
        )}

        {p.notes && (
          <Field label="Catatan">
            <span className="whitespace-pre-wrap">{p.notes}</span>
          </Field>
        )}
      </dl>

      <p className="px-1 text-xs text-muted">
        Diubah {relativeDayLabel(isoToLocal(item.updated_at).date).toLowerCase()}
      </p>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        {confirming ? (
          <div
            role="alertdialog"
            aria-label="Konfirmasi hapus"
            className="flex flex-1 flex-wrap items-center gap-2"
          >
            <span className="text-sm font-semibold">Hapus sandi ini?</span>
            <Button
              variant="ghost"

              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Batal
            </Button>
            <Button
              variant="danger"

              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                await onDelete(item);
                onClose();
              }}
            >
              <Trash2 aria-hidden="true" /> Ya, hapus
            </Button>
          </div>
        ) : (
          <>
            <Button variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden="true" /> Hapus
            </Button>
            <Button onClick={onEdit}>
              <Pencil aria-hidden="true" /> Ubah
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================ ubah / baru
function ItemForm({
  item,
  onCancel,
  onSave,
  onSaved,
}: {
  item: DecryptedItem | null;
  onCancel: () => void;
  onSave: (payload: ItemPayload, id?: string) => Promise<unknown>;
  onSaved: () => void;
}) {
  const initial = item?.payload ?? EMPTY_PAYLOAD;
  const [p, setP] = useState<ItemPayload>(initial);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof ItemPayload>(k: K, v: ItemPayload[K]) =>
    setP((s) => ({ ...s, [k]: v }));
  useSheetDirty(JSON.stringify(p) !== JSON.stringify(initial));

  const strength = p.password ? estimatePasswordStrength(p.password) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!p.title.trim()) {
      setTitleError('Isi judul agar mudah dicari.');
      return focusField('item-title');
    }
    setSaving(true);
    setFailure(null);
    try {
      await onSave(
        { ...p, title: p.title.trim(), url: p.url.trim(), username: p.username.trim() },
        item?.id,
      );
      toast(item ? 'Sandi disimpan' : 'Sandi ditambahkan', { tone: 'success' });
      onSaved();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Gagal menyimpan.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="item-title">Judul</Label>
        <Input
          id="item-title"
          data-autofocus={item ? undefined : ''}
          value={p.title}
          maxLength={200}
          placeholder="mis. GitHub"
          autoComplete="off"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'item-title-err' : undefined}
          onChange={(e) => {
            set('title', e.target.value);
            if (titleError) setTitleError(null);
          }}
        />
        <FieldError id="item-title-err">{titleError}</FieldError>
      </div>

      <div>
        <Label htmlFor="item-url">Alamat situs</Label>
        <Input
          id="item-url"
          value={p.url}
          maxLength={2000}
          inputMode="url"
          placeholder="github.com/login"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => set('url', e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="item-username">Username / email</Label>
        <Input
          id="item-username"
          value={p.username}
          maxLength={500}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => set('username', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <PasswordField
          id="item-password"
          label="Sandi"
          mono
          maxLength={1000}
          // new-password: cegah browser mengisi password akun Taskify ke kolom ini
          autoComplete="new-password"
          value={p.password}
          onChange={(e) => set('password', e.target.value)}
        />
        {strength && <StrengthMeter strength={strength} />}
        <Button
          type="button"
          variant="secondary"

          aria-expanded={showGen}
          aria-controls="item-generator"
          onClick={() => setShowGen((s) => !s)}
        >
          <Wand2 aria-hidden="true" /> {showGen ? 'Tutup pembuat sandi' : 'Buat sandi acak'}
        </Button>
        {showGen && (
          <div id="item-generator" className="pt-1">
            <GeneratorPanel
              compact
              onUse={(v) => {
                set('password', v);
                setShowGen(false);
                focusField('item-password');
              }}
            />
          </div>
        )}
      </div>

      <TotpField value={p.totp} name={p.title} onChange={(totp) => set('totp', totp)} />

      <div>
        <Label htmlFor="item-notes">Catatan</Label>
        <Textarea
          id="item-notes"
          value={p.notes}
          maxLength={10_000}
          rows={3}
          placeholder="Pertanyaan keamanan, kode cadangan…"
          onChange={(e) => set('notes', e.target.value)}
        />
      </div>

      <Switch
        label={
          <span className="flex items-center gap-1.5">
            <Star
              className={cn('size-4', p.favorite && 'fill-amber-400 text-amber-400')}
              aria-hidden="true"
            />
            Favorit
          </span>
        }
        hint="Tampil di bagian atas daftar"
        checked={p.favorite}
        onChange={(v) => set('favorite', v)}
        className="-mx-3"
      />

      {failure && (
        <p role="alert" className="text-sm font-medium text-danger">
          {failure}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
        <Button type="submit" loading={saving}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
