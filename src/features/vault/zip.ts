/**
 * Analisis arsip zip di browser (JSZip): daftar isi, peringatan, pohon folder.
 * Dipakai sebelum upload (cek node_modules/.git/.env) dan saat melihat isi versi.
 */
import JSZip from 'jszip';

export interface ZipEntry {
  path: string;
  size: number; // ukuran asli (tidak terkompresi)
  dir: boolean;
}

export interface ZipWarning {
  level: 'danger' | 'warning';
  title: string;
  detail: string;
  paths: string[];
}

export interface ZipInfo {
  zip: JSZip;
  entries: ZipEntry[];
  files: number;
  totalSize: number;
  warnings: ZipWarning[];
}

const RULES: {
  level: ZipWarning['level'];
  title: string;
  detail: string;
  test: (p: string) => boolean;
  group: (p: string) => string;
}[] = [
  {
    level: 'danger',
    title: 'Berisi file rahasia (.env / kunci)',
    detail: 'Hapus kredensial sebelum diarsipkan, atau simpan .env.example saja.',
    test: (p) =>
      /(^|\/)\.env(\.(?!example|sample|template)[^/]*)?$/i.test(p) ||
      /(^|\/)(id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.keystore)$/i.test(p),
    group: (p) => p,
  },
  {
    level: 'warning',
    title: 'Berisi node_modules',
    detail: 'Biasanya ratusan MB dan bisa dipulihkan dengan pnpm/npm install.',
    test: (p) => /(^|\/)node_modules\//.test(p),
    group: (p) => p.slice(0, p.indexOf('node_modules/') + 'node_modules'.length),
  },
  {
    level: 'warning',
    title: 'Berisi folder .git',
    detail: 'Riwayat git ikut terarsip. Simpan di GitHub/GitLab, atau abaikan jika memang sengaja.',
    test: (p) => /(^|\/)\.git\//.test(p),
    group: (p) => p.slice(0, p.indexOf('.git/') + '.git'.length),
  },
  {
    level: 'warning',
    title: 'Berisi hasil build / cache',
    detail: 'Folder seperti dist, build, .next, target, __pycache__ bisa dibuat ulang.',
    test: (p) =>
      /(^|\/)(dist|build|\.next|\.nuxt|target|__pycache__|\.venv|venv|\.turbo|\.cache)\//.test(p),
    group: (p) =>
      p.match(
        /^(.*?(?:^|\/)(?:dist|build|\.next|\.nuxt|target|__pycache__|\.venv|venv|\.turbo|\.cache))\//,
      )?.[1] ?? p,
  },
];

export async function readZip(data: Blob | ArrayBuffer): Promise<ZipInfo> {
  const zip = await JSZip.loadAsync(data);
  const entries: ZipEntry[] = [];
  zip.forEach((path, file) => {
    const size =
      (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    entries.push({ path, size, dir: file.dir });
  });
  const files = entries.filter((e) => !e.dir);
  const warnings: ZipWarning[] = [];
  for (const rule of RULES) {
    const hits = [
      ...new Set(files.filter((e) => rule.test(e.path)).map((e) => rule.group(e.path))),
    ];
    if (hits.length)
      warnings.push({
        level: rule.level,
        title: rule.title,
        detail: rule.detail,
        paths: hits.slice(0, 5),
      });
  }
  return {
    zip,
    entries,
    files: files.length,
    totalSize: files.reduce((s, e) => s + e.size, 0),
    warnings,
  };
}

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  children: TreeNode[];
}

/** Bangun pohon folder; folder dulu, lalu alfabet. Satu folder akar tunggal dibuka otomatis. */
export function buildTree(entries: ZipEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dir: true, size: 0, children: [] };
  for (const e of entries) {
    const parts = e.path.replace(/\/$/, '').split('/');
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/') + (last && !e.dir ? '' : '/');
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, dir: !last || e.dir, size: 0, children: [] };
        node.children.push(child);
      }
      if (last && !e.dir) child.size = e.size;
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
    n.size = n.dir ? n.children.reduce((s, c) => s + c.size, 0) : n.size;
  };
  sort(root);
  return root;
}

const TEXT_EXT =
  /\.(txt|md|mdx|json|ya?ml|toml|ini|env|cfg|conf|js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|php|rb|cs|c|h|cpp|hpp|swift|dart|sql|html?|xml|svg|vue|svelte|css|scss|sh|bash|ps1|gql|graphql|lock|gitignore|editorconfig|prettierrc|eslintrc|dockerfile|gradle|properties|csv|log)$/i;
const TEXT_NAMES =
  /^(dockerfile|makefile|license|readme|\.gitignore|\.env.*|\.npmrc|\.nvmrc|procfile)$/i;

export const isTextPath = (path: string) => {
  const name = path.split('/').pop() ?? '';
  return TEXT_EXT.test(name) || TEXT_NAMES.test(name);
};
export const isImagePath = (path: string) => /\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(path);

/** Label versi berikutnya: v1 → v2, v1.2 → v1.3 */
export function nextVersionLabel(labels: (string | null)[]): string {
  let best: number[] | null = null;
  for (const l of labels) {
    const m = l?.match(/^v?(\d+(?:\.\d+)*)$/i);
    if (!m) continue;
    const parts = m[1]!.split('.').map(Number);
    if (!best || compare(parts, best) > 0) best = parts;
  }
  if (!best) return 'v1';
  const next = [...best];
  next[next.length - 1]! += 1;
  return `v${next.join('.')}`;
}

function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
