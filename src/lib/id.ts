import { v7 as uuidv7 } from 'uuid';

/**
 * ID baru untuk semua baris tersinkron.
 * UUIDv7 = berbasis waktu → bisa diurutkan & ramah index, dibuat di client (offline-first).
 */
export const newId = (): string => uuidv7();
