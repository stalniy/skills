"""Exchange events with a running spec review."""

import argparse
import http.client
import json
import re
import sys
from pathlib import Path

EVENTS = "/api/model-events"


def session_credentials(path):
    session = json.loads(path.read_text(encoding="utf-8"))
    port, token = session["port"], session["token"]
    if type(port) is not int or not 0 < port <= 65535 or not re.fullmatch(r"[A-Za-z0-9_-]+", token):
        raise ValueError("Invalid model session file")
    return port, token


class ModelEvents:
    def __init__(self, port, token):
        self.port = port
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{port}",
        }

    def request(self, method, path, body=None):
        # The server ends an idle GET after 30 seconds.
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=35)
        try:
            connection.request(method, path, body=body, headers=self.headers)
            response = connection.getresponse()
            data = response.read()
        finally:
            connection.close()
        if response.status == 204 and method == "GET":
            return None
        if response.status != 200:
            try:
                error = json.loads(data)["error"]
            except (ValueError, KeyError, TypeError):
                error = response.reason
            raise ValueError(f"HTTP {response.status}: {error}")
        return json.loads(data)

    def next_event(self):
        while True:
            event = self.request("GET", EVENTS)
            if event is not None:
                return event


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", type=Path, required=True, help="Model session file reported by the server")
    parser.add_argument("command", choices=("post", "next"),
                        help="Post JSON from stdin or wait for the next event that needs the agent")
    args = parser.parse_args()
    try:
        client = ModelEvents(*session_credentials(args.session))
        if args.command == "post":
            result = client.request("POST", EVENTS, sys.stdin.buffer.read())
        else:
            result = client.next_event()
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Model events: {error}\n")
    except KeyboardInterrupt:
        parser.exit(130)


if __name__ == "__main__":
    main()
