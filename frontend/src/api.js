export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the API.", 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  // Status 0 means the API did not answer: a network failure, or a gateway error page from nginx.
  if (!res.ok) throw new ApiError(data?.error?.message ?? "Cannot reach the API.", data?.error ? res.status : 0);
  return data;
}

export const api = {
  list: ({ status, q }) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request(`/tasks${qs ? `?${qs}` : ""}`);
  },
  stats: () => request("/tasks/stats"),
  create: (title) => request("/tasks", { method: "POST", body: { title } }),
  rename: (id, title) => request(`/tasks/${id}`, { method: "PATCH", body: { title } }),
  complete: (id) => request(`/tasks/${id}/complete`, { method: "PUT" }),
  reopen: (id) => request(`/tasks/${id}/reopen`, { method: "PUT" }),
  remove: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
};
