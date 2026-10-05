import { useMemo } from 'react';
import type { Task } from '@/db/schema';
import { addLocalDays, todayLocal, type LocalDate } from '@/lib/date';
import { occurrencesBetween } from '@/features/tasks/recurrence';
import { useActiveRecurring, useTasksInRange } from '@/features/tasks/task-queries';
import { EMPTY_DAY, useCalendarActivity, type DayActivity } from './useCalendarActivity';

export interface CalendarTaskItem {
  task: Task;
  date: LocalDate;
  /** true = kejadian mendatang dari tugas berulang (belum ada barisnya) */
  virtual: boolean;
}

/** Tugas per hari dalam rentang: baris nyata + kejadian berulang virtual. */
export function useCalendarTasks(from: LocalDate, to: LocalDate) {
  const today = todayLocal();
  const real = useTasksInRange(from, to);
  const recurring = useActiveRecurring(to);

  return useMemo(() => {
    const map = new Map<LocalDate, CalendarTaskItem[]>();
    const add = (item: CalendarTaskItem) =>
      map.set(item.date, [...(map.get(item.date) ?? []), item]);

    for (const task of real) add({ task, date: task.due_date!, virtual: false });

    for (const task of recurring) {
      // Kejadian setelah due_date baris aktif (baris aktif sudah ada di `real`), dan tidak di
      // masa lalu: tugas terlambat yang diselesaikan melompat ke kejadian mulai hari ini.
      const start = [addLocalDays(task.due_date!, 1), from, today].toSorted().at(-1)!;
      const rangeStart = start;
      if (rangeStart > to) continue;
      for (const date of occurrencesBetween(task.rrule!, task.due_date!, rangeStart, to, 100)) {
        add({ task, date, virtual: true });
      }
    }

    // Urutan per hari: belum selesai → ada jam dulu (urut jam) → prioritas
    for (const items of map.values()) {
      items.sort((a, b) => {
        const doneA = a.task.status === 'done' ? 1 : 0;
        const doneB = b.task.status === 'done' ? 1 : 0;
        if (doneA !== doneB) return doneA - doneB;
        const ta = a.task.due_time ?? '99';
        const tb = b.task.due_time ?? '99';
        if (ta !== tb) return ta.localeCompare(tb);
        return b.task.priority - a.task.priority;
      });
    }
    return map;
  }, [real, recurring, from, to, today]);
}

/** Aktivitas semua modul per hari (tugas dari useCalendarTasks + modul lain dari SQL). */
export function useDayActivity(from: LocalDate, to: LocalDate) {
  const { byDay: other } = useCalendarActivity(from, to);
  const tasksByDay = useCalendarTasks(from, to);

  const byDay = useMemo(() => {
    const map = new Map<LocalDate, DayActivity>();
    for (const [day, activity] of other) map.set(day, { ...activity });
    for (const [day, items] of tasksByDay) {
      const entry = map.get(day) ?? { ...EMPTY_DAY };
      entry.tasks = items.length;
      entry.tasksDone = items.filter((i) => i.task.status === 'done').length;
      map.set(day, entry);
    }
    return map;
  }, [other, tasksByDay]);

  return { byDay, tasksByDay };
}
