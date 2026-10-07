import {
  Bold,
  Code,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pencil,
  Quote,
} from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Markdown } from '@/components/ui/Markdown';
import { cn } from '@/lib/utils';
import { toggleChecklistLine } from '../journal-utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

type Action =
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  | { kind: 'line'; prefix: string };

const TOOLS: { label: string; icon: typeof Bold; action: Action; key?: string }[] = [
  {
    label: 'Tebal (Ctrl+B)',
    icon: Bold,
    action: { kind: 'wrap', before: '**', after: '**', placeholder: 'teks tebal' },
    key: 'b',
  },
  {
    label: 'Miring (Ctrl+I)',
    icon: Italic,
    action: { kind: 'wrap', before: '_', after: '_', placeholder: 'teks miring' },
    key: 'i',
  },
  { label: 'Judul', icon: Heading2, action: { kind: 'line', prefix: '## ' } },
  { label: 'Daftar', icon: List, action: { kind: 'line', prefix: '- ' } },
  { label: 'Daftar bernomor', icon: ListOrdered, action: { kind: 'line', prefix: '1. ' } },
  { label: 'Checklist', icon: ListChecks, action: { kind: 'line', prefix: '- [ ] ' } },
  { label: 'Kutipan', icon: Quote, action: { kind: 'line', prefix: '> ' } },
  {
    label: 'Kode',
    icon: Code,
    action: { kind: 'wrap', before: '`', after: '`', placeholder: 'kode' },
  },
  {
    label: 'Tautan (Ctrl+K)',
    icon: Link2,
    action: { kind: 'wrap', before: '[', after: '](https://)', placeholder: 'teks' },
    key: 'k',
  },
];

/** Editor Markdown: textarea + toolbar + pratinjau. Enter melanjutkan daftar otomatis. */
export function MarkdownEditor({ value, onChange, placeholder }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const uid = useId();

  const apply = (action: Action) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    let next: string;
    let selStart: number;
    let selEnd: number;
    if (action.kind === 'wrap') {
      // Spasi di tepi seleksi tetap di luar penanda ("**kata** " bukan "**kata **")
      const raw = value.slice(s, e);
      const lead = raw.match(/^\s*/)![0];
      const trail = raw.slice(lead.length).match(/\s*$/)![0];
      const selected = raw.trim() || action.placeholder;
      next =
        value.slice(0, s) + lead + action.before + selected + action.after + trail + value.slice(e);
      selStart = s + lead.length + action.before.length;
      selEnd = selStart + selected.length;
    } else {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const has = value.startsWith(action.prefix, lineStart);
      next = has
        ? value.slice(0, lineStart) + value.slice(lineStart + action.prefix.length)
        : value.slice(0, lineStart) + action.prefix + value.slice(lineStart);
      const delta = has ? -action.prefix.length : action.prefix.length;
      selStart = Math.max(lineStart, s + delta);
      selEnd = Math.max(lineStart, e + delta);
    }
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
      const tool = TOOLS.find((t) => t.key === ev.key.toLowerCase());
      if (tool) {
        ev.preventDefault();
        apply(tool.action);
        return;
      }
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      const el = ev.currentTarget;
      const pos = el.selectionStart;
      if (pos !== el.selectionEnd) return;
      const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
      const line = value.slice(lineStart, pos);
      const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. |> )(.*)$/);
      if (!m) return;
      ev.preventDefault();
      const [, indent = '', marker = '', num, rest = ''] = m;
      if (!rest.trim()) {
        // Item kosong → akhiri daftar
        const next = value.slice(0, lineStart) + value.slice(pos);
        onChange(next);
        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
        return;
      }
      const nextMarker = num ? `${Number(num) + 1}. ` : marker.replace(/\[[xX]\]/, '[ ]');
      const insert = `\n${indent}${nextMarker}`;
      onChange(value.slice(0, pos) + insert + value.slice(pos));
      requestAnimationFrame(() => el.setSelectionRange(pos + insert.length, pos + insert.length));
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl glass">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.label}
            aria-label={t.label}
            disabled={mode === 'preview'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(t.action)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-fg disabled:opacity-30"
          >
            <t.icon className="size-4" />
          </button>
        ))}
        <span className="flex-1" />
        <div
          className="flex shrink-0 rounded-lg bg-surface p-0.5"
          role="tablist"
          aria-label="Mode editor"
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = mode === 'write' ? 'preview' : 'write';
            setMode(next);
            requestAnimationFrame(() => document.getElementById(`${uid}-${next}`)?.focus());
          }}
        >
          {(['write', 'preview'] as const).map((m) => (
            <button
              key={m}
              id={`${uid}-${m}`}
              type="button"
              role="tab"
              aria-selected={mode === m}
              aria-controls={`${uid}-panel`}
              tabIndex={mode === m ? 0 : -1}
              onClick={() => setMode(m)}
              className={cn(
                'flex min-h-8 items-center gap-1 rounded-md px-3 py-1 text-xs font-bold transition',
                mode === m ? 'bg-gradient-journal text-white shadow' : 'text-muted hover:text-fg',
              )}
            >
              {m === 'write' ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
              {m === 'write' ? 'Tulis' : 'Pratinjau'}
            </button>
          ))}
        </div>
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-${mode}`}>
        {mode === 'write' ? (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Isi jurnal"
            aria-describedby={`${uid}-help`}
            spellCheck
            className="block field-sizing-content min-h-72 w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-muted"
          />
        ) : (
          <div className="min-h-72 px-4 py-3">
            {value.trim() ? (
              <Markdown onToggleTask={(line) => onChange(toggleChecklistLine(value, line))}>
                {value}
              </Markdown>
            ) : (
              <p className="text-sm text-muted">Belum ada isi.</p>
            )}
          </div>
        )}
      </div>
      {/* Bantuan sintaks persisten (sebelumnya hanya di placeholder: hilang saat mengetik, kontras rendah) */}
      {mode === 'write' && (
        <p id={`${uid}-help`} className="border-t border-line px-4 py-1.5 text-xs text-muted">
          Markdown: **tebal**, _miring_, - daftar, - [ ] checklist
        </p>
      )}
    </div>
  );
}
