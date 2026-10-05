import { BellOff } from 'lucide-react';
import { Link } from 'react-router';
import { Select } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { usePushStatus } from '@/features/notifications/usePushStatus';
import { useState } from 'react';
import {
  isoToLocal,
  localDateTimeToIso,
  parseTimestamp,
  todayLocal,
  type LocalDate,
} from '@/lib/date';
import { computeRemindAt, detectPreset, presetsFor, type ReminderPreset } from '../reminder';

interface Props {
  remindAt: string | null;
  dueDate: LocalDate | null;
  dueTime: string | null;
  onChange: (remindAt: string | null) => void;
}

export function ReminderPicker({ remindAt, dueDate, dueTime, onChange }: Props) {
  const preset = detectPreset(remindAt, dueDate, dueTime);
  const push = usePushStatus();
  const custom = remindAt ? isoToLocal(remindAt) : null;

  const select = (value: ReminderPreset) => {
    if (value === 'custom') {
      const base = remindAt
        ? isoToLocal(remindAt)
        : { date: dueDate ?? todayLocal(), time: '09:00' };
      onChange(localDateTimeToIso(base.date, base.time));
    } else {
      onChange(computeRemindAt(value, dueDate, dueTime));
    }
  };

  const [now] = useState(() => Date.now());
  const past = remindAt !== null && parseTimestamp(remindAt).getTime() < now;

  return (
    <div className="space-y-2">
      <Select
        aria-label="Pengingat"
        value={preset}
        onChange={(e) => select(e.target.value as ReminderPreset)}
      >
        {presetsFor(Boolean(dueTime)).map((p) => (
          <option
            key={p.value}
            value={p.value}
            disabled={p.value !== 'none' && p.value !== 'custom' && !dueDate}
          >
            {p.label}
          </option>
        ))}
      </Select>

      {preset === 'custom' && custom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Tanggal pengingat"
            value={custom.date}
            onChange={(e) =>
              e.target.value && onChange(localDateTimeToIso(e.target.value, custom.time))
            }
            className="h-9"
          />
          <Input
            type="time"
            aria-label="Jam pengingat"
            value={custom.time}
            onChange={(e) =>
              e.target.value && onChange(localDateTimeToIso(custom.date, e.target.value))
            }
            className="h-9 w-32"
          />
          <span className="text-xs text-muted">WIB</span>
        </div>
      )}

      {remindAt && past && <p className="text-xs text-warning">Waktu pengingat sudah lewat.</p>}

      {remindAt && push.state !== 'on' && push.state !== 'loading' && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <BellOff className="mt-px size-3.5 shrink-0" />
          <span>
            Notifikasi belum aktif di perangkat ini.{' '}
            <Link to="/pengaturan" className="font-semibold text-primary hover:underline">
              Aktifkan di Pengaturan
            </Link>
          </span>
        </p>
      )}
    </div>
  );
}
