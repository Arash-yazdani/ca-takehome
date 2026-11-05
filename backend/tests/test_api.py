from concurrent.futures import ThreadPoolExecutor

import pytest

from app import MAX_BODY_BYTES, MAX_TITLE, create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    return app.test_client()


def add(client, title="Write report"):
    return client.post("/tasks", json={"title": title}).get_json()


def test_seed_tasks_only_when_enabled(monkeypatch):
    assert create_app().test_client().get("/tasks").get_json() == []
    monkeypatch.setenv("SEED_TASKS", "1")
    assert create_app().test_client().get("/tasks/stats").get_json() == {"total": 8, "completed": 3, "pending": 5}


def test_task_lifecycle_updates_stats(client):
    task = add(client)
    assert task["id"] == 1 and task["title"] == "Write report" and task["completed"] is False
    add(client, "Second")
    assert client.get("/tasks/stats").get_json() == {"total": 2, "completed": 0, "pending": 2}

    done = client.put("/tasks/1/complete")
    assert done.status_code == 200 and done.get_json()["completed"] is True
    assert client.get("/tasks/stats").get_json() == {"total": 2, "completed": 1, "pending": 1}

    assert client.delete("/tasks/1").status_code == 204
    assert [t["id"] for t in client.get("/tasks").get_json()] == [2]
    assert client.get("/tasks/stats").get_json() == {"total": 1, "completed": 0, "pending": 1}


def test_create_returns_201_and_strips_title(client):
    res = client.post("/tasks", json={"title": "  Trim me  "})
    assert res.status_code == 201
    assert res.get_json()["title"] == "Trim me"


@pytest.mark.parametrize("body", [
    {}, {"title": None}, {"title": 123}, {"title": True}, {"title": "   "},
    {"title": "x" * (MAX_TITLE + 1)}, ["title"], "title",
    {"title": "\u200b"}, {"title": "a\u0000b"}, {"title": "a\nb"}, {"title": "\ud800"},
])
def test_create_rejects_bad_bodies(client, body):
    res = client.post("/tasks", json=body)
    assert res.status_code == 400
    assert set(res.get_json()["error"]) == {"code", "message"}
    assert client.get("/tasks").get_json() == []


def test_title_at_the_limit_is_accepted(client):
    assert client.post("/tasks", json={"title": "x" * MAX_TITLE}).status_code == 201


def test_malformed_json_is_400(client):
    res = client.post("/tasks", data="{not json", content_type="application/json")
    assert res.status_code == 400 and res.get_json()["error"]["code"] == "invalid_json"


def test_deeply_nested_json_is_400(client):
    res = client.post("/tasks", data="[" * 60000, content_type="application/json")
    assert res.status_code == 400 and res.get_json()["error"]["code"] == "invalid_json"


def test_oversized_body_is_json_413(client):
    res = client.post("/tasks", data=b"x" * (MAX_BODY_BYTES + 1), content_type="application/json")
    assert res.status_code == 413 and "error" in res.get_json()


def test_emoji_with_joiner_is_a_valid_title(client):
    assert client.post("/tasks", json={"title": "\U0001F468\u200d\U0001F4BB"}).status_code == 201


def test_wrong_content_type_is_415(client):
    res = client.post("/tasks", data="title=x", content_type="application/x-www-form-urlencoded")
    assert res.status_code == 415


@pytest.mark.parametrize("method,path,kwargs", [
    ("put", "/tasks/99/complete", {}),
    ("put", "/tasks/99/reopen", {}),
    ("delete", "/tasks/99", {}),
    ("get", "/tasks/99", {}),
    ("patch", "/tasks/99", {"json": {"title": "x"}}),
])
def test_missing_id_is_404_with_message(client, method, path, kwargs):
    res = getattr(client, method)(path, **kwargs)
    assert res.status_code == 404
    assert res.get_json()["error"] == {"code": "task_not_found", "message": "Task 99 does not exist."}


def test_non_integer_id_and_wrong_method_return_json(client):
    assert client.put("/tasks/abc/complete").get_json()["error"]["code"] == "not_found"
    res = client.delete("/tasks")
    assert res.status_code == 405 and res.get_json()["error"]["code"] == "method_not_allowed"
    assert "POST" in res.headers["Allow"]


def test_unexpected_error_returns_json_500_without_details(app, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret detail")
    monkeypatch.setitem(app.view_functions, "stats", boom)
    res = app.test_client().get("/tasks/stats")
    assert res.status_code == 500
    assert res.get_json()["error"]["code"] == "internal_error"
    assert "secret" not in res.text


def test_complete_is_idempotent_and_reopen_clears_timestamp(client):
    add(client)
    first = client.put("/tasks/1/complete").get_json()
    assert client.put("/tasks/1/complete").get_json() == first
    assert first["completed_at"] is not None
    reopened = client.put("/tasks/1/reopen").get_json()
    assert reopened["completed"] is False and reopened["completed_at"] is None


def test_ids_are_not_reused_after_delete(client):
    add(client)
    client.delete("/tasks/1")
    assert add(client)["id"] == 2


def test_rename_validates_and_keeps_completion(client):
    add(client)
    client.put("/tasks/1/complete")
    assert client.patch("/tasks/1", json={"title": " "}).status_code == 400
    res = client.patch("/tasks/1", json={"title": "Renamed"}).get_json()
    assert res["title"] == "Renamed" and res["completed"] is True


def test_filter_by_status_and_search(client):
    add(client, "Buy milk")
    add(client, "Write report")
    client.put("/tasks/2/complete")
    titles = lambda qs: [t["title"] for t in client.get(f"/tasks?{qs}").get_json()]
    assert titles("status=pending") == ["Buy milk"]
    assert titles("status=completed") == ["Write report"]
    assert titles("q=MILK") == ["Buy milk"]
    assert titles("status=completed&q=milk") == []
    assert client.get("/tasks?status=bogus").status_code == 400


def test_concurrent_creates_get_unique_ids(app):
    with ThreadPoolExecutor(16) as pool:
        ids = list(pool.map(lambda i: app.test_client().post("/tasks", json={"title": str(i)}).get_json()["id"], range(200)))
    assert sorted(ids) == list(range(1, 201))
    assert len(app.test_client().get("/tasks").get_json()) == 200
