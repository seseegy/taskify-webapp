/**
 * Syntax highlight: prism-react-renderer (bawaan: js/ts/jsx/tsx/python/go/rust/sql/json/yaml/…)
 * + bahasa tambahan dari prismjs yang dimuat sekali secara lazy.
 */
import { Prism } from 'prism-react-renderer';

export const LANGUAGES: { value: string; label: string; ext: string[] }[] = [
  { value: 'plaintext', label: 'Teks biasa', ext: ['txt'] },
  { value: 'bash', label: 'Bash / Shell', ext: ['sh', 'bash', 'zsh'] },
  { value: 'javascript', label: 'JavaScript', ext: ['js', 'mjs', 'cjs'] },
  { value: 'typescript', label: 'TypeScript', ext: ['ts', 'mts', 'cts'] },
  { value: 'jsx', label: 'JSX', ext: ['jsx'] },
  { value: 'tsx', label: 'TSX', ext: ['tsx'] },
  { value: 'python', label: 'Python', ext: ['py'] },
  { value: 'go', label: 'Go', ext: ['go'] },
  { value: 'rust', label: 'Rust', ext: ['rs'] },
  { value: 'java', label: 'Java', ext: ['java'] },
  { value: 'kotlin', label: 'Kotlin', ext: ['kt', 'kts'] },
  { value: 'php', label: 'PHP', ext: ['php'] },
  { value: 'ruby', label: 'Ruby', ext: ['rb'] },
  { value: 'csharp', label: 'C#', ext: ['cs'] },
  { value: 'c', label: 'C', ext: ['c', 'h'] },
  { value: 'cpp', label: 'C++', ext: ['cpp', 'cc', 'hpp'] },
  { value: 'swift', label: 'Swift', ext: ['swift'] },
  { value: 'dart', label: 'Dart', ext: ['dart'] },
  { value: 'sql', label: 'SQL', ext: ['sql'] },
  { value: 'json', label: 'JSON', ext: ['json'] },
  { value: 'yaml', label: 'YAML', ext: ['yml', 'yaml'] },
  { value: 'toml', label: 'TOML', ext: ['toml'] },
  { value: 'ini', label: 'INI / .env', ext: ['ini', 'env', 'cfg'] },
  { value: 'markdown', label: 'Markdown', ext: ['md', 'mdx'] },
  { value: 'markup', label: 'HTML / XML', ext: ['html', 'htm', 'xml', 'svg', 'vue'] },
  { value: 'css', label: 'CSS', ext: ['css'] },
  { value: 'scss', label: 'SCSS', ext: ['scss'] },
  { value: 'docker', label: 'Dockerfile', ext: ['dockerfile'] },
  { value: 'nginx', label: 'Nginx', ext: ['conf'] },
  { value: 'graphql', label: 'GraphQL', ext: ['graphql', 'gql'] },
  { value: 'powershell', label: 'PowerShell', ext: ['ps1'] },
];

export const languageLabel = (v: string) => LANGUAGES.find((l) => l.value === v)?.label ?? v;

/** Tebak bahasa dari nama file. */
export function languageFromPath(path: string): string {
  const name = path.split('/').pop()!.toLowerCase();
  if (name === 'dockerfile') return 'docker';
  if (name.startsWith('.env')) return 'ini';
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return LANGUAGES.find((l) => l.ext.includes(ext))?.value ?? 'plaintext';
}

let loading: Promise<void> | null = null;

/** Muat bahasa tambahan (bash, php, java, …). Aman dipanggil berkali-kali. */
export function loadExtraLanguages(): Promise<void> {
  loading ??= (async () => {
    (globalThis as unknown as { Prism: typeof Prism }).Prism = Prism;
    await import('prismjs/components/prism-markup-templating');
    await Promise.all([
      import('prismjs/components/prism-bash'),
      import('prismjs/components/prism-java'),
      import('prismjs/components/prism-ruby'),
      import('prismjs/components/prism-csharp'),
      import('prismjs/components/prism-dart'),
      import('prismjs/components/prism-toml'),
      import('prismjs/components/prism-ini'),
      import('prismjs/components/prism-scss'),
      import('prismjs/components/prism-docker'),
      import('prismjs/components/prism-nginx'),
      import('prismjs/components/prism-powershell'),
    ]);
    await import('prismjs/components/prism-php');
  })().catch((e: unknown) => console.warn('[prism] gagal memuat bahasa tambahan', e));
  return loading;
}

export const prismLanguage = (v: string) =>
  v === 'plaintext' || !Prism.languages[v] ? 'plain' : v;
