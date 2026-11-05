import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import Horizon from "./components/Horizon.jsx";
import TaskForm from "./components/TaskForm.jsx";
import TaskItem from "./components/TaskItem.jsx";

const POLL_MS = 3000; // Polling shows curl-created tasks. Replace with server-sent events if the list grows.
const FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
];

function headline(stats, offline) {
  if (!stats) return offline ? "Tasks unavailable" : "Loading tasks";
  const { total, completed } = stats;
  if (!total) return "No tasks yet";
  if (total > 1 && completed === total) return `All ${total} tasks completed`;
  return `${completed} of ${total} ${total === 1 ? "task" : "tasks"} completed`;
}

export default function App() {
  const [tasks, setTasks] = useState(null); // null until the first response arrives
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState("");

  const filters = useRef({ status, query }); // refresh always reads the current filters
  filters.current = { status, query };
  const latest = useRef(0);
  const inFlight = useRef(0);
  const drafts = useRef(new Map()); // task id -> unsaved title; survives a row leaving the filtered list
  const list = useRef(null);
  const search = useRef(null);
  const focused = useRef(null); // { id, index } of the row holding keyboard focus

  const refresh = useRef(async () => {
    const request = ++latest.current; // only the newest request may update the page
    inFlight.current++;
    try {
      const { status, query } = filters.current;
      const [nextTasks, nextStats] = await Promise.all([api.list({ status, q: query.trim() }), api.stats()]);
      if (request !== latest.current) return;
      setTasks(nextTasks);
      setStats(nextStats);
      setOffline(false);
    } catch (e) {
      if (request !== latest.current) return;
      if (e.status === 0) setOffline(true);
      else setNotice(e.message);
    } finally {
      inFlight.current--;
    }
  }).current;

  useEffect(() => {
    const debounce = setTimeout(refresh, 150);
    return () => clearTimeout(debounce);
  }, [status, query, refresh]);

  useEffect(() => {
    // Polls never overlap, so a slow response cannot be superseded by the next poll and lost.
    const poll = setInterval(() => !document.hidden && !inFlight.current && refresh(), POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  // When the focused row leaves the list for any reason, focus moves to the row that took its place.
  useEffect(() => {
    const row = focused.current;
    if (!row || !tasks || tasks.some((t) => t.id === row.id) || document.activeElement !== document.body) return;
    focused.current = null;
    if (tasks.length) list.current.children[Math.min(row.index, tasks.length - 1)].querySelector("button").focus();
    else search.current.focus();
  }, [tasks]);

  const run = async (action, onError = setNotice) => {
    let ok = true;
    try {
      await action();
      setNotice("");
    } catch (e) {
      ok = false;
      if (e.status === 0) setOffline(true); // the offline banner already says this
      else onError(e.message);
    }
    await refresh();
    return ok;
  };

  const create = async (title) => {
    await api.create(title); // TaskForm shows this error beside the input
    setNotice("");
    // A new task must be visible, so clear any filter that could hide it.
    setStatus("");
    setQuery("");
    await refresh();
  };

  const filtering = Boolean(status || query.trim());
  const count = tasks ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} shown` : "";

  return (
    <>
      <div className="panel">
        <header className="nav">
          <p className="brand">
            <svg viewBox="0 0 28 18" aria-hidden="true">
              <path d="M2 16Q14 -8 26 16" fill="none" stroke="var(--orange)" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
            Task Manager
          </p>
          <span className={offline ? "api-state api-state--down" : "api-state"} role="status">
            {offline ? "API unreachable" : stats ? "API connected" : ""}
          </span>
        </header>

        <section className="hero">
          <h1>{headline(stats, offline)}</h1>
          <p className="sr-only" role="status">
            {headline(stats, offline)}
          </p>
          <TaskForm onCreate={create} />
        </section>

        {stats && <Horizon {...stats} />}
      </div>

      <main className="tasks">
        <h2 className="sr-only">Task list</h2>
        {offline && (
          <p className="banner" role="alert">
            Cannot reach the API. Retrying every {POLL_MS / 1000} seconds.
          </p>
        )}
        {notice && (
          <p className="banner" role="alert">
            {notice}
            <button className="link" type="button" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </p>
        )}

        <div className="toolbar">
          <div className="filters" role="group" aria-label="Filter tasks by status">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <input
            ref={search}
            className="search"
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="sr-only" role="status">
          {filtering ? count : ""}
        </p>

        <div className="list-area">
        {tasks === null && !offline && <p className="empty">Loading tasks.</p>}
        {tasks?.length === 0 && (
          <p className="empty">{filtering ? "No tasks match this filter." : "Add your first task above."}</p>
        )}
        {tasks?.length > 0 && (
          <ul
            className="list"
            role="list"
            ref={list}
            onFocus={(e) => {
              const li = e.target.closest("li");
              focused.current = { id: Number(li.dataset.id), index: [...list.current.children].indexOf(li) };
            }}
            onBlur={(e) => {
              if (e.relatedTarget && !list.current.contains(e.relatedTarget)) focused.current = null;
            }}
          >
            {tasks.map((task) => (
              <TaskItem key={task.id} task={task} run={run} drafts={drafts.current} />
            ))}
          </ul>
        )}
        </div>
      </main>
    </>
  );
}
