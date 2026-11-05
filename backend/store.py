"""In-memory task store. All state lives here, so a database replaces this one class."""
from datetime import datetime, timezone
from itertools import count
from threading import Lock


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TaskStore:
    def __init__(self):
        self._tasks = {}  # dict keeps insertion order, so listing is oldest first
        self._ids = count(1)  # never reuses an ID, even after a delete
        self._lock = Lock()  # gunicorn runs this process with several threads

    def list(self, status=None, query=None):
        with self._lock:
            tasks = [dict(t) for t in self._tasks.values()]
        if status:
            tasks = [t for t in tasks if t["completed"] == (status == "completed")]
        if query:
            tasks = [t for t in tasks if query.casefold() in t["title"].casefold()]
        return tasks

    def get(self, task_id):
        with self._lock:
            task = self._tasks.get(task_id)
            return dict(task) if task else None

    def create(self, title):
        with self._lock:
            task = {"id": next(self._ids), "title": title, "completed": False,
                    "created_at": _now(), "completed_at": None}
            self._tasks[task["id"]] = task
            return dict(task)

    def update(self, task_id, **fields):
        """Returns the updated task, or None if the ID does not exist."""
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            task.update(fields)
            return dict(task)

    def complete(self, task_id):
        """Completing twice is a no-op, so the first completed_at stands."""
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            if not task["completed"]:
                task.update(completed=True, completed_at=_now())
            return dict(task)

    def reopen(self, task_id):
        return self.update(task_id, completed=False, completed_at=None)

    def delete(self, task_id):
        with self._lock:
            return self._tasks.pop(task_id, None) is not None

    def stats(self):
        with self._lock:
            total = len(self._tasks)
            completed = sum(t["completed"] for t in self._tasks.values())
        return {"total": total, "completed": completed, "pending": total - completed}
