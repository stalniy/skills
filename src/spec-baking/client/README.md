# Spec review browser

From the repository root, install the locked npm dependencies and build the browser client.

```sh
npm ci
npm run build:spec-baking
```

Vite writes optimized, hashed JavaScript and CSS to `src/spec-baking/client/dist/`. Rebuild after editing the client. The Python server serves that directory on the same origin as the review API. Node.js is only needed to build the client.

The client entry point is `src/app.js`. Each child Lit component has its own file in `src/components/`.

Start or resume the review in agent chat and choose **interactive browser**. The skill launches a local HTTP server on `127.0.0.1` and prints the browser URL. The launcher also tries to open it in the default browser with `--open`.

The browser talks to the local API. The review's append-only `conversation.jsonl` records agent events alongside browser requests and responses. Each new entry has a UTC `received_at` timestamp for the incoming call. Match a browser request and response by request ID and subtract their timestamps to measure the time from the browser submission to the saved decision receipt or the agent's clarification answer. The server scans the log on startup to recover unanswered requests, saved replies, clarification history, and agent progress. While the graph animation is running, the browser shows progress below it in newest-first order. During the session the server handles replies and retries from memory and appends new entries to the log. The graph and specification use the saved review artifacts.

Use **Graph** to inspect dependencies and submit decisions. Choose **Clarify** on an open issue to ask the agent a question and send follow-ups in the same dialog. Select **Spec** to load the current specification from disk. You can revise decisions after the review is marked complete. If you confirm the browser’s prompt to leave the page, the browser signals the agent to end the session. To resume, return to chat and choose the browser again.

