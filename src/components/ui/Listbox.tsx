import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { computePlacement, nextIndex, seek, typeaheadIndex, type NavOption } from './listbox-nav';

export interface ListboxOption extends NavOption {
  /** Judul kelompok; opsi berurutan dengan judul sama digabung (pengganti <optgroup>). */
  group?: string;
}

/** Lompat-ketik dianggap selesai setelah jeda ini. */
const TYPEAHEAD_RESET_MS = 600;

/**
 * Daftar pilihan dengan tampilan milik aplikasi, pengganti `<select>`.
 *
 * KENAPA ADA: daftar popup `<select>` digambar sistem operasi — hanya warnanya yang bisa
 * diatur, dan hasilnya berbeda di setiap browser. Di sini panelnya milik kita sepenuhnya.
 *
 * KENAPA PAKAI `popover`: enam berkas memakai daftar ini DI DALAM `Sheet`, yang merupakan
 * `<dialog>` modal. Portal ke `document.body` akan dirender DI BAWAH backdrop dialog (hanya
 * isi dialog yang berada di top layer), jadi panelnya tidak akan terlihat. Atribut `popover`
 * menempatkan panel di top layer sehingga tampil di atas dialog, dan tidak terpotong oleh
 * `overflow-y-auto` milik Sheet. Bonusnya: tutup-saat-klik-luar dan Esc ditangani browser.
 *
 * AKSESIBILITAS: pola combobox ARIA. Fokus TIDAK pernah pindah ke dalam panel; ia tetap di
 * tombol pemicu, dan opsi yang sedang disorot ditunjuk `aria-activedescendant`. Ini jauh lebih
 * sederhana daripada memindahkan fokus, dan menghindari jebakan fokus di dalam dialog.
 */
export function Listbox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Pilih…',
  disabled,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ListboxOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** Dipakai bila tidak ada <Label> yang menunjuk ke `id` (mis. kolom penyaring). */
  'aria-label'?: string;
}) {
  const uid = useId();
  const listId = `${id ?? uid}-list`;
  const optionId = (i: number) => `${id ?? uid}-opt-${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buffer: '', timer: 0 });

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const selected = options.findIndex((o) => o.value === value);
  const selectedLabel = selected >= 0 ? options[selected]?.label : undefined;

  const reposition = () => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const rect = trigger.getBoundingClientRect();
    const p = computePlacement(rect, window.innerHeight, options.length);
    popup.style.left = `${p.left}px`;
    popup.style.top = `${p.top}px`;
    popup.style.width = `${p.width}px`;
    popup.style.maxHeight = `${p.maxHeight}px`;
  };

  /** Browser juga bisa menutup panel sendiri (klik luar / Esc), jadi state disetel dari event. */
  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const onToggle = (e: Event) => {
      const next = (e as Event & { newState?: string }).newState === 'open';
      setOpen(next);
      if (next) {
        reposition();
        setActive(selected >= 0 ? selected : seek(options, 0, 1));
      }
    };
    popup.addEventListener('toggle', onToggle);
    return () => popup.removeEventListener('toggle', onToggle);
    // reposition & nilai terpilih dibaca saat event terjadi, bukan saat efek dipasang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, options]);

  /** Panel memakai posisi viewport, jadi harus mengikuti saat halaman/Sheet digulir. */
  useEffect(() => {
    if (!open) return;
    const handle = () => reposition();
    // capture: ikut menangkap gulir dari wadah di dalam (mis. isi Sheet)
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Jaga opsi yang disorot tetap terlihat saat digulir dengan panah. */
  useEffect(() => {
    if (!open || active < 0) return;
    popupRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    if (disabled) return;
    const popup = popupRef.current;
    if (!popup || popup.matches(':popover-open')) return;
    reposition();
    popup.showPopover();
  };

  const hide = () => popupRef.current?.hidePopover();

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    hide();
    triggerRef.current?.focus();
  };

  const runTypeahead = (char: string) => {
    const t = typeahead.current;
    window.clearTimeout(t.timer);
    t.buffer += char.toLowerCase();
    t.timer = window.setTimeout(() => (t.buffer = ''), TYPEAHEAD_RESET_MS);

    const found = typeaheadIndex(options, t.buffer, active);
    if (found >= 0) setActive(found);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    // Enter/Spasi pada <button> menghasilkan klik, dan klik itu akan men-toggle popover lewat
    // `popovertarget`. Saat panel terbuka kita ingin MEMILIH, bukan menutup — jadi default
    // dicegah supaya klik tidak pernah terjadi.
    if (open && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (e.key === ' ' && typeahead.current.buffer !== '') return runTypeahead(' ');
      pick(active);
      return;
    }

    if (e.key === 'Escape' && open) {
      e.preventDefault();
      hide();
      return;
    }

    // Tab keluar: panel ditutup, pilihan dibiarkan apa adanya.
    if (e.key === 'Tab' && open) {
      hide();
      return;
    }

    const moved = nextIndex(options, active, e.key);
    if (moved !== null) {
      e.preventDefault();
      if (!open) show();
      if (moved >= 0) setActive(moved);
      return;
    }

    // Huruf/angka: lompat-ketik. Panel dibuka dulu supaya hasilnya terlihat.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!open) show();
      runTypeahead(e.key);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        disabled={disabled}
        popoverTarget={listId}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-xl px-3.5 text-left text-sm text-fg glass transition',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:cursor-not-allowed disabled:opacity-60',
          ariaInvalid && 'border-danger/60',
          className,
        )}
      >
        <span
          className={cn('min-w-0 flex-1 truncate', selectedLabel === undefined && 'text-muted')}
        >
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      <div
        ref={popupRef}
        id={listId}
        popover="auto"
        role="listbox"
        aria-label={ariaLabel ?? placeholder}
        className="fixed m-0 overflow-y-auto overscroll-contain rounded-xl p-1 glass-strong"
      >
        {options.map((option, i) => {
          // Judul kelompok muncul saat berbeda dari opsi sebelumnya — diturunkan, bukan
          // disimpan di variabel yang berubah selama render.
          const header = option.group !== undefined && option.group !== options[i - 1]?.group;
          return (
            <div key={option.value || `empty-${i}`}>
              {header && (
                <div
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-xs font-bold tracking-wide text-muted"
                >
                  {option.group}
                </div>
              )}
              <div
                role="option"
                id={optionId(i)}
                data-index={i}
                aria-selected={i === selected}
                aria-disabled={option.disabled}
                onClick={() => pick(i)}
                onPointerMove={() => !option.disabled && setActive(i)}
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm',
                  i === active && 'bg-surface-strong',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {i === selected && (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
