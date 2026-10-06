import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Task } from '@/db/schema';
import { useTaskActions } from '../task-actions';
import { useSubtasks } from '../task-queries';
import { TaskCheckbox } from './TaskCheckbox';

export function SubtaskList({ parent }: { parent: Task }) {
  const subtasks = useSubtasks(parent.id);
  const actions = useTaskActions();
  const [title, setTitle] = useState('');
  const done = subtasks.filter((s) => s.status === 'done').length;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await actions.create({ title, parent_id: parent.id, list_id: parent.list_id });
    setTitle('');
  };

  return (
    <div>
      {subtasks.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gradient-tasks transition-all"
            style={{ width: `${(done / subtasks.length) * 100}%` }}
          />
        </div>
      )}
      <ul className="space-y-1">
        {subtasks.map((s) => (
          <li
            key={s.id}
            className="group flex items-center gap-2.5 rounded-xl px-1 py-1 hover:bg-surface"
          >
            <TaskCheckbox
              size="sm"
              checked={s.status === 'done'}
              onToggle={() => void actions.toggle(s)}
              label={`Subtask: ${s.title}`}
            />
            <input
              defaultValue={s.title}
              aria-label="Judul subtask"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== s.title) void actions.update(s.id, { title: v });
                else e.target.value = s.title;
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className={`min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${s.status === 'done' ? 'text-muted line-through' : ''}`}
            />
            <button
              type="button"
              aria-label={`Hapus subtask ${s.title}`}
              onClick={() => void actions.destroy([s.id])}
              className="flex size-7 items-center justify-center rounded-lg text-muted opacity-60 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-1 flex items-center gap-2.5 px-1">
        <Plus className="size-5 text-muted" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Tambah subtask"
          aria-label="Tambah subtask"
          className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm outline-none placeholder:text-muted/70 focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </form>
    </div>
  );
}
