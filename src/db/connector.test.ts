import { UpdateType, type CrudEntry } from '@powersync/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Respons palsu supabase-js per jenis operasi; diisi tiap tes. */
const responses: {
  upsert: { error: unknown };
  update: { data: unknown[] | null; error: unknown };
  rpc: { error: unknown; status: number; data?: unknown };
} = {
  upsert: { error: null },
  update: { data: [], error: null },
  rpc: { error: null, status: 200 },
};
const calls: string[] = [];
const rpcArgs: unknown[] = [];

/** JWT tanpa tanda tangan yang valid — klien hanya membaca claim `aal`. */
const jwt = (aal: 'aal1' | 'aal2') =>
  `x.${btoa(JSON.stringify({ sub: 'u1', aal })).replace(/=+$/, '')}.y`;
const session = (aal: 'aal1' | 'aal2') => ({
  access_token: jwt(aal),
  expires_at: 2_000_000_000,
  user: { id: 'u1', factors: [{ status: 'verified' }] },
});
/** Sesi yang dikembalikan getSession, berurutan (yang terakhir dipakai terus). */
let sessions: ReturnType<typeof session>[] = [];

vi.mock('@/lib/env', () => ({ env: { powersyncUrl: 'https://ps.example' } }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: sessions.length > 1 ? sessions.shift()! : (sessions[0] ?? null) },
        error: null,
      }),
    },
    rpc: async (name: string, args: unknown) => {
      calls.push(`rpc:${name}`);
      rpcArgs.push(args);
      return responses.rpc;
    },
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

const { SupabaseConnector, isVaultRotation, rotationPayload } = await import('./connector');

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

/** Transaksi rotasi seperti yang ditulis rekeyVaultRows (dengan nilai `enc` lama terlacak). */
const rotationOps = () => [
  op({
    table: 'pw_keys',
    id: 'k1',
    opData: { wrapped_key: 'W2', salt: 'S2', rotated_from: '0123456789abcdef', updated_at: 't' },
  }),
  op({
    table: 'pw_items',
    id: 'i1',
    opData: { enc: 'r.E1', updated_at: 't' },
    previousValues: { enc: 'lama-1' },
  }),
  // tak terbaca: disentuh saja
  op({
    table: 'pw_items',
    id: 'i2',
    opData: { updated_at: 't' },
    previousValues: { enc: 'lama-2' },
  }),
  op({
    table: 'pw_totp_log',
    id: 'l1',
    opData: { enc: 'r.L1', v: 1, updated_at: 't' },
    previousValues: { enc: 'lama-3' },
  }),
  op({
    table: 'config_versions',
    id: 'c1',
    opData: { enc: 'r.C1', updated_at: 't' },
    previousValues: { enc: 'lama-4' },
  }),
];

/** Sidik yang sama dengan vault_key_ref() di SQL. */
const sidik = async (s: string) => (await import('@/lib/hash')).sha256Hex16(s);

beforeEach(() => {
  calls.length = 0;
  rpcArgs.length = 0;
  sessions = [session('aal2')];
  responses.upsert = { error: null };
  responses.update = { data: [{ id: 'a' }], error: null };
  responses.rpc = { error: null, status: 200 };
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

describe('hanya sesi aal2 yang boleh sync & unggah', () => {
  it('sesi aal1: unggahan DITUNDA (dilempar) tanpa satu pun permintaan ke server', async () => {
    sessions = [session('aal1')];
    const { db, errors, complete } = fakeDb([op({})]);
    await expect(new SupabaseConnector().uploadData(db)).rejects.toThrow(/dua langkah/);
    expect(calls).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });

  it('42501 saat sesi masih aal2 = penolakan sungguhan → upload_errors', async () => {
    responses.update = { data: null, error: { code: '42501', message: 'rls' } };
    const { db, errors, complete } = fakeDb([op({})]);
    await new SupabaseConnector().uploadData(db);
    expect(complete).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
  });

  it('42501 karena sesi turun ke aal1 DI TENGAH unggahan → ditunda, perubahan tidak dibuang', async () => {
    responses.update = { data: null, error: { code: '42501', message: 'rls' } };
    sessions = [session('aal2'), session('aal1')]; // cek awal lolos, cek setelah error aal1
    const { db, errors, complete } = fakeDb([op({})]);
    await expect(new SupabaseConnector().uploadData(db)).rejects.toMatchObject({ code: '42501' });
    expect(complete).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });

  it('fetchCredentials: aal2 → token; aal1 / tanpa sesi → null (tidak sync data kosong)', async () => {
    const c = new SupabaseConnector();
    expect(await c.fetchCredentials()).toMatchObject({
      endpoint: 'https://ps.example',
      token: jwt('aal2'),
    });
    sessions = [session('aal1')];
    expect(await c.fetchCredentials()).toBeNull();
    sessions = [];
    expect(await c.fetchCredentials()).toBeNull();
  });
});

describe('rotasi kunci brankas: satu RPC atomik', () => {
  it('dikenali dari PATCH pw_keys yang mengubah wrapped_key (bukan PUT pembuatan brankas)', () => {
    expect(isVaultRotation(rotationOps())).toBe(true);
    expect(
      isVaultRotation([op({ table: 'pw_keys', op: UpdateType.PUT, opData: { wrapped_key: 'W' } })]),
    ).toBe(false);
    expect(isVaultRotation([op({ table: 'pw_keys', opData: { updated_at: 't' } })])).toBe(false);
    expect(isVaultRotation([op({ table: 'pw_items', opData: { enc: 'x' } })])).toBe(false);
  });

  it('dikirim sebagai SATU panggilan apply_vault_rotation, dengan sidik versi lama tiap baris', async () => {
    const { db, errors, complete } = fakeDb(rotationOps());
    await new SupabaseConnector().uploadData(db);
    expect(calls).toEqual(['rpc:apply_vault_rotation']);
    expect(rpcArgs[0]).toEqual({
      p_key: {
        id: 'k1',
        wrapped_key: 'W2',
        salt: 'S2',
        rotated_from: '0123456789abcdef',
        updated_at: 't',
      },
      p_rows: [
        { t: 'pw_items', id: 'i1', enc: 'r.E1', v: null, b: await sidik('lama-1') },
        { t: 'pw_items', id: 'i2', enc: null, v: null, b: await sidik('lama-2') },
        { t: 'pw_totp_log', id: 'l1', enc: 'r.L1', v: 1, b: await sidik('lama-3') },
        { t: 'config_versions', id: 'c1', enc: 'r.C1', v: null, b: await sidik('lama-4') },
      ],
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(0);
  });

  it('ditolak server (23V01) → SELURUH transaksi ke upload_errors, tidak ada yang terkirim sebagian', async () => {
    responses.rpc = { error: { code: '23V01', message: 'kunci berubah' }, status: 400 };
    const { db, errors, complete } = fakeDb(rotationOps());
    await new SupabaseConnector().uploadData(db);
    expect(calls).toEqual(['rpc:apply_vault_rotation']);
    expect(complete).toHaveBeenCalledOnce();
    expect(errors.map((e) => [e[2], e[3], e[5]])).toEqual([
      ['pw_keys', 'k1', '23V01'],
      ['pw_items', 'i1', '23V01'],
      ['pw_items', 'i2', '23V01'],
      ['pw_totp_log', 'l1', '23V01'],
      ['config_versions', 'c1', '23V01'],
    ]);
  });

  it('rotasi format lama ditolak server sebagai HASIL (bukan error HTTP) → tetap dicatat ditolak', async () => {
    responses.rpc = { error: null, status: 200, data: { code: '23V05', message: 'versi lama' } };
    const { db, errors, complete } = fakeDb(rotationOps());
    await new SupabaseConnector().uploadData(db);
    expect(complete).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(rotationOps().length);
    expect(errors.every((e) => e[5] === '23V05')).toBe(true);
  });

  it('HTTP 413 (terlalu besar) → 23V04 permanen, bukan dicoba ulang selamanya', async () => {
    responses.rpc = { error: { message: 'Payload Too Large' }, status: 413 };
    const { db, errors } = fakeDb(rotationOps());
    await new SupabaseConnector().uploadData(db);
    expect(errors[0]![5]).toBe('23V04');
  });

  it('jaringan putus → dicoba ulang (dilempar), tidak dibuang', async () => {
    responses.rpc = { error: { message: 'Failed to fetch', code: '' }, status: 0 };
    const { db, errors, complete } = fakeDb(rotationOps());
    await expect(new SupabaseConnector().uploadData(db)).rejects.toBeDefined();
    expect(complete).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });

  it('transaksi rotasi yang memuat tabel lain → ditolak utuh (23V05), tanpa permintaan apa pun', async () => {
    const ops = [...rotationOps(), op({ table: 'tasks', id: 't1' })];
    expect(await rotationPayload(ops)).toBeNull();
    const { db, errors } = fakeDb(ops);
    await new SupabaseConnector().uploadData(db);
    expect(calls).toEqual([]);
    expect(errors).toHaveLength(ops.length);
    expect(errors.every((e) => e[5] === '23V05')).toBe(true);
  });

  it('baris tanpa nilai enc lama terlacak → b = null (server menolak utuh, bukan rotasi tanpa cek versi)', async () => {
    const ops = rotationOps();
    delete (ops[1] as { previousValues?: unknown }).previousValues;
    const payload = await rotationPayload(ops);
    expect(payload!.p_rows[0]!.b).toBeNull();
  });
});
