import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Props {
  children: string;
  className?: string;
  /** Jika diisi, checklist "- [ ]" bisa dicentang; menerima nomor baris (1-based). */
  onToggleTask?: (line: number) => void;
}

type WithNode<T extends keyof React.JSX.IntrinsicElements> = ComponentPropsWithoutRef<T> & {
  node?: { position?: { start: { line: number } } };
};

/**
 * Render Markdown (GFM: tabel, checklist, coret). HTML mentah TIDAK dirender
 * (default react-markdown) → aman dari XSS. Gaya ditulis manual mengikuti design system.
 */
export function Markdown({ children, className, onToggleTask }: Props) {
  const components: Components = {
    h1: (p) => (
      <h1 className="mt-5 mb-2 text-2xl font-semibold tracking-tight first:mt-0" {...strip(p)} />
    ),
    h2: (p) => (
      <h2 className="mt-5 mb-2 text-xl font-semibold tracking-tight first:mt-0" {...strip(p)} />
    ),
    h3: (p) => <h3 className="mt-4 mb-1.5 text-lg font-semibold first:mt-0" {...strip(p)} />,
    p: (p) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...strip(p)} />,
    a: ({ node: _n, ...p }) => (
      <a
        className="font-semibold text-primary underline decoration-primary/40 underline-offset-2"
        target="_blank"
        rel="noopener noreferrer"
        {...p}
      />
    ),
    ul: ({ node: _n, className: c, ...p }) => (
      <ul
        className={cn(
          'my-2 space-y-1 pl-5',
          c?.includes('contains-task-list') ? 'list-none pl-1' : 'list-disc',
        )}
        {...p}
      />
    ),
    ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...strip(p)} />,
    li: ({ node, className: c, children, ...p }: WithNode<'li'>) => {
      const task = c?.includes('task-list-item');
      return (
        <li
          className={cn(
            c,
            'marker:text-muted',
            task && 'flex items-start gap-2',
            task && onToggleTask && 'cursor-pointer',
          )}
          onClick={
            task && onToggleTask && node?.position
              ? (e) => {
                  e.stopPropagation();
                  onToggleTask(node.position!.start.line);
                }
              : undefined
          }
          {...p}
        >
          {children}
        </li>
      );
    },
    input: ({ node: _n, ...p }) =>
      p.type === 'checkbox' ? (
        <input
          {...p}
          disabled={!onToggleTask}
          readOnly
          className="md-task-checkbox mt-1 size-4 shrink-0 cursor-pointer"
        />
      ) : (
        <input {...p} />
      ),
    blockquote: (p) => (
      <blockquote
        className="my-3 rounded-r-xl border-l-4 border-primary/50 bg-surface py-1.5 pr-3 pl-4 text-muted italic"
        {...strip(p)}
      />
    ),
    code: ({ node: _n, className: c, ...p }) =>
      c?.startsWith('language-') ? (
        <code className={cn('font-mono text-[13px]', c)} {...p} />
      ) : (
        <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.9em]" {...p} />
      ),
    pre: (p) => (
      <pre
        className="my-3 overflow-x-auto rounded-xl p-3 text-[13px] leading-relaxed glass"
        {...strip(p)}
      />
    ),
    hr: () => <hr className="my-5 border-line" />,
    table: (p) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...strip(p)} />
      </div>
    ),
    th: (p) => (
      <th className="border-b border-line px-2 py-1.5 text-left font-semibold" {...strip(p)} />
    ),
    td: (p) => <td className="border-b border-line/60 px-2 py-1.5" {...strip(p)} />,
    img: ({ node: _n, alt, ...p }) => (
      <img alt={alt ?? ''} className="my-3 max-h-96 rounded-xl" loading="lazy" {...p} />
    ),
  };

  return (
    <div className={cn('text-[15px] break-words text-fg', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Buang prop `node` agar tidak diteruskan ke DOM. */
function strip<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node: _node, ...rest } = props;
  return rest;
}
