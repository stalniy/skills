# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "jsonschema==4.26.0",
# ]
# ///
"""Run the local review server and optionally open its browser interface."""

import argparse
import json
import logging
import signal
import sys
import tempfile
import threading
import time
import webbrowser
from contextlib import ExitStack, closing
from pathlib import Path

sys.dont_write_bytecode = True

from review_engine import review_issues
from review_files import CONVERSATION_LOG_NAME, RECORDS_NAME, lock_review, open_conversation, read_conversation
from review_http import ReviewServer

IDLE_CLOSE_GRACE_SECONDS = 5


class ConversationHandler(logging.StreamHandler):
    def handleError(self, record):
        # The review API can only acknowledge an entry after it has been written.
        raise


def open_browser(url):
    try:
        opened = webbrowser.open(url)
    except (OSError, webbrowser.Error):
        opened = False
    if not opened:
        print(f"Browser launch URL: {url}", file=sys.stderr, flush=True)


def announce_session(server, session, auto_open):
    with tempfile.NamedTemporaryFile(mode="w", dir=session, delete=False, encoding="utf-8") as credential:
        json.dump({"port": server.server_port, "token": server.model_token}, credential)
    _, result = review_issues(server.records, server.state["review"],
                              {"action": "status", "ids": []}, started_at=server.started_at)
    server.started_at = result["started_at"]
    announcement = {"session_file": credential.name, "resumed": server.state["review"] is not None}
    routing_keys = ("status", "frontier", "recheck", "apply", "resolutions", "verification_needed",
                    "requirement_changes_needed")
    announcement.update({key: result[key] for key in routing_keys if key in result})
    print(json.dumps(announcement), flush=True)
    if auto_open:
        url = f"{server.origin}/session#{server.bootstrap}"
        threading.Thread(target=open_browser, args=(url,), daemon=True).start()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-dir", type=Path, required=True)
    spec = parser.add_mutually_exclusive_group(required=True)
    spec.add_argument("--spec", type=Path)
    spec.add_argument("--spec-stdin", action="store_true", help="Create SPEC.md from stdin for a fresh review")
    parser.add_argument("--open", action="store_true", help="Open the local review page")
    args = parser.parse_args()

    directory = args.review_dir.resolve()
    specification = args.spec.resolve() if args.spec else directory / "SPEC.md"
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        parser.exit(1, f"Cannot create review directory: {error}\n")
    if args.spec and not specification.is_file():
        parser.error("Choose an existing specification")

    try:
        with (
            lock_review(directory),
            tempfile.TemporaryDirectory(prefix="spec-review-") as session,
            ExitStack() as log_resources,
        ):
            if args.spec_stdin:
                if (directory / RECORDS_NAME).exists():
                    raise ValueError("Cannot create pasted specification for a resumed review")
                if specification.exists() or specification.is_symlink():
                    raise ValueError(f"Cannot create pasted specification exclusively: {specification} exists")
            log = directory / CONVERSATION_LOG_NAME
            conversation_logger = logging.Logger("spec-baking.conversation", logging.INFO)
            try:
                server = ReviewServer(log, specification, conversation_logger)
            except OSError as error:
                parser.exit(1, f"Cannot start the review listener on 127.0.0.1: {error}\n")
            with server:
                if args.spec_stdin:
                    try:
                        text = sys.stdin.read()
                        output = specification.open("x", encoding="utf-8")
                        try:
                            with output:
                                output.write(text)
                        except BaseException:
                            specification.unlink(missing_ok=True)
                            raise
                    except (OSError, UnicodeError) as error:
                        raise ValueError(f"Cannot create pasted specification exclusively: {error}") from error
                stream = log_resources.enter_context(open_conversation(log))
                handler = log_resources.enter_context(closing(ConversationHandler(stream)))
                conversation_logger.addHandler(handler)
                try:
                    server.restore_review()
                except (OSError, ValueError, KeyError, TypeError) as error:
                    raise ValueError(f"Cannot restore review records: {error}") from error
                try:
                    with closing(read_conversation(stream.buffer)) as entries:
                        server.restore_conversation(entries)
                    server.recover_browser_requests()
                except (OSError, ValueError, KeyError, TypeError) as error:
                    raise ValueError(f"Cannot restore review conversation: {error}") from error
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    try:
                        announce_session(server, session, args.open)
                    except (OSError, ValueError, KeyError, TypeError) as error:
                        raise ValueError(f"Cannot announce review session: {error}") from error
                    server.wait_until_idle()
                    # Give waiting clients time to receive the close event before stopping the listener.
                    time.sleep(IDLE_CLOSE_GRACE_SECONDS)
                finally:
                    server.close_session()
                    server.shutdown()
                    worker.join()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Cannot run review: {error}\n")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    main()
