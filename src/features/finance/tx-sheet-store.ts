import { create } from 'zustand';
import type { TransactionKind } from '@/db/schema';
import type { EntityRef } from '@/features/entities/entities';
import type { LocalDate } from '@/lib/date';

export interface TxSheetDefaults {
  kind?: TransactionKind;
  date?: LocalDate;
  walletId?: string;
  categoryId?: string;
  title?: string;
  /** Tautkan transaksi baru ke entitas ini (mis. tugas "Bayar hosting") */
  linkTo?: EntityRef;
}

/** Form transaksi global (dibuka dari Keuangan, Kalender, Beranda). */
interface TxSheetState {
  open: boolean;
  /** null = transaksi baru */
  txId: string | null;
  defaults: TxSheetDefaults;
  /** naik setiap kali dibuka → form di-reset */
  nonce: number;
  create: (defaults?: TxSheetDefaults) => void;
  edit: (id: string) => void;
  close: () => void;
}

export const useTxSheet = create<TxSheetState>((set, get) => ({
  open: false,
  txId: null,
  defaults: {},
  nonce: 0,
  create: (defaults = {}) => set({ open: true, txId: null, defaults, nonce: get().nonce + 1 }),
  edit: (txId) => set({ open: true, txId, defaults: {}, nonce: get().nonce + 1 }),
  close: () => set({ open: false }),
}));
