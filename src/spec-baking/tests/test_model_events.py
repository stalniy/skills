# /// script
# requires-python = ">=3.10"
# dependencies = ["jsonschema==4.26.0"]
# ///
"""Exercise model events against the real loopback review server."""

import http.client
import json
import os
import select
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch
from uuid import uuid4

API = Path(__file__).resolve().parents[1] / "api"
SERVER = API / "server.py"
NEXT_EVENT = "/api/model-events"
CLOSE_SESSION = "/api/close-session"
STATE_EVENTS = "/api/state/events"

sys.path.insert(0, str(API))
from acceptance_criteria import END, START, update_criteria
from model_events import ModelEvents
from review_engine import EVENT_VALIDATOR, review_issues


class ModelEventsClientTest(unittest.TestCase):
    def test_next_retries_idle_polls_and_returns_routing_directly(self):
        routing = {"status": "in-progress", "frontier": [], "recheck": [], "apply": ["I2"]}
        client = ModelEvents(12345, "test-token")
        with patch.object(client, "request", side_effect=[None, routing]) as request:
            self.assertEqual(client.next_event(), routing)
        self.assertEqual([call.args for call in request.call_args_list], [
            ("GET", NEXT_EVENT), ("GET", NEXT_EVENT),
        ])

    def test_routing_returns_exact_resolutions_for_apply_and_status(self):
        issue = {
            "id": "I1", "depends_on": [], "issue": "Decision", "recommendation": "Original wording",
            "verification": "Inspect the implementation.",
            "rationale": "Reason", "evidence": "Source", "strategic_impact_value": "high",
            "strategic_impact_reason": "Impact", "cost_value": "high", "cost_reason": "Cost",
            "externally_observable_value": True, "externally_observable_reason": "Visible",
        }
        state = None

        def send(event):
            nonlocal state
            state, result = review_issues(Path("records.json"), state, event, started_at=None)
            return result

        automatic = {**issue, "id": "I2", "cost_value": "low"}
        settled = {**issue, "id": "I3", "settled_status": "out-of-scope",
                   "settled_source": "user guide section 3", "settled_reason": "Later phase",
                   "settled_boundary": "Keep existing behavior"}
        result = send({"action": "submit", "issues": [issue, automatic, settled]})
        self.assertEqual(result["apply"], [])
        self.assertNotIn("resolutions", result)
        result = send({"action": "defer", "id": "I1", "reason": "Not now", "boundary": "Keep reads"})
        expected = {
            "I1": {"status": "out-of-scope", "source": "user defer", "decision": "Deferred.",
                   "reason": "Not now", "boundary": "Keep reads"},
            "I2": {"status": "accepted", "source": "automatic routing", "decision": "Original wording"},
            "I3": {"status": "out-of-scope", "source": "user guide section 3", "decision": "Original wording",
                   "reason": "Later phase", "boundary": "Keep existing behavior"},
        }
        self.assertEqual(result["apply"], ["I1", "I2", "I3"])
        self.assertEqual(result["verification_needed"], ["I1"])
        self.assertEqual(result["resolutions"], expected)
        self.assertEqual(result["resolutions"], {key: state["records"][key]["resolution"] for key in result["apply"]})
        self.assertEqual(send({"action": "status", "ids": []})["resolutions"], expected)
        with self.assertRaisesRegex(ValueError, "Supply verification for I1"):
            send({"action": "applied", "ids": ["I1", "I2"]})
        self.assertFalse(state["records"]["I2"]["applied"])
        result = send({"action": "applied", "ids": ["I3"]})
        self.assertEqual(result["apply"], ["I1", "I2"])
        send({"action": "set_verification", "verifications": {"I1": "Identify the deferral boundary."}})
        result = send({"action": "applied", "ids": ["I1", "I2", "I3"]})
        self.assertEqual(result["apply"], [])
        self.assertNotIn("resolutions", result)
        summary = send({"action": "finish"})["summary"]
        self.assertEqual(summary["interactive_decisions"], 1)
        self.assertEqual(summary["deferrals"], 2)
        self.assertEqual(summary["automatic_decisions"], 1)

    def test_finish_returns_summary_and_updates_optional_facts(self):
        issue = {
            "id": "I1", "depends_on": [], "issue": "Decision", "recommendation": "Choose A",
            "verification": "Inspect the implementation.",
            "rationale": "Reason", "evidence": "Source", "strategic_impact_value": "low",
            "strategic_impact_reason": "Impact", "cost_value": "low", "cost_reason": "Cost",
            "externally_observable_value": False, "externally_observable_reason": "Hidden",
        }
        state = None

        def send(event):
            nonlocal state
            state, result = review_issues(Path("/review/records.json"), state, event, started_at=None,
                                          specification_path=Path("/external/spec.md"))
            return result

        send({"action": "submit", "issues": [issue]})
        send({"action": "applied", "ids": ["I1"]})
        facts = [{"fact": "Open question", "source": "Owner"}]
        summary = send({"action": "finish", "facts": facts})["summary"]
        self.assertGreaterEqual(summary["duration_seconds"], 0)
        self.assertEqual((summary["issue_count"], summary["interactive_decisions"],
                          summary["deferrals"], summary["automatic_decisions"]), (1, 0, 0, 1))
        self.assertEqual(summary["facts"], facts)
        self.assertEqual(summary["records_path"], "/review/records.json")
        self.assertEqual(summary["specification_path"], "/external/spec.md")
        self.assertEqual(send({"action": "finish"})["summary"]["facts"], facts)
        self.assertEqual(send({"action": "finish", "facts": []})["summary"]["facts"], [])
        with self.assertRaises(ValueError):
            send({"action": "finish", "facts": [{"fact": "Missing source"}]})


class AcceptanceCriteriaTest(unittest.TestCase):
    def test_region_preserves_crlf_prose_and_updates_by_id(self):
        intro = "# Spec\r\n\r\n```md\r\n## Acceptance criteria\r\n```\r\n"
        prose = "\r\n## Acceptance criteria ##\r\n\r\n- Hand-authored criterion.\r\n\r\n"
        tail = "## Next section\r\n\r\nMore prose without a trailing newline"
        issue = {
            "title": "Publishing roles", "issue": "Who can publish?",
            "verification": "Identify the roles.\nInspect draft permissions.",
            "strategic_impact_value": "high", "cost_value": "low", "externally_observable_value": True,
        }
        row = {"issue": issue, "resolution": {"status": "accepted", "decision": "Editors only."}}
        text = update_criteria(intro + prose + tail, {"I10": row, "I2": row})
        self.assertTrue(text.startswith(intro + prose))
        self.assertTrue(text.endswith(tail))
        self.assertNotIn("\n", text.replace("\r\n", ""))
        self.assertLess(text.index("**I2"), text.index("**I10"))
        self.assertIn("Identify the roles.\r\n    Inspect draft permissions.", text)
        self.assertIn("Strategic impact: High, Change cost: Low, Externally observable: Yes.", text)

        revised = {**row, "resolution": {"status": "out-of-scope", "boundary": "Keep draft permissions.",
                                         "reason": "Separate phase."}}
        text = update_criteria(text, {"I10": None, "I2": revised})
        self.assertEqual(text, update_criteria(text, {"I10": None, "I2": revised}))
        self.assertEqual(text.count("**I2"), 1)
        self.assertNotIn("**I10", text)
        self.assertNotIn("Editors only.", text)
        self.assertIn("Expected value** — Keep draft permissions.", text)
        self.assertIn("Deferral reason** — Separate phase.", text)
        self.assertTrue(text.startswith(intro + prose))
        self.assertTrue(text.endswith(tail))

    def test_malformed_delimiters_are_rejected(self):
        for text in (
            f"## Acceptance criteria\n{START}\n",
            f"## Another section\n{START}\n{END}\n",
            f"## Acceptance criteria\n{START}\n## Another section\n{END}\n",
        ):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "delimiters"):
                update_criteria(text, {"I1": None})


class LauncherTest(unittest.TestCase):
    def test_prepared_python_is_selected(self):
        launcher = API.parent / "bin" / "spec-baking"
        with tempfile.TemporaryDirectory() as tmp:
            python = Path(tmp) / "bin" / "python"
            python.parent.mkdir()
            python.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\"\n", encoding="utf-8")
            python.chmod(0o755)
            result = subprocess.run([launcher, "start", "--help"], text=True, capture_output=True,
                                    env={**os.environ, "SPEC_BAKING_VENV": tmp})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(str(SERVER), result.stdout)

    def test_pasted_spec_cannot_replace_existing_or_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            spec = directory / "SPEC.md"
            spec.write_text("original", encoding="utf-8")
            command = [sys.executable, SERVER, "--review-dir", directory, "--spec-stdin"]
            result = subprocess.run(command, input="replacement", text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("exclusively", result.stderr)
            self.assertEqual(spec.read_text(), "original")
            spec.unlink()
            (directory / "review-records.json").write_text("{}", encoding="utf-8")
            result = subprocess.run(command, input="replacement", text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("resumed review", result.stderr)
            self.assertFalse(spec.exists())


class ModelEventsTest(unittest.TestCase):
    def launch(self, directory, browser=False):
        spec = directory / "SPEC.md"
        pasted = not spec.exists()
        spec_args = ["--spec-stdin"] if pasted else ["--spec", str(spec)]
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as capture:
            launch_url = Path(capture.name)
        browser_command = shlex.join([
            sys.executable, "-c",
            "from pathlib import Path; import sys; Path(sys.argv[1]).write_text(sys.argv[2])",
            str(launch_url), "%s",
        ])
        args = ["--open"] if browser else []
        server = subprocess.Popen(
            [API.parent / "bin/spec-baking", "start", "--review-dir", directory, *spec_args, *args],
            stdin=subprocess.PIPE if pasted else subprocess.DEVNULL, stdout=subprocess.PIPE, text=True,
            env={**os.environ, "BROWSER": browser_command, "SPEC_BAKING_VENV": sys.prefix},
        )
        self.addCleanup(server.stdout.close)
        self.addCleanup(server.wait, timeout=5)
        self.addCleanup(server.terminate)
        if pasted:
            server.stdin.write("# Test review\n")
            server.stdin.close()
        line = server.stdout.readline().strip()
        announcement = json.loads(line)
        self.assertEqual(set(announcement) - {"resolutions", "verification_needed", "requirement_changes_needed"},
                         {"session_file", "resumed", "status", "frontier", "recheck", "apply"})
        self.announcement = announcement
        self.assertEqual(announcement["resumed"], (directory / "review-records.json").exists())
        session = Path(announcement["session_file"])
        self.assertEqual(session.stat().st_mode & 0o777, 0o600)
        self.assertEqual(session.parent.stat().st_mode & 0o777, 0o700)
        credentials = json.loads(session.read_text())
        url = urlsplit(f"http://127.0.0.1:{credentials['port']}")
        if browser:
            deadline = time.monotonic() + 3
            while not (launched := launch_url.read_text()) and time.monotonic() < deadline:
                time.sleep(0.01)
            target = urlsplit(launched)
            self.assertEqual(target._replace(fragment="").geturl(), f"{url.geturl()}/session")
            self.assertTrue(target.fragment)
            self.assertNotEqual(target.fragment, credentials["token"])
            self.bootstrap = target.fragment
        return url, credentials["token"], session, server

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.url, self.token, self.session, self.server = self.launch(self.directory, browser=True)
        self.origin = f"http://{self.url.netloc}"
        self.model_headers = {"Authorization": f"Bearer {self.token}", "Origin": self.origin}

    def request(self, path, body=None, headers=None, *, url=None, raw=False):
        connection = http.client.HTTPConnection((url or self.url).netloc, timeout=3)
        try:
            connection.request(
                "GET" if body is None else "POST", path,
                body=None if body is None else body if isinstance(body, str) else json.dumps(body),
                headers={"Content-Type": "application/json", **(headers or {})},
            )
            response = connection.getresponse()
            data = response.read()
            return response.status, data if raw else json.loads(data) if data else None, response.headers
        finally:
            connection.close()

    def model(self, body, *, token=None, headers=None, url=None):
        url = url or self.url
        return self.request("/api/model-events", body, {
            "Authorization": f"Bearer {self.token if token is None else token}",
            "Origin": url.geturl(),
            **(headers or {}),
        }, url=url)[:2]

    def browser_cookie(self):
        payload = {"open": self.bootstrap}
        origin = {"Origin": self.url.geturl()}
        self.assertEqual(self.request("/api/session", payload, {"Origin": "null"})[0], 403)
        status, _, headers = self.request("/api/session", payload, origin)
        self.assertEqual(self.request("/api/session", payload, origin)[0], 401)
        self.assertEqual(status, 204)
        return headers["Set-Cookie"].split(";")[0]

    def test_source_requirements_render_with_decisions_and_recover_on_resume(self):
        def send(event, expected_status=200):
            status, result = self.model({"event": event})
            self.assertEqual(status, expected_status, result)
            return result

        spec = self.directory / "SPEC.md"
        original = spec.read_bytes()
        source = {
            "action": "capture_source",
            "goal": "Publish reviewed articles.",
            "requirements": [
                {"id": "R1", "type": "functional", "function": "Publish articles",
                 "text": "Authors can publish an article.", "source": "Original, Publication",
                 "criterion": "An author can publish."},
                {"id": "R2", "type": "non-functional", "function": "Publish articles",
                 "text": "Publish within one second.", "source": "Original, Timing",
                 "verification": "Measure publication time."},
                {"id": "R3", "type": "functional", "function": "Publish articles",
                 "text": "Authors can bypass review.", "source": "Original, Publication"},
            ],
            "exclusions": ["Scheduled publication is out of scope."],
        }
        self.assertEqual(send(source)["frontier"], [])
        send(source)
        self.assertEqual(spec.read_bytes(), original)
        self.assertEqual((self.directory / "SOURCE.md").read_bytes(), original)
        state = self.request("/api/state", headers=self.model_headers)[1]
        self.assertEqual(state["review"]["source"]["requirements"], source["requirements"])
        self.assertEqual(state["actions"], {})

        issue = json.loads((API.parent / "tests/fixtures/submit.json").read_text())["event"]["issues"][0]
        issue.update(function="Publish articles", type="functional", requirement_changes=[
            {"operation": "replace", "id": "R1", "text": "Only editors can publish an article."},
        ])
        remove_bypass = {**issue, "id": "I2", "cost_value": "low", "recommendation": "Require review.",
                         "requirement_changes": [
                             {"operation": "remove", "id": "R3"},
                             {"operation": "add", "text": "Require review before publication."},
                         ]}
        defer_alerts = {**issue, "id": "I3", "settled_status": "out-of-scope",
                        "settled_source": "Initial scope", "settled_reason": "Alerts are a later feature.",
                        "settled_boundary": "Publish without sending alerts."}
        del defer_alerts["requirement_changes"]
        self.assertEqual(send({"action": "submit", "issues": [issue, remove_bypass, defer_alerts]})["frontier"],
                         ["I1"])
        headers = {"Cookie": self.browser_cookie(), "Origin": self.origin}
        browser_state = self.request("/api/state", headers=headers)[1]
        status, receipt, _ = self.request("/api/decision", {
            "request_id": str(uuid4()),
            "revision": browser_state["revision"],
            "event": {"action": "edit", "id": "I1", "decision": "Allow reviewers as well."},
        }, headers)
        self.assertEqual(status, 200, receipt)
        self.assertEqual(receipt["result"]["requirement_changes_needed"], ["I1"])
        send({"action": "applied", "ids": ["I1"]}, 400)
        changed = "Editors and reviewers can publish an article."
        send({"action": "set_requirement_changes", "changes": {
            "I1": [{"operation": "replace", "id": "R1", "text": changed}],
        }})
        verification = {"action": "set_verification", "verifications": {
            "I1": "Check permissions for editors, reviewers, and authors.",
        }}
        send(verification)
        send({"action": "applied", "ids": ["I1", "I2", "I3"]})
        summary = send({"action": "finish"})["summary"]
        self.assertEqual(summary["specification_path"], str(spec.resolve()))
        text = spec.read_text()
        self.assertEqual([line for line in text.splitlines() if line.startswith("## ")], [
            "## Goal", "## Functional requirements", "## Non-functional requirements",
            "## Out of scope", "## Acceptance criteria and verification",
        ])
        self.assertIn(f"- **R1** — {changed}", text)
        self.assertIn("**Requirements** — R1.", text)
        self.assertIn("Measure publication time.", text)
        self.assertIn("Scheduled publication is out of scope.", text)
        self.assertIn("- **I2.2** — Require review before publication.", text)
        self.assertIn("Remove requirement R3.", text)
        self.assertIn("Publish without sending alerts.", text)
        self.assertNotIn("An author can publish.", text)
        self.assertNotIn("Authors can bypass review.", text)
        self.assertEqual(self.request("/api/specification", headers=headers)[1]["text"], text)
        send({"action": "finish"})
        self.assertEqual(spec.read_text(), text)

        self.server.terminate()
        self.server.wait(timeout=5)
        spec.write_text("Interrupted output", encoding="utf-8")
        url, token, _, _ = self.launch(self.directory)
        self.assertEqual(spec.read_text(), text)
        self.assertEqual(self.model({"event": {"action": "status", "ids": []}}, token=token, url=url)[1]["status"],
                         "complete")

    def test_finish_with_external_source_and_no_decisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            original = directory / "input.md"
            original.write_text("# Input\n")
            review_directory = directory / "review"
            with subprocess.Popen(
                [sys.executable, SERVER, "--review-dir", review_directory, "--spec", original],
                stdout=subprocess.PIPE, text=True,
            ) as server:
                try:
                    session = Path(json.loads(server.stdout.readline())["session_file"])
                    credentials = json.loads(session.read_text())
                    url = urlsplit(f"http://127.0.0.1:{credentials['port']}")
                    for event in ({"action": "capture_source", "goal": "A settled goal.",
                                   "requirements": [], "exclusions": []}, {"action": "finish"}):
                        status, result = self.model({"event": event}, token=credentials["token"], url=url)
                        self.assertEqual(status, 200, result)
                    self.assertEqual(original.read_text(), "# Input\n")
                    self.assertIn("A settled goal.", (review_directory / "SPEC.md").read_text())
                finally:
                    server.terminate()
                    server.wait(timeout=5)

    def test_agent_progress_appears_in_browser_state_and_survives_restart(self):
        headers = {"Cookie": self.browser_cookie()}
        before = self.request("/api/state", headers=headers)[1]
        self.assertEqual(before["agent_status_updates"], [])
        messages = ["Identified the draft publishing function.", "Checking who can publish an approved draft."]
        for message in messages:
            self.assertEqual(self.model({"progress": message}), (200, {"ok": True}))
        for invalid in (None, " ", "x" * 241, "first\nsecond"):
            self.assertEqual(self.model({"progress": invalid})[0], 400)

        state = self.request("/api/state", headers=headers)[1]
        history = state.pop("agent_status_updates")
        before.pop("agent_status_updates")
        self.assertEqual(state, before)
        self.assertEqual([entry["message"] for entry in history], messages)
        for entry in history:
            self.assertEqual(entry["type"], "progress")
            self.assertEqual(datetime.fromisoformat(entry["received_at"]).utcoffset(), timedelta(0))
        log = self.directory / "conversation.jsonl"
        self.assertEqual([json.loads(line) for line in log.read_text().splitlines()], history)

        submit = json.loads(Path(__file__).with_name("fixtures").joinpath("submit.json").read_text())
        issues = submit["event"]["issues"]
        issues.append({**issues[0], "id": "I2"})
        self.assertEqual(self.model(submit)[0], 200)
        history = self.request("/api/state", headers=headers)[1]["agent_status_updates"]
        self.assertEqual([entry["message"] for entry in history], [*messages, "Received 2 decisions."])

        self.server.terminate()
        self.server.wait(timeout=5)
        self.url, self.token, _, _ = self.launch(self.directory, browser=True)
        headers = {"Cookie": self.browser_cookie()}
        self.assertEqual(self.request("/api/state", headers=headers)[1]["agent_status_updates"], history)

    def test_state_stream_pushes_changes_and_resynchronizes_on_reconnect(self):
        self.assertEqual(self.request(STATE_EVENTS)[0], 401)
        headers = {"Cookie": self.browser_cookie(), "Origin": self.origin}

        def connect(connection):
            connection.request("GET", STATE_EVENTS, headers=headers)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("Content-Type"), "text/event-stream; charset=utf-8")
            return response

        def snapshot(response):
            line = response.readline()
            self.assertTrue(line.startswith(b"data: "), line)
            self.assertEqual(response.readline(), b"\n")
            return json.loads(line[len(b"data: "):])

        with closing(http.client.HTTPConnection(self.url.netloc, timeout=3)) as connection:
            with connect(connection) as stream:
                initial = snapshot(stream)
                self.assertEqual(initial, self.request("/api/state", headers=headers)[1])
                self.assertEqual(self.model({"progress": ""})[0], 400)
                self.assertEqual(self.model({"progress": "Checking the first path."})[0], 200)
                self.assertEqual(self.model({"progress": "Checking the second path."})[0], 200)
                first = snapshot(stream)
                second = snapshot(stream)
                self.assertEqual(first["revision"], initial["revision"])
                self.assertEqual(second["revision"], initial["revision"])
                self.assertEqual([entry["message"] for entry in first["agent_status_updates"]],
                                 ["Checking the first path."])
                self.assertEqual([entry["message"] for entry in second["agent_status_updates"]],
                                 ["Checking the first path.", "Checking the second path."])

                submit = json.loads(Path(__file__).with_name("fixtures").joinpath("submit.json").read_text())
                self.assertEqual(self.model(submit)[0], 200)
                submitted = snapshot(stream)
                self.assertEqual(submitted["frontier"], ["I1"])
                self.assertEqual([entry["message"] for entry in submitted["agent_status_updates"]],
                                 ["Checking the first path.", "Checking the second path.", "Received 1 decision."])

                self.assertEqual(self.model(submit)[0], 200)
                self.assertEqual(self.request("/api/state", headers=headers)[1], submitted)

        with closing(http.client.HTTPConnection(self.url.netloc, timeout=3)) as connection:
            with connect(connection) as stream:
                current = snapshot(stream)
                self.assertEqual(current, submitted)
                request_id = str(uuid4())
                clarification = {"action": "clarify", "id": "I1", "question": "Why?"}
                self.assertEqual(self.request("/api/decision", {
                    "request_id": request_id, "revision": current["revision"], "event": clarification,
                }, headers)[0], 202)
                pending = snapshot(stream)
                self.assertEqual(pending["revision"], current["revision"])
                self.assertEqual(pending["pending_clarification"], clarification)

                self.assertEqual(self.model({"request_id": request_id, "answer": "It meets the requirement."})[0], 200)
                answered = snapshot(stream)
                self.assertFalse(answered["pending"])
                self.assertEqual(answered["response"]["request_id"], request_id)
                self.assertEqual(answered["clarifications"]["I1"][0]["answer"], "It meets the requirement.")

                request_id = str(uuid4())
                status, receipt, _ = self.request("/api/decision", {
                    "request_id": request_id, "revision": answered["revision"],
                    "event": {"action": "accept", "id": "I1"},
                }, headers)
                self.assertEqual(status, 200)
                accepted = snapshot(stream)
                self.assertEqual(accepted["response"], receipt)
                self.assertEqual(accepted["frontier"], [])

                self.assertEqual(self.request(CLOSE_SESSION, {"action": "close_session"}, headers)[0], 204)
                closed = snapshot(stream)
                self.assertEqual(closed, {**accepted, "active": False})
                self.assertEqual(stream.readline(), b"")

    def test_browser_sign_in_uses_the_review_client(self):
        status, launch, _ = self.request("/session", raw=True)
        self.assertIn(status, (200, 503))
        self.assertNotIn(self.bootstrap.encode(), launch)
        self.assertEqual(self.request("/api/state")[0], 401)
        cookie = {"Cookie": self.browser_cookie()}
        self.assertEqual(self.request("/", headers=cookie, raw=True)[:2], (status, launch))
        self.assertEqual(self.request("/api/state", headers=cookie)[0], 200)

    def test_specification_is_served_on_demand(self):
        path = self.directory / "SPEC.md"
        endpoint = "/api/specification"
        self.assertEqual(self.request(endpoint)[0], 401)
        headers = {"Cookie": self.browser_cookie()}
        status, state, _ = self.request("/api/state", headers=headers)
        self.assertEqual(status, 200)
        self.assertEqual(state["specification_path"], str(path.resolve()))
        self.assertNotIn("specification", state)

        for text in ("# Test review\n", "# Updated review\n"):
            path.write_text(text, encoding="utf-8")
            expected = (200, {"path": str(path.resolve()), "text": text})
            self.assertEqual(self.request(endpoint, headers=headers)[:2], expected)
            self.assertEqual(self.request(endpoint, headers=self.model_headers)[:2], expected)

        path.unlink()
        self.assertEqual(self.request(endpoint, headers=headers)[:2], (200, None))

    def test_legacy_verification_and_failed_criterion_write_can_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            spec = directory / "SPEC.md"
            edited = "# Requirements\n\nPersist the result.\n"
            spec.write_text(edited)
            records = directory / "review-records.json"
            issue = {
                "id": "I1", "depends_on": [], "issue": "Persistence",
                "recommendation": "Persist the result.", "rationale": "Recover it later.", "evidence": "Requirement",
                "strategic_impact_value": "high", "strategic_impact_reason": "Keeps data",
                "cost_value": "low", "cost_reason": "Existing storage",
                "externally_observable_value": True, "externally_observable_reason": "Survives restart",
            }
            records.write_text(json.dumps({"records": {"I1": {"issue": issue, "applied": False}},
                                          "status": "in-progress"}))
            url, token, _, server = self.launch(directory)
            self.assertEqual(self.announcement["verification_needed"], ["I1"])

            def post(action, **payload):
                return self.model({"event": {"action": action, **payload}}, url=url, token=token)

            self.assertEqual(post("applied", ids=["I1"])[0], 400)
            self.assertEqual(post("set_verification", verifications={"I1": "Inspect persistence."})[0], 200)
            malformed = edited + f"\n## Acceptance criteria\n\n{START}\n"
            spec.write_text(malformed)
            self.assertEqual(post("applied", ids=["I1"])[0], 400)
            self.assertEqual(spec.read_text(), malformed)
            self.assertFalse(json.loads(records.read_text())["records"]["I1"]["applied"])
            server.terminate()
            server.wait(timeout=5)
            url, token, _, server = self.launch(directory)
            self.assertNotIn("verification_needed", self.announcement)

            spec.write_text(edited)
            unapplied_records = records.read_bytes()
            self.assertEqual(post("applied", ids=["I1"])[0], 200)
            written = spec.read_bytes()
            written_at = spec.stat().st_mtime_ns
            self.assertTrue(written.startswith(edited.encode()))
            self.assertIn(b"Inspect persistence.", written)
            self.assertTrue(json.loads(records.read_text())["records"]["I1"]["applied"])
            self.assertEqual(post("applied", ids=["I1"])[0], 200)

            # Recover the state left when only the specification write succeeded.
            server.terminate()
            server.wait(timeout=5)
            records.write_bytes(unapplied_records)
            url, token, _, _ = self.launch(directory)
            self.assertEqual(post("applied", ids=["I1"])[0], 200)
            self.assertEqual(spec.read_bytes(), written)
            self.assertEqual(spec.stat().st_mtime_ns, written_at)
            self.assertTrue(json.loads(records.read_text())["records"]["I1"]["applied"])

    def test_api_accepts_either_credential_from_its_server(self):
        payload = {"event": {"action": "status", "ids": []}}
        self.assertEqual(self.request("/api/model-events", payload, {"Origin": self.origin})[0], 401)
        self.assertEqual(self.request(NEXT_EVENT)[0], 401)
        cookie = self.browser_cookie()
        self.assertEqual(self.request(
            "/api/model-events", payload, {"Cookie": cookie, "Origin": self.origin},
        )[0], 200)
        self.assertEqual(self.request(
            "/api/model-events", payload, {"Authorization": self.model_headers["Authorization"]},
        )[0], 403)
        self.assertEqual(self.model(payload, headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.request(NEXT_EVENT, headers={**self.model_headers, "Origin": "null"})[0], 403)
        self.assertEqual(self.model(payload, headers={"Host": "example.test"})[0], 403)
        self.assertEqual(self.request("/api/state", headers=self.model_headers)[0], 200)
        directory = self.directory / "other"
        directory.mkdir()
        other_url, other_token, _, _ = self.launch(directory)
        self.assertEqual(self.model(payload, url=other_url)[0], 401)
        self.assertEqual(self.request("/api/state", headers={"Cookie": cookie}, url=other_url)[0], 401)
        self.assertEqual(self.model(payload, token=other_token, url=other_url)[0], 200)
        self.assertEqual(self.model(payload)[0], 200)

    def test_records_have_one_owner_and_status_does_not_write(self):
        records = self.directory / "review-records.json"
        status = {"event": {"action": "status"}}
        code, initial = self.model(status)
        self.assertEqual(code, 200)
        self.assertIsNotNone(initial["started_at"])
        self.assertFalse(records.exists())
        duplicate = subprocess.run(
            [sys.executable, SERVER, "--review-dir", self.directory, "--spec", self.directory / "SPEC.md"],
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(duplicate.returncode, 1)
        self.assertIn("A server already owns the review directory", duplicate.stderr)
        self.assertEqual(self.model({"event": {"action": "facts", "facts": []}})[0], 200)
        self.assertEqual(json.loads(records.read_text())["started_at"], initial["started_at"])
        saved = records.stat()
        self.assertEqual(self.model(status)[0], 200)
        self.assertEqual(records.stat(), saved)

    def test_cli_submit_routes_issue_and_resumes_after_accept(self):
        fixture = Path(__file__).with_name("fixtures") / "submit.json"
        payload = fixture.read_text(encoding="utf-8")
        EVENT_VALIDATOR.validate(json.loads(payload)["event"])
        result = subprocess.check_output(
            [API.parent / "bin" / "spec-baking", "client", "--session", self.session, "post"],
            input=payload, text=True, timeout=5, env={**os.environ, "SPEC_BAKING_VENV": sys.prefix},
        )
        self.assertEqual(json.loads(result), {
            "status": "in-progress", "frontier": ["I1"], "recheck": [], "apply": [],
        })

        accepted = self.model({"event": {"action": "accept", "id": "I1"}})[1]
        self.server.terminate()
        self.server.wait(timeout=5)
        self.launch(self.directory)
        self.assertTrue(self.announcement["resumed"])
        for key in ("status", "frontier", "recheck", "apply", "resolutions"):
            self.assertEqual(self.announcement[key], accepted[key])
        self.assertEqual(accepted["apply"], ["I1"])

    def test_browser_decisions_wake_the_agent_at_the_batch_boundary(self):
        headers = {"Cookie": self.browser_cookie(), "Origin": self.origin}
        issue = {
            "id": "I1", "depends_on": [], "issue": "Decision", "recommendation": "Choose A",
            "verification": "Identify the selected option.",
            "rationale": "Reason", "evidence": "Source", "strategic_impact_value": "high",
            "strategic_impact_reason": "Impact", "cost_value": "high", "cost_reason": "Cost",
            "externally_observable_value": True, "externally_observable_reason": "Visible",
        }
        self.assertEqual(self.model({"event": {"action": "submit", "issues": [
            issue, {**issue, "id": "I2"},
        ]}})[0], 200)

        def decide(event):
            revision = self.request("/api/state", headers=headers)[1]["revision"]
            payload = {"revision": revision, "request_id": str(uuid4()), "event": event}
            status, receipt = self.request("/api/decision", payload, headers)[:2]
            self.assertEqual(status, 200)
            self.assertTrue(receipt["ok"])
            return payload, receipt

        with closing(http.client.HTTPConnection(self.url.netloc, timeout=3)) as poll:
            poll.request("GET", NEXT_EVENT, headers=self.model_headers)
            _, first = decide({"action": "accept", "id": "I1"})
            self.assertEqual(first["result"]["frontier"], ["I2"])
            self.assertEqual(first["result"]["apply"], [])
            self.assertFalse(select.select([poll.sock], [], [], 0.1)[0])

            payload, second = decide({"action": "defer", "id": "I2", "reason": "Later", "boundary": "Keep reads"})
            self.assertEqual(second["result"]["apply"], ["I1", "I2"])
            self.assertEqual(json.load(poll.getresponse()), second["result"])

        _, latest = decide({"action": "edit", "id": "I1", "decision": "Choose B"})
        self.assertEqual(self.request("/api/decision", payload, headers)[:2], (200, second))
        self.assertEqual(self.request(NEXT_EVENT, headers=self.model_headers)[:2], (200, latest["result"]))

        log = self.directory / "conversation.jsonl"
        self.server.terminate()
        self.server.wait(timeout=5)
        entries = log.read_text().splitlines(keepends=True)
        self.assertEqual(json.loads(entries[-1]), latest)
        log.write_text("".join(entries[:-1]))
        self.url, self.token, _, _ = self.launch(self.directory, browser=True)
        headers = {"Cookie": self.browser_cookie(), "Origin": self.url.geturl()}
        self.assertEqual(self.announcement["resolutions"], latest["result"]["resolutions"])
        revision = self.request("/api/state", headers=headers)[1]["revision"]
        retry = {"revision": revision, "request_id": latest["request_id"],
                 "event": {"action": "edit", "id": "I1", "decision": "Choose B"}}
        status, receipt = self.request("/api/decision", retry, headers)[:2]
        self.assertEqual(status, 200)
        self.assertEqual(receipt["result"], latest["result"])
        self.assertEqual(self.request("/api/decision", retry, headers)[:2], (200, receipt))

    def test_model_events_apply_and_answer_browser_requests(self):
        headers = {"Cookie": self.browser_cookie(), "Origin": self.origin}
        client = [sys.executable, API / "model_events.py", "--session", self.session]
        issue = {
            "id": "I1", "depends_on": [], "issue": "An open decision",
            "recommendation": "Accept the proposed approach", "rationale": "Known tradeoff",
            "evidence": "Test evidence",
            "verification": "Identify the chosen approach.",
            "strategic_impact_value": "high", "strategic_impact_reason": "Changes behavior",
            "cost_value": "high", "cost_reason": "Expensive to reverse",
            "externally_observable_value": True, "externally_observable_reason": "Visible to callers",
        }
        status, result = self.model({"event": {"action": "submit", "issues": [issue]}})
        self.assertEqual(status, 200)
        self.assertEqual(result["frontier"], ["I1"])

        def browser_request(event):
            state = self.request("/api/state", headers=headers)[1]
            self.assertFalse(state["pending"])
            self.assertIn(event["action"], state["actions"]["I1"])
            payload = {"request_id": str(uuid4()), "revision": state["revision"], "event": {"id": "I1", **event}}
            status, data, _ = self.request("/api/decision", payload, headers)
            self.assertEqual(status, 202 if event["action"] == "clarify" else 200, data)
            self.assertEqual(self.request("/api/decision", payload, headers)[:2], (status, data))
            return data

        with closing(http.client.HTTPConnection(self.url.netloc, timeout=3)) as poll:
            poll.request("GET", NEXT_EVENT, headers=self.model_headers)
            self.assertFalse(select.select([poll.sock], [], [], 0.1)[0])
            clarify = browser_request({"action": "clarify", "question": "Why?"})
            response = poll.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response), {
                **clarify,
                "clarification": {"action": "clarify", "id": "I1", "question": "Why?"},
            })
        result = json.loads(subprocess.check_output(
            [*client, "post"], input=json.dumps({**clarify, "answer": "It meets the requirement."}),
            text=True, timeout=5,
        ))
        self.assertEqual(result["clarification"],
                         {"id": "I1", "question": "Why?", "answer": "It meets the requirement."})
        state = self.request("/api/state", headers=headers)[1]
        self.assertFalse(state["pending"])
        self.assertIsNone(state["pending_clarification"])
        self.assertEqual(state["response"]["request_id"], clarify["request_id"])
        self.assertEqual(state["clarifications"]["I1"], [result["clarification"]])
        self.assertEqual(self.model({**clarify, "answer": "Retry"}), (200, result))
        self.assertEqual(self.request("/api/state", headers=headers)[1]["clarifications"], state["clarifications"])
        accept = browser_request({"action": "accept"})
        self.assertEqual(self.request("/api/state", headers=headers)[1]["response"], accept)
        for _ in range(2):
            self.assertEqual(self.request(NEXT_EVENT, headers=self.model_headers)[:2], (200, accept["result"]))
        result = json.loads(subprocess.check_output([*client, "next"], timeout=5))
        self.assertEqual(result["apply"], ["I1"])
        self.assertEqual(result["resolutions"], {"I1": {
            "status": "accepted", "source": "user accept", "decision": "Accept the proposed approach",
        }})
        state = self.request("/api/state", headers=headers)[1]
        self.assertFalse(state["pending"])
        self.assertEqual(state["response"]["request_id"], accept["request_id"])
        self.assertEqual(state["review"]["records"]["I1"]["resolution"]["status"], "accepted")
        self.assertEqual(self.model({"request_id": accept["request_id"]}), (200, result))
        self.assertEqual(self.model({"event": {"action": "applied", "ids": ["I1"]}})[0], 200)
        original = (self.directory / "SPEC.md").read_text()
        self.assertIn("Expected value** — Accept the proposed approach", original)

        self.assertEqual(self.model({"event": {"action": "finish"}})[1]["status"], "complete")
        complete = self.request("/api/state", headers=headers)[1]
        self.assertEqual(complete["review"]["status"], "complete")
        self.assertTrue(complete["active"])
        self.assertIn("edit", complete["actions"]["I1"])
        with closing(http.client.HTTPConnection(self.url.netloc, timeout=3)) as poll:
            poll.request("GET", NEXT_EVENT, headers=self.model_headers)
            self.assertFalse(select.select([poll.sock], [], [], 0.1)[0])
            edit = browser_request({"action": "edit", "decision": "Use the revised approach"})
            response = poll.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response), edit["result"])
        result = json.loads(subprocess.check_output([*client, "next"], timeout=5))
        self.assertEqual(result["status"], "in-progress")
        self.assertEqual(result["apply"], ["I1"])
        self.assertEqual(result["resolutions"], {"I1": {
            "status": "accepted", "source": "user edit", "decision": "Use the revised approach",
        }})
        revised = self.model({"event": {"action": "status"}})[1]["records"]["I1"]
        self.assertEqual(revised["resolution"]["decision"], "Use the revised approach")
        self.assertEqual(result["verification_needed"], ["I1"])
        self.assertEqual(self.model({"event": {"action": "set_verification", "verifications": {
            "I1": "Inspect the revised approach.",
        }}})[0], 200)
        self.assertEqual(self.model({"event": {"action": "applied", "ids": ["I1"]}})[0], 200)
        generated = (self.directory / "SPEC.md").read_text()
        self.assertEqual(generated.count("spec-baking:criterion I1"), 1)
        self.assertIn("Expected value** — Use the revised approach", generated)
        self.assertIn("Inspect the revised approach.", generated)
        self.assertNotIn("Accept the proposed approach", generated)
        self.assertEqual(self.model({"event": {"action": "finish"}})[1]["status"], "complete")

        stale_revision = self.request("/api/state", headers=headers)[1]["revision"]
        self.assertEqual(self.model({"event": {
            "action": "facts", "facts": [{"fact": "New evidence", "source": "Test source"}],
        }})[0], 200)
        stale = {"request_id": str(uuid4()), "revision": stale_revision,
                 "event": {"action": "edit", "id": "I1", "decision": "A stale revision"}}
        status, result, _ = self.request("/api/decision", stale, headers)
        self.assertEqual(status, 400)
        self.assertIn("review has changed", result["error"])
        self.assertEqual(self.model({"event": {"action": "finish"}})[1]["status"], "complete")

        close = {"action": "close_session"}
        self.assertEqual(self.request(CLOSE_SESSION, close, {"Origin": self.origin})[0], 401)
        self.assertEqual(self.request(CLOSE_SESSION, close, {**headers, "Origin": "null"})[0], 403)
        self.assertEqual(self.request(CLOSE_SESSION, {"action": "finish"}, headers)[0], 400)
        with closing(http.client.HTTPConnection(self.url.netloc, timeout=3)) as poll:
            poll.request("GET", NEXT_EVENT, headers=self.model_headers)
            self.assertFalse(select.select([poll.sock], [], [], 0.1)[0])
            self.assertEqual(self.request(CLOSE_SESSION, close, headers)[0], 204)
            response = poll.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response), close)
        self.assertEqual(json.loads(subprocess.check_output([*client, "next"], timeout=5)), close)
        self.assertFalse(self.request("/api/state", headers=headers)[1]["active"])
        self.assertEqual(self.model({"event": {"action": "status"}})[1]["status"], "complete")

        log = self.directory / "conversation.jsonl"
        entries = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([entry["type"] for entry in entries],
                         ["agent", "request", "response", "request", "response", "agent", "agent",
                          "request", "response", "agent", "agent", "agent", "agent", "agent", "agent", "agent"])
        timestamps = [datetime.fromisoformat(entry["received_at"]) for entry in entries]
        for timestamp in timestamps:
            self.assertEqual(timestamp.utcoffset(), timedelta(0))
        for index in (1, 3, 7):
            self.assertEqual(entries[index]["request_id"], entries[index + 1]["request_id"])
            self.assertLessEqual(timestamps[index], timestamps[index + 1])

        # A request appended by another process is picked up on startup only.
        older_id = "older-unanswered"
        request_id = "recover-unanswered"
        with log.open("a", encoding="utf-8") as stream:
            for identifier, question in [
                (older_id, "What was the reason?"),
                (request_id, "Can this be recovered?"),
            ]:
                stream.write(json.dumps({
                    "type": "request", "request_id": identifier, "received_at": entries[-1]["received_at"],
                    "event": {"action": "clarify", "id": "I1", "question": question},
                }) + "\n")
        reply = {"request_id": request_id, "answer": "Yes."}
        self.assertEqual(self.model(reply), (400, {"error": f"Unknown review request {request_id}"}))

        self.server.terminate()
        self.server.wait(timeout=5)
        self.url, self.token, _, _ = self.launch(self.directory, browser=True)
        headers = {"Cookie": self.browser_cookie()}
        restored = self.request("/api/state", headers=headers)[1]
        self.assertEqual(restored["review"]["status"], "complete")
        self.assertEqual(restored["review"]["records"]["I1"]["resolution"]["decision"],
                         "Use the revised approach")
        self.assertEqual(restored["clarifications"], state["clarifications"])
        self.assertTrue(restored["pending"])
        recovered_poll = {"request_id": request_id, "clarification": restored["pending_clarification"]}
        self.assertEqual(self.request(NEXT_EVENT, headers={"Authorization": f"Bearer {self.token}"})[:2],
                         (200, recovered_poll))
        retry_headers = {**headers, "Origin": self.url.geturl()}
        self.assertEqual(self.request("/api/decision", {
            "request_id": request_id, "revision": "old", "event": restored["pending_clarification"],
        }, retry_headers)[:2], (202, {"request_id": request_id}))
        self.assertEqual(self.model({**clarify, "answer": "Retry"}),
                         (200, {"clarification": restored["clarifications"]["I1"][0]}))
        status, older = self.model({"request_id": older_id, "answer": "Here is the reason."})
        self.assertEqual(status, 200)
        still_pending = self.request("/api/state", headers=headers)[1]
        self.assertTrue(still_pending["pending"])
        self.assertEqual(still_pending["pending_clarification"], recovered_poll["clarification"])
        status, recovered = self.model(reply)
        self.assertEqual(status, 200)
        self.assertEqual(recovered["clarification"]["answer"], "Yes.")
        self.assertEqual(self.model(reply), (200, recovered))
        self.assertEqual(self.request("/api/state", headers=headers)[1]["clarifications"]["I1"],
                         [*restored["clarifications"]["I1"], older["clarification"], recovered["clarification"]])


if __name__ == "__main__":
    unittest.main()
