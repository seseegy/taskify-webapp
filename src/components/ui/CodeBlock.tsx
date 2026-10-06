import { Highlight, themes } from 'prism-react-renderer';
import { useEffect, useState } from 'react';
import { useTheme } from '@/features/theme/theme-context';
import { loadExtraLanguages, prismLanguage } from '@/lib/prism';
import { cn } from '@/lib/utils';

interface Props {
  code: string;
  language: string;
  /** Batasi jumlah baris (pratinjau kartu) */
  maxLines?: number;
  lineNumbers?: boolean;
  className?: string;
}

/** Blok kode ber-syntax-highlight, latar transparan mengikuti kaca. */
export function CodeBlock({ code, language, maxLines, lineNumbers = true, className }: Props) {
  const { resolved } = useTheme();
  const [, setReady] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadExtraLanguages().then(() => alive && setReady((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  const text = maxLines ? code.split('\n').slice(0, maxLines).join('\n') : code;
  return (
    <Highlight
      code={text.replace(/\n$/, '')}
      language={prismLanguage(language)}
      theme={resolved === 'dark' ? themes.nightOwl : themes.github}
    >
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={cn('overflow-x-auto font-mono text-[12.5px] leading-relaxed', className)}>
          {tokens.map((line, i) => {
            const { key: _k, ...lineProps } = getLineProps({ line, key: i }) as ReturnType<
              typeof getLineProps
            > & { key?: unknown };
            return (
              <div key={i} {...lineProps} style={undefined} className="table-row">
                {lineNumbers && (
                  <span className="table-cell pr-4 text-right text-muted/50 select-none">
                    {i + 1}
                  </span>
                )}
                <span className="table-cell whitespace-pre">
                  {line.map((token, j) => {
                    const { key: _t, ...tokenProps } = getTokenProps({
                      token,
                      key: j,
                    }) as ReturnType<typeof getTokenProps> & { key?: unknown };
                    return <span key={j} {...tokenProps} />;
                  })}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}
