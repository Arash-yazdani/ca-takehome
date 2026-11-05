"""Task API. Every error, including Flask's own 404 and 405, returns {"error": {"code", "message"}}."""
import os
import unicodedata

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from store import TaskStore

MAX_TITLE = 200
MAX_BODY_BYTES = 64 * 1024
STATUSES = ("pending", "completed")
EXAMPLE_TASKS = [  # (title, completed), loaded when SEED_TASKS=1
    ("Book flights for the March client offsite", True),
    ("Send signed contract to legal", True),
    ("Renew the team's software licenses", True),
    ("Review Q4 budget draft with finance", False),
    ("Prepare slides for Thursday's product review", False),
    ("Follow up with Dana on the vendor quote", False),
    ("Schedule 1:1s with new team members", False),
    ("Update the onboarding checklist", False),
]


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message


def error_response(status, code, message):
    return jsonify(error={"code": code, "message": message}), status


def read_title():
    """Returns a stripped, valid title from the JSON body, or raises ApiError."""
    if not request.is_json:
        raise ApiError(415, "unsupported_media_type", "Content-Type must be application/json.")
    try:
        body = request.get_json(silent=True)
    except RecursionError:  # deeply nested JSON; silent=True only covers ValueError
        body = None
    if not isinstance(body, dict):
        raise ApiError(400, "invalid_json", "Request body must be a JSON object.")
    title = body.get("title")
    if not isinstance(title, str):
        raise ApiError(400, "invalid_title", "Title is required and must be a string.")
    title = title.strip()
    categories = {unicodedata.category(c) for c in title}
    if categories & {"Cc", "Cs"}:  # control characters and lone surrogates
        raise ApiError(400, "invalid_title", "Title cannot contain control characters.")
    if categories <= {"Cf", "Zs"}:  # also true for an empty title; catches zero-width-only titles
        raise ApiError(400, "invalid_title", "Title cannot be blank.")
    if len(title) > MAX_TITLE:
        raise ApiError(400, "invalid_title", f"Title cannot exceed {MAX_TITLE} characters.")
    return title


def found(task, task_id):
    if task is None:
        raise ApiError(404, "task_not_found", f"Task {task_id} does not exist.")
    return task


def create_app():
    app = Flask(__name__)
    app.url_map.strict_slashes = False
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES
    store = TaskStore()  # one per app, so each test starts empty
    if os.environ.get("SEED_TASKS") == "1":
        for title, completed in EXAMPLE_TASKS:
            task = store.create(title)
            if completed:
                store.complete(task["id"])

    @app.errorhandler(ApiError)
    def handle_api_error(e):
        return error_response(e.status, e.code, e.message)

    @app.errorhandler(HTTPException)
    def handle_http_error(e):
        body, status = error_response(e.code, e.name.lower().replace(" ", "_"), e.description)
        return body, status, [h for h in e.get_headers() if h[0] == "Allow"]  # a 405 must list allowed methods

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        app.logger.exception("Unhandled error on %s %s", request.method, request.path)
        return error_response(500, "internal_error", "Something went wrong on the server.")

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.get("/tasks")
    def list_tasks():
        status = request.args.get("status")
        if status and status not in STATUSES:
            raise ApiError(400, "invalid_status", f"Status must be one of: {', '.join(STATUSES)}.")
        return jsonify(store.list(status=status, query=request.args.get("q", "").strip()))

    @app.post("/tasks")
    def create_task():
        return jsonify(store.create(read_title())), 201

    @app.get("/tasks/stats")
    def stats():
        return jsonify(store.stats())

    @app.get("/tasks/<int:task_id>")
    def get_task(task_id):
        return jsonify(found(store.get(task_id), task_id))

    @app.patch("/tasks/<int:task_id>")
    def rename_task(task_id):
        title = read_title()  # a bad body on a missing task reports the body first
        return jsonify(found(store.update(task_id, title=title), task_id))

    @app.put("/tasks/<int:task_id>/complete")
    def complete_task(task_id):
        return jsonify(found(store.complete(task_id), task_id))

    @app.put("/tasks/<int:task_id>/reopen")
    def reopen_task(task_id):
        return jsonify(found(store.reopen(task_id), task_id))

    @app.delete("/tasks/<int:task_id>")
    def delete_task(task_id):
        if not store.delete(task_id):
            found(None, task_id)
        return "", 204

    return app
