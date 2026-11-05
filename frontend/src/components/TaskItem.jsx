import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function TaskItem({ task, run, drafts }) {
  const [draft, setDraftState] = useState(() => drafts.get(task.id) ?? null); // null when not editing
  const [editError, setEditError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const row = useRef(null);
  const refocus = useRef(null); // which button takes focus after the row changes mode

  useEffect(() => {
    if (!refocus.current) return;
    row.current?.querySelector(`[data-focus="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });

  const setDraft = (value) => {
    if (value === null) drafts.delete(task.id);
    else drafts.set(task.id, value);
    setDraftState(value);
  };

  // aria-disabled, not disabled: disabling the focused button would drop keyboard focus.
  const act = async (action) => {
    if (busy) return false;
    setBusy(true);
    const ok = await run(action);
    setBusy(false);
    return ok;
  };

  const closeEditor = () => {
    if (busy) return; // a save is in flight, so its result decides
    refocus.current = "edit";
    setDraft(null);
    setEditError("");
  };

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setEditError("");
    const ok = await run(() => api.rename(task.id, draft), setEditError); // a bad title keeps the editor open
    setBusy(false);
    if (ok) {
      refocus.current = "edit";
      setDraft(null);
    }
  };

  const remove = async () => {
    if (await act(() => api.remove(task.id))) return;
    refocus.current = "delete";
    setConfirming(false);
  };

  if (draft !== null) {
    const errorId = `edit-error-${task.id}`;
    return (
      <li className="task" ref={row} data-id={task.id}>
        <form className="edit" onSubmit={save}>
          <input
            autoFocus
            aria-label={`Rename ${task.title}`}
            aria-invalid={Boolean(editError)}
            aria-describedby={editError ? errorId : undefined}
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && closeEditor()}
          />
          <div className="actions">
            <button className="primary" type="submit" aria-disabled={busy}>
              Save
            </button>
            <button type="button" aria-disabled={busy} onClick={closeEditor}>
              Cancel
            </button>
          </div>
          {editError && (
            <p className="edit-error" id={errorId} role="alert">
              {editError}
            </p>
          )}
        </form>
      </li>
    );
  }

  return (
    <li className={task.completed ? "task task--done" : "task"} ref={row} data-id={task.id}>
      <span className="task-title">{task.title}</span>
      <span className="task-status">{task.completed ? "Completed" : "Pending"}</span>
      {confirming ? (
        <div className="actions" role="group" aria-label={`Delete ${task.title}?`}>
          <span className="confirm-text">Delete this task?</span>
          <button className="danger" type="button" aria-disabled={busy} onClick={remove} aria-label={`Confirm delete ${task.title}`}>
            Delete
          </button>
          <button
            autoFocus
            type="button"
            onClick={() => {
              refocus.current = "delete";
              setConfirming(false);
            }}
          >
            Keep
          </button>
        </div>
      ) : (
        <div className="actions">
          {task.completed ? (
            <button type="button" aria-disabled={busy} onClick={() => act(() => api.reopen(task.id))} aria-label={`Reopen ${task.title}`}>
              Reopen
            </button>
          ) : (
            <button
              className="primary"
              type="button"
              aria-disabled={busy}
              onClick={() => act(() => api.complete(task.id))}
              aria-label={`Complete ${task.title}`}
            >
              Complete
            </button>
          )}
          <button type="button" data-focus="edit" onClick={() => setDraft(task.title)} aria-label={`Edit ${task.title}`}>
            Edit
          </button>
          <button
            className="danger"
            type="button"
            data-focus="delete"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${task.title}`}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
