import { useQuery } from '@powersync/react';
import { eq } from 'drizzle-orm';
import { useMemo } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import { codeProjects, snippets, type CodeProject, type Snippet } from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';

// --------------------------------------------------------------------------- snippet
export interface SnippetFilter {
  search?: string;
  language?: string | null;
  favorites?: boolean;
}

export function useSnippets(f: SnippetFilter) {
  const search = f.search?.trim().toLowerCase() ?? '';
  const { data, isLoading } = useQuery<Snippet>(
    `SELECT * FROM snippets
      WHERE deleted_at IS NULL
        AND (?1 IS NULL OR language = ?1)
        AND (?2 = 0 OR is_favorite = 1)
        AND (?3 = '' OR LOWER(title || ' ' || COALESCE(description, '') || ' ' || code) LIKE '%' || ?3 || '%')
      ORDER BY is_favorite DESC, updated_at DESC`,
    [f.language ?? null, f.favorites ? 1 : 0, search],
  );
  return { snippets: data, isLoading };
}

export function useSnippet(id: string | null) {
  const { data } = useQuery<Snippet>('SELECT * FROM snippets WHERE id = ?1', [id ?? '']);
  return data[0];
}

export function useSnippetLanguages() {
  const { data } = useQuery<{ language: string; n: number }>(
    `SELECT language, COUNT(*) AS n FROM snippets WHERE deleted_at IS NULL GROUP BY language ORDER BY n DESC`,
  );
  return data;
}

// --------------------------------------------------------------------------- project
export interface ProjectRow extends CodeProject {
  versions: number;
  latest_size: number | null;
  latest_label: string | null;
  latest_at: string | null;
  total_size: number;
}

export function useProjects(search: string) {
  const q = search.trim().toLowerCase();
  const { data, isLoading } = useQuery<ProjectRow>(
    `SELECT p.*,
            (SELECT COUNT(*) FROM attachments a WHERE a.entity_type = 'code_project' AND a.entity_id = p.id AND a.deleted_at IS NULL) AS versions,
            (SELECT COALESCE(SUM(size_bytes), 0) FROM attachments a WHERE a.entity_type = 'code_project' AND a.entity_id = p.id AND a.deleted_at IS NULL) AS total_size,
            l.size_bytes AS latest_size, l.version_label AS latest_label, l.created_at AS latest_at
       FROM code_projects p
       LEFT JOIN attachments l ON l.id = (
         SELECT id FROM attachments a WHERE a.entity_type = 'code_project' AND a.entity_id = p.id AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC LIMIT 1)
      WHERE p.deleted_at IS NULL
        AND (?1 = '' OR LOWER(p.name || ' ' || COALESCE(p.description, '')) LIKE '%' || ?1 || '%')
      ORDER BY p.is_favorite DESC, COALESCE(l.created_at, p.updated_at) DESC`,
    [q],
  );
  return { projects: data, isLoading };
}

export function useProject(id: string | null) {
  const { data } = useQuery<CodeProject>('SELECT * FROM code_projects WHERE id = ?1', [id ?? '']);
  return data[0];
}

/** Total pemakaian R2 (lampiran yang belum dihapus). */
export function useStorageUsage() {
  const { data } = useQuery<{ bytes: number; files: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS files FROM attachments WHERE deleted_at IS NULL`,
  );
  return data[0] ?? { bytes: 0, files: 0 };
}

// --------------------------------------------------------------------------- aksi
export function useVaultActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const restoreSnippet = async (id: string) => {
      await db
        .update(snippets)
        .set(touch({ deleted_at: null }))
        .where(eq(snippets.id, id));
    };
    const restoreProject = async (id: string) => {
      await db
        .update(codeProjects)
        .set(touch({ deleted_at: null }))
        .where(eq(codeProjects.id, id));
    };
    return {
      async saveSnippet(v: {
        id?: string;
        title: string;
        language: string;
        code: string;
        description: string | null;
      }) {
        const values = {
          title: v.title.trim(),
          language: v.language,
          code: v.code,
          description: v.description?.trim() || null,
        };
        if (v.id) {
          await db.update(snippets).set(touch(values)).where(eq(snippets.id, v.id));
          return v.id;
        }
        const row = withMeta(userId, { ...values, is_favorite: 0 });
        await db.insert(snippets).values(row);
        return row.id;
      },
      async toggleSnippetFavorite(s: Snippet) {
        await db
          .update(snippets)
          .set(touch({ is_favorite: s.is_favorite ? 0 : 1 }))
          .where(eq(snippets.id, s.id));
      },
      async removeSnippet(id: string) {
        await db.update(snippets).set(softDeleted()).where(eq(snippets.id, id));
        toast('Snippet dipindahkan ke Sampah', {
          action: { label: 'Urungkan', onClick: () => restoreSnippet(id) },
        });
      },
      async saveProject(v: {
        id?: string;
        name: string;
        description: string | null;
        repo_url: string | null;
      }) {
        const values = {
          name: v.name.trim(),
          description: v.description?.trim() || null,
          repo_url: v.repo_url?.trim() || null,
        };
        if (v.id) {
          await db.update(codeProjects).set(touch(values)).where(eq(codeProjects.id, v.id));
          return v.id;
        }
        const row = withMeta(userId, { ...values, is_favorite: 0, position: Date.now() });
        await db.insert(codeProjects).values(row);
        return row.id;
      },
      async toggleProjectFavorite(p: CodeProject) {
        await db
          .update(codeProjects)
          .set(touch({ is_favorite: p.is_favorite ? 0 : 1 }))
          .where(eq(codeProjects.id, p.id));
      },
      async removeProject(id: string) {
        await db.update(codeProjects).set(softDeleted()).where(eq(codeProjects.id, id));
        toast('Project dipindahkan ke Sampah', {
          action: { label: 'Urungkan', onClick: () => restoreProject(id) },
        });
      },
    };
  }, [db, userId]);
}

/** Variabel template {{nama}} unik dalam urutan kemunculan. */
export function templateVariables(code: string): string[] {
  return [...new Set([...code.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!))];
}

export function fillTemplate(code: string, values: Record<string, string>): string {
  return code.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, name: string) => values[name] ?? all);
}
