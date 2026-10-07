import { Check, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import type { TaskList } from '@/db/schema';
import { colorLabel } from '@/lib/palette';
import { onRadioGroupKeyDown, radioTabIndex } from '@/lib/radio-group';
import { cn } from '@/lib/utils';
import { useTaskActions } from '../task-actions';
import { LIST_COLORS, type ListColor } from '../task-utils';

interface Props {
  open: boolean;
  onClose: () => void;
  /** null = buat daftar baru */
  list: TaskList | null;
  onCreated?: (id: string) => void;
  onDeleted?: () => void;
}

export function ListDialog(props: Props) {
  // key → state form di-reset setiap dialog dibuka untuk daftar berbeda
  return <ListDialogInner key={`${props.open}-${props.list?.id ?? 'new'}`} {...props} />;
}

function ListDialogInner({ open, onClose, list, onCreated, onDeleted }: Props) {
  const actions = useTaskActions();
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState<string>(list?.color ?? 'violet');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (list) await actions.updateList(list.id, { name: name.trim(), color });
    else onCreated?.(await actions.createList(name, color));
    onClose();
  };

  const remove = async () => {
    if (!list) return;
    if (!window.confirm(`Hapus daftar "${list.name}"? Tugas di dalamnya pindah ke "Tanpa daftar".`))
      return;
    await actions.removeList(list.id);
    onDeleted?.();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      title={list ? 'Ubah daftar' : 'Daftar baru'}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="list-name">Nama</Label>
          <Input
            id="list-name"
            value={name}
            maxLength={80}
            data-autofocus
            placeholder="mis. Kerja, Rumah, Belanja"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <p id="list-color-label" className="mb-1.5 text-sm font-semibold">
            Warna
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-labelledby="list-color-label"
            onKeyDown={onRadioGroupKeyDown}
          >
            {(Object.keys(LIST_COLORS) as ListColor[]).map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-label={colorLabel(c)}
                aria-checked={color === c}
                tabIndex={radioTabIndex(color === c, color in LIST_COLORS, i)}
                onClick={() => setColor(c)}
                className={cn(
                  'flex size-9 items-center justify-center rounded-full text-white transition',
                  LIST_COLORS[c].dot,
                  color === c ? 'scale-110 ring-4 ring-primary/30' : 'opacity-80 hover:opacity-100',
                )}
              >
                {color === c && <Check className="size-4" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          {list ? (
            <Button variant="ghost" className="text-danger" onClick={() => void remove()}>
              <Trash2 /> Hapus
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={!name.trim()}>
            {list ? 'Simpan' : 'Buat daftar'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
