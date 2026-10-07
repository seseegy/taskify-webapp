/**
 * Operasi tulis modul Keuangan (SQLite lokal → antrean sync).
 * Validasi di sini mencerminkan CHECK constraint Postgres agar upload tidak ditolak.
 */
import { useStatus } from '@powersync/react';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { useEffect, useMemo } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useDatabase } from '@/db/database-context';
import type { AppDatabase } from '@/db/database';
import { softDeleted, touch, withMeta } from '@/db/mutations';
import {
  budgets,
  categories,
  debts,
  recurringTransactions,
  transactions,
  wallets,
  type CategoryKind,
  type TransactionKind,
  type WalletType,
} from '@/db/schema';
import { useUser } from '@/features/auth/auth-context';
import { nowIso, todayLocal, toDbTime, type LocalDate } from '@/lib/date';
import { clip, LIMITS } from '@/lib/limits';
import { formatIDR } from '@/lib/money';
import type { DebtRow, RecurringRow } from './finance-queries';
import {
  deterministicUuid,
  dueOccurrences,
  firstOccurrenceFrom,
  occurrenceAfter,
  recurringTxId,
} from './recurring';

export interface TxInput {
  kind: TransactionKind;
  amount: number;
  wallet_id: string;
  to_wallet_id?: string | null;
  category_id?: string | null;
  occurred_on: LocalDate;
  occurred_time?: string | null;
  title?: string | null;
  note?: string | null;
  task_id?: string | null;
}

/** Normalisasi sesuai CHECK constraint (transfer ↔ to_wallet_id, transfer tanpa kategori). */
function normalizeTx(input: TxInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new Error('Nominal harus lebih dari 0');
  const transfer = input.kind === 'transfer';
  if (transfer && (!input.to_wallet_id || input.to_wallet_id === input.wallet_id)) {
    throw new Error('Pilih dompet tujuan yang berbeda');
  }
  return {
    kind: input.kind,
    amount: input.amount,
    wallet_id: input.wallet_id,
    to_wallet_id: transfer ? input.to_wallet_id! : null,
    category_id: transfer ? null : (input.category_id ?? null),
    occurred_on: input.occurred_on,
    occurred_time: toDbTime(input.occurred_time),
    title: input.title?.trim() ? clip(input.title.trim(), LIMITS.transactionTitle) : null,
    note: input.note?.trim() || null,
    task_id: input.task_id ?? null,
  };
}

/** Insert transaksi ber-ID tetap jika belum ada (untuk seri berulang & hutang). */
async function insertIfMissing(
  db: AppDatabase,
  userId: string,
  id: string,
  values: ReturnType<typeof normalizeTx> & {
    recurring_id?: string | null;
    debt_id?: string | null;
  },
) {
  const existing = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, id));
  if (existing.length > 0) return false;
  await db.insert(transactions).values({ ...withMeta(userId, values), id });
  return true;
}

export function useFinanceActions() {
  const { db } = useDatabase();
  const userId = useUser().id;

  return useMemo(() => {
    const restoreTx = async (id: string) => {
      await db
        .update(transactions)
        .set(touch({ deleted_at: null }))
        .where(eq(transactions.id, id));
    };

    const restoreBudget = async (id: string) => {
      const [row] = await db.select().from(budgets).where(eq(budgets.id, id));
      if (!row) return;
      // Sudah dibuat anggaran baru untuk kategori yang sama? Jangan membuat duplikat.
      const clash = await db
        .select({ id: budgets.id })
        .from(budgets)
        .where(
          and(
            row.category_id === null
              ? isNull(budgets.category_id)
              : eq(budgets.category_id, row.category_id),
            isNull(budgets.deleted_at),
          ),
        );
      if (clash.length > 0) {
        toast('Sudah ada anggaran untuk kategori ini, jadi tidak dipulihkan', { tone: 'danger' });
        return;
      }
      await db
        .update(budgets)
        .set(touch({ deleted_at: null }))
        .where(eq(budgets.id, id));
    };

    return {
      // ------------------------------------------------------------ Transaksi
      async createTx(input: TxInput) {
        const row = withMeta(userId, normalizeTx(input));
        await db.insert(transactions).values(row);
        return row.id;
      },
      async updateTx(id: string, input: TxInput) {
        await db
          .update(transactions)
          .set(touch(normalizeTx(input)))
          .where(eq(transactions.id, id));
      },
      async removeTx(id: string) {
        await db.update(transactions).set(softDeleted()).where(eq(transactions.id, id));
        toast('Transaksi dihapus', { action: { label: 'Urungkan', onClick: () => restoreTx(id) } });
      },

      // ------------------------------------------------------------ Dompet
      async createWallet(v: {
        name: string;
        type: WalletType;
        initial_balance: number;
        color: string;
        icon: string;
      }) {
        await db.insert(wallets).values(
          withMeta(userId, {
            ...v,
            name: v.name.trim(),
            currency: 'IDR',
            position: Date.now(),
            is_archived: 0,
          }),
        );
      },
      async updateWallet(
        id: string,
        v: Partial<{
          name: string;
          type: WalletType;
          initial_balance: number;
          color: string;
          icon: string;
          is_archived: number;
        }>,
      ) {
        await db.update(wallets).set(touch(v)).where(eq(wallets.id, id));
      },
      /** Hanya dompet tanpa transaksi yang boleh dihapus; selebihnya diarsipkan. */
      async removeWallet(id: string) {
        await db.update(wallets).set(softDeleted()).where(eq(wallets.id, id));
      },

      // ------------------------------------------------------------ Kategori
      async createCategory(v: { name: string; kind: CategoryKind; color: string; icon: string }) {
        await db.insert(categories).values(
          withMeta(userId, {
            ...v,
            name: v.name.trim(),
            parent_id: null,
            position: Date.now(),
            is_archived: 0,
          }),
        );
      },
      async updateCategory(id: string, v: Partial<{ name: string; color: string; icon: string }>) {
        await db.update(categories).set(touch(v)).where(eq(categories.id, id));
      },
      async removeCategory(id: string) {
        // Transaksi lama tetap menyimpan category_id → nama tetap tampil di riwayat
        await db.update(categories).set(softDeleted()).where(eq(categories.id, id));
      },

      // ------------------------------------------------------------ Anggaran
      async saveBudget(v: {
        id?: string;
        category_id: string | null;
        amount: number;
        alert_pct: number;
        start_month: LocalDate;
      }) {
        if (v.amount <= 0) throw new Error('Anggaran harus lebih dari 0');
        if (v.id) {
          await db
            .update(budgets)
            .set(touch({ amount: v.amount, alert_pct: v.alert_pct }))
            .where(eq(budgets.id, v.id));
        } else {
          await db.insert(budgets).values(
            withMeta(userId, {
              category_id: v.category_id,
              amount: v.amount,
              alert_pct: v.alert_pct,
              start_month: v.start_month,
              end_month: null,
            }),
          );
        }
      },
      async removeBudget(id: string) {
        await db.update(budgets).set(softDeleted()).where(eq(budgets.id, id));
        toast('Anggaran dihapus', {
          action: { label: 'Urungkan', onClick: () => restoreBudget(id) },
        });
      },

      // ------------------------------------------------------------ Berulang
      async saveRecurring(v: {
        id?: string;
        kind: TransactionKind;
        amount: number;
        wallet_id: string;
        to_wallet_id: string | null;
        category_id: string | null;
        title: string;
        note: string | null;
        rrule: string;
        start_on: LocalDate;
        end_on: LocalDate | null;
        auto_post: boolean;
      }) {
        const base = normalizeTx({ ...v, occurred_on: v.start_on });
        const schedule = { rrule: v.rrule, start_on: v.start_on, end_on: v.end_on };
        const values = {
          kind: base.kind,
          amount: base.amount,
          wallet_id: base.wallet_id,
          to_wallet_id: base.to_wallet_id,
          category_id: base.category_id,
          title: clip(v.title.trim(), LIMITS.recurringTitle),
          note: v.note?.trim() || null,
          rrule: v.rrule,
          start_on: v.start_on,
          end_on: v.end_on,
          auto_post: v.auto_post ? 1 : 0,
        };
        if (v.id) {
          // Jadwal diubah → kejadian berikutnya dihitung ulang mulai hari ini (atau start_on jika di masa depan)
          const from = v.start_on > todayLocal() ? v.start_on : todayLocal();
          await db
            .update(recurringTransactions)
            .set(touch({ ...values, next_run_on: firstOccurrenceFrom(schedule, from) }))
            .where(eq(recurringTransactions.id, v.id));
        } else {
          await db.insert(recurringTransactions).values(
            withMeta(userId, {
              ...values,
              is_active: 1,
              next_run_on: firstOccurrenceFrom(schedule, v.start_on),
            }),
          );
        }
      },
      async setRecurringActive(r: RecurringRow, active: boolean) {
        const from = todayLocal() > r.start_on ? todayLocal() : r.start_on;
        await db
          .update(recurringTransactions)
          .set(
            touch({
              is_active: active ? 1 : 0,
              ...(active ? { next_run_on: firstOccurrenceFrom(r, from) } : {}),
            }),
          )
          .where(eq(recurringTransactions.id, r.id));
      },
      async removeRecurring(id: string) {
        await db
          .update(recurringTransactions)
          .set(softDeleted())
          .where(eq(recurringTransactions.id, id));
      },
      /** Catat kejadian `next_run_on` sebagai transaksi, lalu maju ke kejadian berikutnya. */
      async postOccurrence(r: RecurringRow) {
        if (!r.next_run_on) return;
        const date = r.next_run_on;
        const id = await recurringTxId(r.id, date);
        await db.transaction(async (tx) => {
          await insertIfMissing(tx as unknown as AppDatabase, userId, id, {
            ...normalizeTx({ ...r, occurred_on: date }),
            recurring_id: r.id,
          });
          await tx
            .update(recurringTransactions)
            .set(touch({ next_run_on: occurrenceAfter(r, date) }))
            .where(eq(recurringTransactions.id, r.id));
        });
        toast(`${r.title} dicatat · ${formatIDR(r.amount)}`, { tone: 'success' });
      },
      async skipOccurrence(r: RecurringRow) {
        if (!r.next_run_on) return;
        await db
          .update(recurringTransactions)
          .set(touch({ next_run_on: occurrenceAfter(r, r.next_run_on) }))
          .where(eq(recurringTransactions.id, r.id));
      },

      // ------------------------------------------------------------ Hutang / piutang
      async createDebt(v: {
        direction: 'lent' | 'borrowed';
        counterparty: string;
        amount: number;
        due_date: LocalDate | null;
        note: string | null;
        wallet_id: string | null;
      }) {
        if (v.amount <= 0) throw new Error('Nominal harus lebih dari 0');
        const row = withMeta(userId, {
          direction: v.direction,
          counterparty: clip(v.counterparty.trim(), LIMITS.counterparty),
          amount: v.amount,
          due_date: v.due_date,
          note: v.note?.trim() || null,
          settled_at: null,
        });
        await db.transaction(async (tx) => {
          await tx.insert(debts).values(row);
          if (v.wallet_id) {
            // Meminjamkan = uang keluar; meminjam = uang masuk
            await insertIfMissing(
              tx as unknown as AppDatabase,
              userId,
              await deterministicUuid(`taskify:debt-open:${row.id}`),
              {
                ...normalizeTx({
                  kind: v.direction === 'lent' ? 'expense' : 'income',
                  amount: v.amount,
                  wallet_id: v.wallet_id,
                  occurred_on: todayLocal(),
                  title:
                    v.direction === 'lent'
                      ? `Pinjamkan ke ${row.counterparty}`
                      : `Pinjam dari ${row.counterparty}`,
                }),
                debt_id: row.id,
              },
            );
          }
        });
      },
      async settleDebt(d: DebtRow, walletId: string | null) {
        await db.transaction(async (tx) => {
          await tx
            .update(debts)
            .set(touch({ settled_at: nowIso() }))
            .where(eq(debts.id, d.id));
          if (walletId) {
            const id = await deterministicUuid(`taskify:debt-settle:${d.id}`);
            const values = {
              ...normalizeTx({
                kind: d.direction === 'lent' ? 'income' : 'expense',
                amount: d.amount,
                wallet_id: walletId,
                occurred_on: todayLocal(),
                title:
                  d.direction === 'lent'
                    ? `Pelunasan dari ${d.counterparty}`
                    : `Pelunasan ke ${d.counterparty}`,
              }),
              debt_id: d.id,
            };
            // Bisa jadi baris lama (soft-deleted saat "batal lunas") → hidupkan lagi
            const existing = await tx
              .select({ id: transactions.id })
              .from(transactions)
              .where(eq(transactions.id, id));
            if (existing.length)
              await tx
                .update(transactions)
                .set(touch({ ...values, deleted_at: null }))
                .where(eq(transactions.id, id));
            else await tx.insert(transactions).values({ ...withMeta(userId, values), id });
          }
        });
        toast(`${d.counterparty}: lunas`, { tone: 'success' });
      },
      async unsettleDebt(d: DebtRow) {
        const id = await deterministicUuid(`taskify:debt-settle:${d.id}`);
        await db.transaction(async (tx) => {
          await tx
            .update(debts)
            .set(touch({ settled_at: null }))
            .where(eq(debts.id, d.id));
          await tx
            .update(transactions)
            .set(softDeleted())
            .where(and(eq(transactions.id, id), isNull(transactions.deleted_at)));
        });
      },
      /** Hapus catatan hutang beserta transaksi dompet yang terkait. */
      async removeDebt(d: DebtRow) {
        await db.transaction(async (tx) => {
          await tx.update(debts).set(softDeleted()).where(eq(debts.id, d.id));
          await tx
            .update(transactions)
            .set(softDeleted())
            .where(and(eq(transactions.debt_id, d.id), isNull(transactions.deleted_at)));
        });
      },
    };
  }, [db, userId]);
}

/**
 * Catat otomatis transaksi berulang (auto_post) yang sudah jatuh tempo.
 * Dipasang sekali di AppShell. Menunggu sync pertama selesai supaya tidak memproses
 * data yang belum lengkap; ID deterministik mencegah dobel antar-perangkat.
 */
export function useRecurringProcessor() {
  const { db } = useDatabase();
  const userId = useUser().id;
  const hasSynced = useStatus().hasSynced;

  useEffect(() => {
    if (!hasSynced) return;
    let running = false;

    const run = async () => {
      if (running) return;
      running = true;
      try {
        const today = todayLocal();
        const due = await db
          .select()
          .from(recurringTransactions)
          .where(
            and(
              isNull(recurringTransactions.deleted_at),
              eq(recurringTransactions.is_active, 1),
              eq(recurringTransactions.auto_post, 1),
              lte(recurringTransactions.next_run_on, today),
            ),
          );
        let posted = 0;
        for (const r of due) {
          const { dates, next } = dueOccurrences(r, today);
          await db.transaction(async (tx) => {
            for (const date of dates) {
              const ok = await insertIfMissing(
                tx as unknown as AppDatabase,
                userId,
                await recurringTxId(r.id, date),
                {
                  ...normalizeTx({ ...r, occurred_on: date }),
                  recurring_id: r.id,
                },
              );
              if (ok) posted++;
            }
            await tx
              .update(recurringTransactions)
              .set(touch({ next_run_on: next }))
              .where(eq(recurringTransactions.id, r.id));
          });
        }
        if (posted > 0) toast(`${posted} transaksi berulang dicatat otomatis`, { tone: 'success' });
      } catch (e) {
        console.error('[recurring] gagal memproses', e);
      } finally {
        running = false;
      }
    };

    void run();
    const t = setInterval(() => void run(), 30 * 60_000); // ganti hari saat aplikasi terbuka lama
    return () => clearInterval(t);
  }, [db, userId, hasSynced]);
}
