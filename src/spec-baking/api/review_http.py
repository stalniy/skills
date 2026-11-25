"""Serve the review browser and exchange its requests through the session log."""

import json
import secrets
import socket
import threading
import time
from collections import deque
from contextlib import closing, contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from acceptance_criteria import write_criteria
from review_engine import EVENT_VALIDATOR, available, normalize_review, require, review_issues, route
from review_files import RECORDS_NAME, read_artifact, read_review, records_revision, write_review
from review_static import client_file
from specification import render_specification, write_specification

MAX_DECISION_BYTES = 1_000_000
MAX_MODEL_EVENT_BYTES = 10_000_000
MODEL_EVENT_WAIT_SECONDS = 30
STATE_HEARTBEAT_SECONDS = 15
MAX_PENDING_SNAPSHOTS = 64
SESSION_IDLE_SECONDS = 60 * 60
IDLE_CLOSE_REASON = "inactive_too_long"
PUBLIC_URLS = set({ "/session", "/api/session" })


def validate_decision(event, actions):
    if not isinstance(event, dict) or not EVENT_VALIDATOR.is_valid(event):
        raise ValueError("Enter a valid review action")
    if event["action"] not in actions.get(event.get("id"), []):
        raise ValueError("This action is no longer available")


def decision_actions(review):
    if not review:
        return [], {}
    # Project actions from a copy because routing can resolve automatic issues.
    rows = deepcopy(review["records"])
    frontier = route(rows)["frontier"]
    actions = {key: ["accept", "edit", "defer", "clarify"] for key in frontier}
    for key, row in rows.items():
        if row.get("resolution") and not row.get("recheck") and available(rows, row):
            actions[key] = ["edit", "defer"]
    return frontier, actions


def is_clarification(request):
    event = request["event"]
    return isinstance(event, dict) and event.get("action") == "clarify"


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = False

    def __init__(self, log, specification, conversation_logger):
        super().__init__(("127.0.0.1", 0), Handler)
        self.conversation_logger = conversation_logger
        self.records = log.with_name(RECORDS_NAME)
        self.specification = specification
        self.generated_specification = log.with_name("SPEC.md")
        self.source_snapshot = log.with_name("SOURCE.md")
        self.state = {"active": True,
                      "clarifications": {},
                      "pending": False,
                      "specification_path": str(specification),
                      "agent_status_updates": [] }
        self.records_revision = None
        self.started_at = None
        self.unanswered_requests = {}
        self.browser_responses = {}
        self.pending_request_id = None
        self.pending_routing = None
        self.routing_delivered = False
        self.close_event = None
        self.last_activity = time.monotonic()
        self.authority = f"127.0.0.1:{self.server_port}"
        self.origin = f"http://{self.authority}"
        self.bootstrap = secrets.token_urlsafe(32)
        self.model_token = secrets.token_urlsafe(32)
        self.cookie = secrets.token_urlsafe(32)
        self.cookie_name = f"review_{secrets.token_hex(8)}"
        self.lock = threading.Lock()
        self.model_event_ready = threading.Condition(self.lock)
        self.state_changed = threading.Condition(self.lock)
        self.state_subscribers = {}
        self.state_version = 0

    def restore_conversation(self, entries):
        for entry in entries:
            if entry["type"] == "request":
                self.unanswered_requests[entry["request_id"]] = entry
            elif entry["type"] == "response":
                request_id = entry["request_id"]
                request = self.unanswered_requests.pop(request_id, None)
                if request is not None:
                    self.browser_responses[request_id] = (request, entry)
                self._record_clarification(entry)
            elif entry["type"] in ("agent", "progress") and "message" in entry:
                self._append_agent_status(entry)

    def recover_browser_requests(self):
        with self.model_event_ready:
            for request in list(self.unanswered_requests.values()):
                if not is_clarification(request):
                    self._complete_browser_request(request, None, datetime.now(timezone.utc))
            self.pending_routing = None
            for request in reversed(self.unanswered_requests.values()):
                if is_clarification(request):
                    self._queue_clarification(request)
                    break

    def _record_conversation_entry(self, entry, received_at):
        entry = {**entry, "received_at": received_at.isoformat(timespec="microseconds")}
        self.conversation_logger.info(json.dumps(entry))
        return entry

    def _append_agent_status(self, entry):
        update = {"type": "progress", "message": entry["message"], "received_at": entry["received_at"]}
        self.state["agent_status_updates"] = [*self.state["agent_status_updates"], update]

    def _record_clarification(self, response):
        clarification = response.get("result", {}).get("clarification")
        if clarification:
            issue_id = clarification["id"]
            threads = self.state["clarifications"]
            self.state["clarifications"] = {**threads, issue_id: [*threads.get(issue_id, []), clarification]}

    def restore_review(self):
        review = read_review(self.records)
        revision = records_revision(review)
        if review is not None:
            normalize_review(review)
            if review.get("specification_generated"):
                write_specification(self.generated_specification, render_specification(review))
        self._set_review(review, revision)

    def specification_for(self, review):
        if review and review.get("specification_generated"):
            return self.generated_specification
        if review and "source" in review and self.specification == self.generated_specification:
            return self.source_snapshot
        return self.specification

    def _set_review(self, review, revision, *, save=False):
        frontier, actions = decision_actions(review)
        if save:
            write_review(self.records, review)
        self.records_revision = revision
        self.state.update(review=review, revision=secrets.token_hex(16), frontier=frontier, actions=actions,
                          specification_path=str(self.specification_for(review)))

    def _apply_review_event(self, event, received_at, *, request_id=None, expected_revision=None):
        review = self.state["review"]
        if request_id is not None:
            receipt = (review or {}).get("last_browser_request")
            if receipt and receipt["request_id"] == request_id:
                return receipt["result"]
            require(self.records_revision == expected_revision,
                    "The review changed before the decision was applied. Check the current recommendation and try again.")

        output = self.generated_specification if review and "source" in review else self.specification
        updated, result = review_issues(self.records, review, event, started_at=self.started_at,
                                        request_id=request_id, specification_path=output)

        action = event["action"]
        if action == "capture_source" and updated != review:
            if self.specification == self.generated_specification:
                source = read_artifact(self.specification, newline="")
                snapshot = read_artifact(self.source_snapshot, newline="")
                require(source is not None, "The source specification is missing")
                require(snapshot is None or snapshot == source, "SOURCE.md already contains different text")
                write_specification(self.source_snapshot, source)
            else:
                require(read_artifact(self.generated_specification) is None,
                        "SPEC.md already exists in the review directory")
        elif updated and "source" in updated:
            if action in ("applied", "finish") or (
                updated.get("specification_generated") and action in ("edit", "defer", "retire")
            ):
                text = render_specification(updated)
                write_specification(self.generated_specification, text)
                updated["specification_generated"] = True
        elif action == "applied":
            changes = {
                key: updated["records"][key] for key in event["ids"]
                if not review["records"][key]["applied"]
            }
            if changes:
                write_criteria(self.specification, changes)
        elif action == "retire":
            write_criteria(self.specification, {event["id"]: None})
        if action == "status":
            self.started_at = result["started_at"]
        entry = None
        if action in ("status", "capture_source", "submit", "set_requirement_changes", "set_verification",
                      "applied", "retire", "facts", "finish"):
            entry = {"type": "agent", "event": event}
            if action == "submit":
                previous_rows = review["records"] if review else {}
                rows = updated["records"]
                count = sum(rows[issue["id"]] != previous_rows.get(issue["id"]) for issue in event["issues"])
                if count:
                    noun = "decision" if count == 1 else "decisions"
                    entry["message"] = f"Received {count} {noun}."
            entry = self._record_conversation_entry(entry, received_at)
        if updated != review:
            self._set_review(updated, records_revision(updated), save=True)
        if entry is not None and "message" in entry:
            self._append_agent_status(entry)
        if request_id is not None:
            self._publish_routing(result)
        return result

    def exchange(self, supplied):
        with self.lock:
            if self.bootstrap and supplied.isascii() and secrets.compare_digest(supplied, self.bootstrap):
                self.bootstrap = None
                self.last_activity = time.monotonic()
                return f"{self.cookie_name}={self.cookie}; Path=/; HttpOnly; SameSite=Lax"
        return None

    def accepts_cookie(self, header):
        try:
            cookie = SimpleCookie(header).get(self.cookie_name)
        except CookieError:
            return False
        return bool(cookie and cookie.value.isascii() and secrets.compare_digest(cookie.value, self.cookie))

    def accepts_token(self, token):
        return (token.isascii()
                and secrets.compare_digest(token, f"Bearer {self.model_token}"))

    def process_model_event(self, payload):
        received_at = datetime.now(timezone.utc)
        with self.lock, self._publish_state_changes():
            self.last_activity = time.monotonic()
            if isinstance(payload, dict) and set(payload) == {"progress"}:
                message = payload["progress"]
                if isinstance(message, str):
                    message = message.strip()
                require(isinstance(message, str) and 0 < len(message) <= 240 and message.isprintable(),
                        "Expected a single progress message up to 240 characters")
                entry = self._record_conversation_entry({"type": "progress", "message": message}, received_at)
                self._append_agent_status(entry)
                return {"ok": True}
            if isinstance(payload, dict) and "event" in payload:
                event = payload["event"]
                result = self._apply_review_event(event, received_at)
                if self.pending_routing is not None and event["action"] not in ("status", "facts"):
                    if self.routing_delivered:
                        self.pending_routing = None
                    else:
                        self._publish_routing(result)
                return result
        if isinstance(payload, dict) and set(payload) in ({"request_id"}, {"request_id", "answer"}):
            request_id = payload["request_id"]
            answer = payload.get("answer")
            if not isinstance(request_id, str) or not request_id:
                raise ValueError("Expected a browser request ID")
            if "answer" in payload:
                if not isinstance(answer, str) or not answer.strip():
                    raise ValueError("Expected a clarification answer")
                answer = answer.strip()
            return self._respond_to_browser_request(request_id, answer, received_at)
        raise ValueError("Expected an event, a progress message, or a browser request ID with an optional answer")

    def _respond_to_browser_request(self, request_id, answer, received_at):
        with self.lock, self._publish_state_changes():
            cached = self.browser_responses.get(request_id)
            request, response = cached if cached is not None else (self.unanswered_requests.get(request_id), None)
            if request is None:
                raise ValueError(f"Unknown review request {request_id}")
            if is_clarification(request):
                if answer is None:
                    raise ValueError("Supply the clarification answer in the answer field")
            elif answer is not None:
                raise ValueError("The browser request is a decision")
            if response is None:
                response = self._complete_browser_request(request, answer, received_at)
        if not response["ok"]:
            raise ValueError(response["error"])
        return response["result"]

    def _complete_browser_request(self, request, answer, received_at):
        request_id = request["request_id"]
        response = self._apply_browser_request(request, answer, received_at)
        self.browser_responses[request_id] = (request, response)
        del self.unanswered_requests[request_id]
        self._record_clarification(response)
        if self.pending_request_id == request_id:
            self.pending_request_id = None
        if self.pending_request_id is None:
            self.state.update(revision=secrets.token_hex(16), response=response, error=response.get("error"),
                              pending=False, pending_clarification=None)
        return response

    def _queue_clarification(self, request):
        self.pending_request_id = request["request_id"]
        self.state.update(pending=True, error=None, pending_clarification=request["event"])
        self.model_event_ready.notify_all()

    def _publish_routing(self, result):
        needs_agent = (result["apply"] or result["recheck"]
                       or (result["status"] == "in-progress" and not result["frontier"]))
        self.pending_routing = result if needs_agent else None
        self.routing_delivered = False
        if self.pending_routing is not None:
            self.model_event_ready.notify_all()

    def _apply_browser_request(self, request, answer, received_at):
        event = request["event"]
        request_id = request["request_id"]
        envelope = {"type": "response", "request_id": request_id}
        try:
            if answer is not None:
                require(EVENT_VALIDATOR.is_valid(event), "Expected a valid clarification request")
                result = {"clarification": {"id": event["id"], "question": event["question"], "answer": answer}}
            else:
                require(isinstance(event, dict) and event.get("action") in ("accept", "edit", "defer"),
                        "Expected a browser decision")
                result = self._apply_review_event(event, received_at, request_id=request_id,
                                                  expected_revision=request["records_revision"])
        except (KeyError, TypeError, ValueError) as error:
            envelope.update(ok=False, error=str(error))
        else:
            envelope.update(ok=True, result=result)
        return self._record_conversation_entry(envelope, received_at)

    def next_model_event(self):
        with self.model_event_ready:
            self.model_event_ready.wait_for(
                lambda: self.pending_request_id is not None or self.pending_routing is not None
                or self.close_event is not None,
                timeout=MODEL_EVENT_WAIT_SECONDS,
            )
            if self.close_event is not None:
                return self.close_event
            if self.pending_request_id is not None:
                request = self.unanswered_requests[self.pending_request_id]
                return {"request_id": self.pending_request_id, "clarification": request["event"]}
            self.routing_delivered = self.pending_routing is not None
            return self.pending_routing

    def close_session(self):
        with self.model_event_ready:
            self._close_session()

    def wait_until_idle(self):
        with self.model_event_ready:
            while True:
                remaining = self.last_activity + SESSION_IDLE_SECONDS - time.monotonic()
                if remaining <= 0:
                    self._close_session(reason=IDLE_CLOSE_REASON)
                    return
                self.model_event_ready.wait(timeout=remaining)

    def _close_session(self, **details):
        if self.close_event is None:
            with self._publish_state_changes():
                self.close_event = {"action": "close_session", **details}
                self.state["active"] = False
                self.model_event_ready.notify_all()

    @contextmanager
    def _publish_state_changes(self):
        # The caller holds self.lock. Live updates replace nested values so
        # queued snapshots stay stable after the lock is released.
        before = self.state.copy()
        try:
            yield
        finally:
            if self.state != before:
                self.state_version += 1
                update = (self.state_version, self.state.copy())
                for pending in self.state_subscribers.values():
                    pending.append(update)
                self.state_changed.notify_all()

    def state_events(self):
        subscriber = object()
        pending = deque(maxlen=MAX_PENDING_SNAPSHOTS)
        with self.state_changed:
            version, snapshot = self.state_version, self.state.copy()
            self.state_subscribers[subscriber] = pending
        try:
            yield snapshot
            while snapshot["active"]:
                with self.state_changed:
                    ready = self.state_changed.wait_for(lambda: bool(pending), timeout=STATE_HEARTBEAT_SECONDS)
                    if ready:
                        next_version, snapshot = pending.popleft()
                        if next_version != version + 1:
                            # A slow client reconnects to get a fresh snapshot.
                            return
                        version = next_version
                yield snapshot if ready else None
        finally:
            with self.state_changed:
                del self.state_subscribers[subscriber]

    def snapshot(self):
        with self.lock:
            return self.state.copy()

    def enqueue(self, payload):
        received_at = datetime.now(timezone.utc)
        if not isinstance(payload, dict) or set(payload) != {"request_id", "revision", "event"}:
            raise ValueError("Expected a browser request ID, review revision, and decision")
        request_id, event = payload["request_id"], payload["event"]
        if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
            raise ValueError("Expected a browser request ID")
        with self.model_event_ready, self._publish_state_changes():
            state = self.state
            self.last_activity = time.monotonic()
            cached = self.browser_responses.get(request_id)
            request, response = cached if cached is not None else (self.unanswered_requests.get(request_id), None)
            if request is not None:
                require(request["event"] == event, "This browser request ID belongs to another decision")
                if is_clarification(request):
                    if response is None and self.pending_request_id is None and state["active"]:
                        self._queue_clarification(request)
                    return response or {"request_id": request_id}
                if response is not None:
                    return response
            else:
                if not state["active"] or payload["revision"] != state["revision"]:
                    raise ValueError("The review has changed. Check the current decision and try again.")
                if self.pending_request_id is not None:
                    raise ValueError("A request is already waiting for this review state.")
                validate_decision(event, state["actions"])
                request = self._record_conversation_entry({
                    "type": "request",
                    "request_id": request_id,
                    "records_revision": self.records_revision,
                    "event": event,
                }, received_at)
                self.unanswered_requests[request_id] = request
                if is_clarification(request):
                    self._queue_clarification(request)
                    return {"request_id": request_id}

            return self._complete_browser_request(request, None, received_at)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def begin_response(self, content_type, status=HTTPStatus.OK, headers=(), *, content_length=None):
        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        if content_length is not None and status != HTTPStatus.NO_CONTENT:
            self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        # The script hash matches the inline launch URL cleanup in client/index.html.
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "script-src 'self' 'sha256-DN74Y6/o1je0dCI5BqZQFhGaIrGrOBf6ek+7fmW7FdI='; "
                         "base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()

    def respond(self, data, content_type, status=HTTPStatus.OK, headers=()):
        self.begin_response(content_type, status, headers, content_length=len(data))
        self.wfile.write(data)

    def json(self, body, status=HTTPStatus.OK):
        self.respond(json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json", status)

    def stream_state(self):
        self.begin_response("text/event-stream")
        with closing(self.server.state_events()) as events:
            for snapshot in events:
                if snapshot is None:
                    self.wfile.write(b": keepalive\n\n")
                else:
                    data = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
                    self.wfile.write(b"data: " + data + b"\n\n")
                self.wfile.flush()

    def read_json(self, limit, error):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= limit or self.headers.get_content_type() != "application/json":
            self.server.conversation_logger.warn(json.dumps({ "event": "read_json", "error": error }))
            return None
        return json.loads(self.rfile.read(length))

    def sign_in(self):
        payload = self.read_json(256, "Invalid authorization token.")
        token = payload.get("open") if isinstance(payload, dict) else None
        cookie = self.server.exchange(token) if isinstance(token, str) else None
        if cookie:
            return self.respond(b"", "text/plain", HTTPStatus.NO_CONTENT, (("Set-Cookie", cookie),))
        return self.json({"error": "Invalid browser sign-in."}, HTTPStatus.UNAUTHORIZED)

    def _respond_to_api_request(self, path):
        server = self.server

        match f"{self.command} {path}":
            case "GET /api/state":
                return self.json(server.snapshot())

            case "GET /api/state/events":
                return self.stream_state()

            case "GET /api/specification":
                with server.lock:
                    path = server.specification_for(server.state["review"])
                    text = read_artifact(path)
                return self.json({"path": str(path), "text": text} if text is not None else None)

            case "POST /api/decision":
                payload = self.read_json(MAX_DECISION_BYTES, "Expected a JSON decision up to 1 MB")
                receipt = server.enqueue(payload)
                if "ok" not in receipt:
                    return self.json(receipt, HTTPStatus.ACCEPTED)
                return self.json(receipt, HTTPStatus.OK if receipt["ok"] else HTTPStatus.BAD_REQUEST)

            case "POST /api/close-session":
                error = "Expected a close_session event."
                if self.read_json(256, error) != {"action": "close_session"}:
                    raise ValueError(error)
                server.close_session()
                return self.respond(b"", "application/json", HTTPStatus.NO_CONTENT)

            case "POST /api/model-events":
                payload = self.read_json(MAX_MODEL_EVENT_BYTES, "Expected a JSON model event up to 10 MB")
                return self.json(self.server.process_model_event(payload))

            case "GET /api/model-events":
                event = self.server.next_model_event()
                if event is None:
                    return self.respond(b"", "application/json", HTTPStatus.NO_CONTENT)

                return self.json(event)

            case "POST /api/session":
                return self.sign_in()

            case _:
                return self.json({"error": "Not found."}, HTTPStatus.NOT_FOUND)

    def route(self):
        server = self.server
        if self.headers.get_all("Host", []) != [server.authority]:
            return self.json({"error": "Open the review at its local URL."}, HTTPStatus.FORBIDDEN)

        try:
            url = urlsplit(self.path)
            origin = self.headers.get("Origin")
            if (origin not in (None, server.origin)
                    or (self.command == "POST" and origin != server.origin)):
                return self.json({"error": "Open the review at its local URL."}, HTTPStatus.FORBIDDEN)

            if not (url.path in PUBLIC_URLS) and not (server.accepts_cookie(self.headers.get("Cookie", "")) or server.accepts_token(self.headers.get("Authorization", ""))):
                return self.json({"error": "Open the review using its launch URL or provide a valid Authorization token."}, HTTPStatus.UNAUTHORIZED)

            if url.path.startswith("/api"):
                return self._respond_to_api_request(url.path)

            return self.respond(*client_file(url.path))
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            return
        except (OSError, ValueError, KeyError, TypeError) as error:
            self.json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

    do_GET = route
    do_POST = route
