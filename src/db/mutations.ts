/**
 * Helper kecil agar setiap tulis ke DB lokal konsisten dengan konvensi skema.
 *
 * Contoh (di fitur Tugas nanti):
 *   await db.insert(tasks).values(withMeta(userId, { title, status: 'todo', ... }));
 *   await db.update(tasks).set(touch({ title })).where(eq(tasks.id, id));
 *   await db.update(tasks).set(softDeleted()).where(eq(tasks.id, id));
 */
import { nowIso } from '@/lib/date';
import { newId } from '@/lib/id';

export interface RowMeta {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

/** Tambahkan id (UUIDv7), user_id, created_at, updated_at untuk INSERT. */
export function withMeta<T extends object>(userId: string, values: T): T & RowMeta {
  const now = nowIso();
  return { id: newId(), user_id: userId, created_at: now, updated_at: now, ...values };
}

/** Perbarui updated_at untuk UPDATE (server juga menimpanya via trigger). */
export function touch<T extends object>(values: T): T & { updated_at: string } {
  return { ...values, updated_at: nowIso() };
}

/** Nilai untuk soft delete (pindah ke Sampah). */
export function softDeleted() {
  const now = nowIso();
  return { deleted_at: now, updated_at: now };
}

/** Nilai untuk memulihkan dari Sampah. */
export function restored() {
  return { deleted_at: null, updated_at: nowIso() };
}
