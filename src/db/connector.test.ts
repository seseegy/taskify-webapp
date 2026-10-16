import { UpdateType, type CrudEntry } from '@powersync/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Respons palsu supabase-js per jenis operasi; diisi tiap tes. */
const responses: {
  upsert: { error: unknown };
  update: { data: unknown[] | null; error: unknown };
} = { upsert: { error: null }, update: { data: [], error: null } };
const calls: string[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async () => {
        calls.push(`upsert:${table}`);
        return responses.upsert;
      },
      update: () => ({
        eq: () => ({
          select: async () => {
            calls.push(`update:${table}`);
            return responses.update;
          },
        }),
      }),
      delete: () => ({
        eq: async () => {
          calls.push(`delete:${table}`);
          return { error: null };
        },
      }),
    }),
  },
}));

const { SupabaseConnector } = await import('./connector');

const op = (o: Partial<CrudEntry>): CrudEntry =>
  ({
    clientId: 1,
    op: UpdateType.PATCH,
    table: 'tasks',
    id: 'a',
    opData: { title: 'x' },
    ...o,
  }) as CrudEntry;

function fakeDb(crud: CrudEntry[]) {
  const errors: unknown[][] = [];
  const complete = vi.fn(async () => {});
  return {
    errors,
    complete,
    db: {
      getNextCrudTransaction: async () => ({ transactionId: 7, crud, complete }),
      writeTransaction: async (
        fn: (tx: { execute: (s: string, p: unknown[]) => void }) => unknown,
      ) => fn({ execute: (_sql, params) => void errors.push(params) }),
    } as never,
  };
}

beforeEach(() => {
  calls.length = 0;
  responses.upsert = { error: null };
  responses.update = { data: [{ id: 'a' }], error: null };
});

describe('SupabaseConnector.uploadData', () => {
  it('PATCH yang mengenai baris → transaksi selesai tanpa upload_errors', async () => {
    const { db, errors, complete } = fakeDb([op({})]);
    await new SupabaseConnector().uploadData(db);
    expect(calls).toEqual(['update:tasks']);
    expect(complete).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(0);
  });

  it('PATCH ke baris yang tidak ada di server TIDAK hilang diam-diam', async () => {
    responses.update = { data: [], error: null };
    const { db, errors, complete } = fakeDb([op({ id: 'hilang' })]);
    await new SupabaseConnector().uploadData(db);
    expect(complete).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    // kolom: id, op, table_name, row_id, payload, error_code, …
    expect(errors[0]![3]).toBe('hilang');
    expect(errors[0]![5]).toBe('TASKIFY_ROW_MISSING');
  });

  it('error skema dicoba ulang (dilempar), tidak langsung dibuang', async () => {
    responses.upsert = { error: { code: 'PGRST204', message: 'kolom tidak ada' } };
    const { db, errors, complete } = fakeDb([op({ op: UpdateType.PUT })]);
    await expect(new SupabaseConnector().uploadData(db)).rejects.toMatchObject({
      code: 'PGRST204',
    });
    expect(complete).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });

  it('pelanggaran constraint → sisa operasi disimpan ke upload_errors', async () => {
    responses.upsert = { error: { code: '23514', message: 'check' } };
    const { db, errors, complete } = fakeDb([
      op({ op: UpdateType.PUT, id: 'p1' }),
      op({ op: UpdateType.DELETE, id: 'd1' }),
    ]);
    await new SupabaseConnector().uploadData(db);
    expect(complete).toHaveBeenCalledOnce();
    expect(errors.map((e) => e[3])).toEqual(['p1', 'd1']);
  });
});
