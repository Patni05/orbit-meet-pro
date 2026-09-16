'use client';

import type { TodoPayload } from '@orbit/shared';
import { Check, ListTodo, Plus, Trash2, Users2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { meetingClient } from '@/lib/meeting-client';
import { useRoomStore } from '@/lib/room-store';

const TODO_MAX_LENGTH = 280;

/**
 * The meeting task list.
 *
 * Everyone in the room can read it, because an agenda nobody can see is not an
 * agenda. Only hosts can change it — and co-hosts only once the host has
 * opted them in, which is the `cohostsManageTodos` switch at the bottom.
 *
 * Nothing here is authoritative. Every mutation is a round trip, and the list
 * is replaced by whatever the server sends back on `todos:updated`. That is
 * what makes the list survive a reload, a reconnect, and the host's own
 * browser crashing: it lives in the database, not in this component.
 *
 * A participant sees the same list with no controls. That is a courtesy, not
 * the enforcement — the gateway refuses `host:todo-*` from a participant
 * whatever this renders.
 */
export function TodoPanel() {
  const todos = useRoomStore((state) => state.todos);
  const selfRole = useRoomStore((state) => state.selfRole);
  const cohostsManage = useRoomStore((state) => state.cohostsManageTodos);

  const isOwner = selfRole === 'HOST';
  const canManage = isOwner || (selfRole === 'COHOST' && cohostsManage);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const done = todos.filter((todo) => todo.completed).length;

  async function add(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    setBusy(true);
    const result = await meetingClient.createTodo(text);
    setBusy(false);

    // Clearing only on success means a rejected task is not silently lost from
    // the box the person typed it into.
    if (result.ok) {
      setDraft('');
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-3 py-3">
        {todos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <ListTodo className="h-8 w-8 text-ink-600" aria-hidden="true" />
            <p className="text-sm text-ink-400">No tasks yet.</p>
            <p className="text-xs text-ink-500">
              {canManage
                ? 'Add what this meeting needs to get through. Everyone can see the list.'
                : 'The host has not added any tasks.'}
            </p>
          </div>
        ) : (
          <>
            <p className="px-1 pb-2 text-xs text-ink-500">
              {done} of {todos.length} done
            </p>
            <ul className="space-y-1.5">
              {todos.map((todo) => (
                <TodoRow key={todo.id} todo={todo} canManage={canManage} />
              ))}
            </ul>
          </>
        )}
      </div>

      {canManage ? (
        <div className="shrink-0 border-t border-white/10 p-3">
          <form onSubmit={add} className="flex items-center gap-2">
            <label htmlFor="todo-input" className="sr-only">
              New task
            </label>
            <input
              id="todo-input"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, TODO_MAX_LENGTH))}
              placeholder="Add a task"
              className="min-h-11 flex-1 rounded-xl border border-white/15 bg-ink-850 px-3 text-base text-ink-50 placeholder:text-ink-500 focus:outline-2 focus:outline-brand-500 sm:text-sm"
            />
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              aria-label="Add task"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
            >
              <Plus className="h-5 w-5" />
            </button>
          </form>

          {isOwner && (
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 px-1 text-xs text-ink-400">
              <input
                type="checkbox"
                checked={cohostsManage}
                onChange={(event) => void meetingClient.setTodoPermission(event.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-white/20 bg-ink-850 accent-brand-500"
              />
              <Users2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Let co-hosts add and tick off tasks</span>
            </label>
          )}
        </div>
      ) : (
        <p className="shrink-0 border-t border-white/10 p-3 text-center text-xs text-ink-500">
          Only the host can change this list.
        </p>
      )}
    </div>
  );
}

function TodoRow({ todo, canManage }: { todo: TodoPayload; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.text);
  const editRef = useRef<HTMLInputElement>(null);

  // Someone else may have edited this row while it sat open.
  useEffect(() => {
    if (!editing) setText(todo.text);
  }, [todo.text, editing]);

  useEffect(() => {
    if (editing) editRef.current?.select();
  }, [editing]);

  async function commit() {
    const next = text.trim();
    setEditing(false);
    if (!next || next === todo.text) {
      setText(todo.text);
      return;
    }
    await meetingClient.updateTodo(todo.id, { text: next });
  }

  return (
    <li
      className={`group flex items-start gap-2.5 rounded-xl border border-white/10 bg-ink-850/60 p-2.5 transition-colors ${
        todo.completed ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        disabled={!canManage}
        onClick={() => void meetingClient.updateTodo(todo.id, { completed: !todo.completed })}
        aria-label={todo.completed ? `Mark "${todo.text}" as not done` : `Mark "${todo.text}" as done`}
        aria-pressed={todo.completed}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-default ${
          todo.completed
            ? 'border-success-500 bg-success-500 text-ink-950'
            : 'border-white/25 text-transparent enabled:hover:border-brand-400'
        }`}
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={editRef}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, TODO_MAX_LENGTH))}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit();
              if (event.key === 'Escape') {
                setText(todo.text);
                setEditing(false);
              }
            }}
            aria-label="Edit task"
            className="w-full rounded-lg border border-white/15 bg-ink-900 px-2 py-1 text-sm text-ink-50 focus:outline-2 focus:outline-brand-500"
          />
        ) : (
          <p
            onDoubleClick={() => canManage && setEditing(true)}
            className={`break-anywhere text-sm leading-snug ${
              todo.completed ? 'text-ink-400 line-through' : 'text-ink-100'
            }`}
          >
            {todo.text}
          </p>
        )}

        <p className="mt-0.5 text-[11px] text-ink-500">
          {todo.createdByName}
          {todo.completed && todo.completedAt
            ? ` · done ${new Date(todo.completedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : ''}
        </p>
      </div>

      {canManage && !editing && (
        <button
          type="button"
          onClick={() => void meetingClient.deleteTodo(todo.id)}
          aria-label={`Delete task "${todo.text}"`}
          className="shrink-0 rounded-lg p-1.5 text-ink-500 opacity-0 transition-colors hover:bg-danger-600/20 hover:text-danger-400 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {editing && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setText(todo.text);
            setEditing(false);
          }}
          aria-label="Cancel editing"
          className="shrink-0 rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
