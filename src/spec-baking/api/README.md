# Spec baking review server

Set `$skill_dir` to the absolute path of the skill directory that contains `api/`. Pass an existing specification with `--spec FILE`, or create a fresh `SPEC.md` from stdin with `--spec-stdin`. The launcher creates the review directory if needed. Add `--open` to launch the browser interface. For a restricted environment, follow the startup instructions below.

```sh
"$skill_dir/bin/spec-baking" start --review-dir "$review_dir" --spec "$spec_path"
```

Pass the `session_file` from the startup JSON to `python3 "$skill_dir/api/model_events.py" --session "$session_file" post` or `next` to send review events and wait for browser input. The skill's Review engine section covers startup output, client commands, event payloads and recovery.

One server owns each review directory. Read review state and submit changes through the model-events client.

For a fresh review, send `capture_source` with the goal, existing requirements, and exclusions before submitting decisions. Propose requirement operations in `requirement_changes`. After a user revision, send `set_requirement_changes` and update verification when routing requests them. The server renders `SPEC.md` in the review directory on apply and finish. If its source occupies that path, the server preserves the input as `SOURCE.md`.

Reviews started without source capture use the original workflow. The model applies decisions to the prose and then sends `applied`. The server updates the delimited acceptance criteria in the selected specification.

## Browser decisions

`POST /api/decision` takes `request_id`, `revision`, and the review `event`. For accept, edit, and defer, the server saves the decision in the request and returns an HTTP 200 receipt with `request_id`, `ok`, and `result`. Retry an interrupted submission with the same request ID and event to retrieve its original receipt. Clarification submissions return HTTP 202 with a request ID while the agent prepares an answer.

`next` receives clarification requests and the current routing when a browser decision makes issues ready for application or recheck, or leaves the review ready for discovery. Decisions within a batch can be saved while the agent waits.

## Startup in a restricted environment

The launcher uses a prepared interpreter when available and otherwise runs `uv run --script`. If uv cannot access its cache or dependencies, prepare Python once from a terminal with access to the package index. The default location works across installations. Set `SPEC_BAKING_VENV` to use a different absolute path.

```sh
spec_baking_venv=${SPEC_BAKING_VENV:-${XDG_CACHE_HOME:-$HOME/.cache}/spec-baking/venv}
mkdir -p "$(dirname "$spec_baking_venv")"
uv venv --python 3.10 "$spec_baking_venv"
uv pip install --python "$spec_baking_venv/bin/python" -r "$skill_dir/api/server.py"
"$spec_baking_venv/bin/python" "$skill_dir/api/server.py" --help
```

The launcher uses `"$spec_baking_venv/bin/python"` for the server. The model-events client uses the standard library and runs with `python3`. The interpreter uses the installed dependencies without contacting the package index and avoids the PyInstaller launcher's macOS semaphore requirement. Both chat and browser modes require permission to bind to `127.0.0.1` and send requests to the resulting local port. If the sandbox denies loopback, use a permitted launch and local requests.
