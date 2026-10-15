import { Check } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input, Label } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast-store';
import {
  cleanDisplayName,
  isLoginNameEnabled,
  setLoginNameEnabled,
} from '@/features/auth/display-name';
import { useDisplayName } from '@/features/auth/useDisplayName';
import { LIMITS } from '@/lib/limits';

/**
 * Nama tampilan (dipakai sapaan Beranda) + saklar untuk menampilkannya di layar masuk.
 *
 * Saklar itu ada karena nama di layar masuk disimpan di PERANGKAT dan sengaja bertahan setelah
 * "Keluar" (kalau dihapus, fiturnya percuma). Di perangkat bersama, orang lain yang membuka halaman
 * masuk akan melihat nama pemiliknya — jadi pengguna bisa mematikannya, dan mematikan LANGSUNG
 * menghapus nama tersimpan.
 */
export function DisplayNameSettings() {
  const { name, ready, save } = useDisplayName();
  const nameId = useId();
  const hintId = useId();
  // `draft` = HANYA yang diketik pengguna (null = belum mengetik). Nilai tampilan diturunkan saat
  // render: selama belum mengetik, kolom mengikuti database (mis. nama diubah dari perangkat
  // lain) tanpa effect yang memanggil setState.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [remember, setRemember] = useState(() => isLoginNameEnabled());

  const value = draft ?? name;
  const clean = cleanDisplayName(value);
  const changed = clean !== name;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    try {
      if (await save(clean)) {
        setDraft(null);
        toast(clean ? 'Nama disimpan' : 'Nama dihapus', { tone: 'success' });
      }
    } catch (err) {
      console.error('[nama] gagal menyimpan', err);
      toast('Gagal menyimpan nama. Coba lagi.', { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <Label htmlFor={nameId}>Nama</Label>
        <div className="flex gap-2">
          <Input
            id={nameId}
            value={value}
            maxLength={LIMITS.displayName}
            placeholder="mis. Budi Santoso"
            autoComplete="name"
            aria-describedby={hintId}
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!changed} loading={saving}>
            <Check /> Simpan
          </Button>
        </div>
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          Dipakai untuk sapaan di Beranda. Boleh dikosongkan.
        </p>
      </form>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-surface">
        <Checkbox
          checked={remember}
          className="mt-0.5"
          aria-describedby={`${hintId}-remember`}
          onChange={(on) => {
            setRemember(on);
            setLoginNameEnabled(on, name);
          }}
        />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Tampilkan namaku di layar masuk</span>
          <span id={`${hintId}-remember`} className="block text-xs text-muted">
            Nama disimpan di perangkat ini dan tetap ada setelah Keluar, sehingga siapa pun yang
            membuka halaman masuk di sini bisa melihatnya. Matikan di perangkat bersama; nama
            tersimpan langsung dihapus.
          </span>
        </span>
      </label>
    </div>
  );
}
