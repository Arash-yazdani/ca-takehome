// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

// A small stand-in for the Flask API, keyed the way the real routes are.
function server(handlers = {}) {
  const tasks = [{ id: 1, title: "Write report", completed: false }];
  const invalid = () => json({ error: { code: "invalid_title", message: "Title cannot be blank." } }, 400);
  const stats = () => ({
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    pending: tasks.filter((t) => !t.completed).length,
  });
  vi.stubGlobal("fetch", vi.fn(async (url, { method = "GET", body } = {}) => {
    const key = `${method} ${url}`;
    if (handlers[key]) return handlers[key]();
    if (key === "GET /api/tasks") return json(tasks);
    if (key === "GET /api/tasks/stats") return json(stats());
    if (key === "POST /api/tasks") {
      const task = { id: 2, title: JSON.parse(body).title, completed: false };
      tasks.push(task);
      return json(task, 201);
    }
    if (key === "PUT /api/tasks/1/complete") {
      tasks[0].completed = true;
      return json(tasks[0]);
    }
    if (key === "DELETE /api/tasks/1") {
      tasks.splice(0, 1);
      return new Response(null, { status: 204 });
    }
    if (key === "PATCH /api/tasks/1") {
      const title = JSON.parse(body).title;
      if (!title.trim()) return invalid();
      tasks[0].title = title;
      return json(tasks[0]);
    }
    return json({ error: { code: "not_found", message: "Not found." } }, 404);
  }));
}

const statValue = (label) =>
  within(within(screen.getByRole("region", { name: "Task statistics" })).getByText(label).parentElement).getByRole(
    "definition"
  ).textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows tasks and stats from the API", async () => {
    server();
    render(<App />);
    expect(await screen.findByText("Write report")).toBeTruthy();
    expect(statValue("Total")).toBe("1");
    expect(statValue("Pending")).toBe("1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("0 of 1 task completed");
  });

  it("adds and completes a task, then refreshes the stats", async () => {
    server();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Write report");

    await user.type(screen.getByLabelText("New task"), "Ship it{Enter}");
    expect(await screen.findByText("Ship it")).toBeTruthy();
    expect(statValue("Total")).toBe("2");

    await user.click(screen.getByRole("button", { name: "Complete Write report" }));
    expect(await screen.findByRole("button", { name: "Reopen Write report" })).toBeTruthy();
    expect(statValue("Completed")).toBe("1");
  });

  it("shows the server's validation message and keeps the input", async () => {
    server({
      "POST /api/tasks": () => json({ error: { code: "invalid_title", message: "Title cannot be blank." } }, 400),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Write report");

    await user.type(screen.getByLabelText("New task"), "  {Enter}");
    expect(await screen.findByText("Title cannot be blank.")).toBeTruthy();
    expect(screen.getByLabelText("New task").value).toBe("  ");
  });

  it("asks before deleting, and Keep leaves the task and returns focus", async () => {
    server();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Write report");

    await user.click(screen.getByRole("button", { name: "Delete Write report" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(fetch).not.toHaveBeenCalledWith("/api/tasks/1", expect.objectContaining({ method: "DELETE" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Write report" }));

    await user.click(screen.getByRole("button", { name: "Delete Write report" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete Write report" }));
    expect(await screen.findByText("Add your first task above.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search tasks" }));
  });

  it("keeps the editor open with the error when a rename is rejected", async () => {
    server();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Write report");

    await user.click(screen.getByRole("button", { name: "Edit Write report" }));
    const editor = screen.getByRole("textbox", { name: "Rename Write report" });
    await user.clear(editor);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Title cannot be blank.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Rename Write report" })).toBeTruthy();

    await user.type(editor, "Renamed{Enter}");
    expect(await screen.findByText("Renamed")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Renamed" }));
  });

  it("moves focus to the next row when a completed task leaves the Pending filter", async () => {
    const pending = [
      { id: 1, title: "First", completed: false },
      { id: 2, title: "Second", completed: false },
    ];
    server({
      "GET /api/tasks": () => json(pending),
      "GET /api/tasks?status=pending": () => json(pending),
      "PUT /api/tasks/1/complete": () => {
        pending.shift();
        return json({ id: 1, title: "First", completed: true });
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("First");
    await user.click(screen.getByRole("button", { name: "Pending" }));
    await user.click(screen.getByRole("button", { name: "Complete First" }));
    await waitFor(() => expect(screen.queryByText("First")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Complete Second" }));
  });

  it("reports a hung API: a request that never answers blocks polls until it fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server();
      render(<App />);
      await screen.findByText("Write report");
      const calls = fetch.mock.calls.length;
      let fail;
      fetch.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
      await vi.advanceTimersByTimeAsync(3000); // this poll hangs
      const hung = fetch.mock.calls.length;
      expect(hung).toBeGreaterThan(calls);
      await vi.advanceTimersByTimeAsync(9000); // no overlapping polls while it hangs
      expect(fetch.mock.calls.length).toBe(hung);
      fail(new TypeError("Failed to fetch"));
      expect(await screen.findByText(/Cannot reach the API/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an unreachable API instead of an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByText(/Cannot reach the API/)).toBeTruthy();
    expect(screen.queryByText("Add your first task above.")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tasks unavailable");
    expect(screen.queryByRole("region", { name: "Task statistics" })).toBeNull();
  });
});
