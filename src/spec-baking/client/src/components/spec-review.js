import { html, LitElement, nothing } from "lit";
import { graphLayout } from "../graph.js";

class SpecReview extends LitElement {
  static properties = {
    snapshot: { state: true },
    graph: { state: true },
    selectedId: { state: true },
    view: { state: true },
    specification: { state: true },
    specLoading: { state: true },
    specError: { state: true },
    submission: { state: true },
    frontierOrigin: { state: true },
    readError: { state: true },
    actionError: { state: true },
    now: { state: true },
  };

  constructor() {
    super();
    this.snapshot = null;
    this.graph = graphLayout(null);
    this.selectedId = null;
    this.view = "graph";
    this.now = Date.now();
    this.submitDecision = this.submit.bind(this);
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.snapshot?.active !== false) this.connectToState();
    this.durationTimer = setInterval(() => {
      if (this.snapshot?.review?.started_at && !this.snapshot.review.ended_at) this.now = Date.now();
    }, 1000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stateEvents?.close();
    clearInterval(this.durationTimer);
  }

  closeSession = () => {
    if (this.snapshot?.active === false) return;
    const event = new Blob([JSON.stringify({ action: "close_session" })], { type: "application/json" });
    navigator.sendBeacon("/api/close-session", event);
  };

  connectToState() {
    const events = new EventSource("/api/state/events");
    this.stateEvents = events;
    events.onmessage = event => {
      const snapshot = JSON.parse(event.data);
      if (snapshot.revision !== this.snapshot?.revision) this.actionError = "";
      this.applySnapshot(snapshot);
      this.readError = "";
      if (!snapshot.active) events.close();
    };
    events.onerror = () => {
      this.readError = "The local review server is unavailable.";
    };
  }

  async changeView(event) {
    this.view = event.detail;
    if (this.view === "spec") await this.loadSpecification();
  }

  async loadSpecification() {
    const token = Symbol();
    this.specRequest = token;
    this.specLoading = true;
    this.specError = "";
    try {
      const specification = await request("/api/specification");
      if (this.specRequest === token) this.specification = specification;
    } catch (error) {
      if (this.specRequest === token) this.specError = error.message;
    } finally {
      if (this.specRequest === token) this.specLoading = false;
    }
  }

  applySnapshot(snapshot) {
    const previous = this.snapshot;
    const revisionChanged = previous?.revision !== snapshot.revision;
    const firstQuestion = !previous?.frontier.length && snapshot.frontier.length > 0;
    const afterDecision = previous?.revision && revisionChanged && (this.submission || previous.pending);
    const graphVersion = JSON.stringify(snapshot.review);
    if (graphVersion !== this.graphVersion) {
      this.graphVersion = graphVersion;
      this.graph = graphLayout(snapshot.review);
      const id = firstQuestion || afterDecision ? snapshot.frontier[0] : this.selectedId;
      this.selectedId = this.graph.byId.has(id) ? id : null;
    }
    this.snapshot = snapshot;
    this.settleSubmission();
    if (this.view === "spec" && revisionChanged) this.loadSpecification();
  }

  settleSubmission() {
    const attempt = this.submission;
    if (attempt && (attempt.requestId === this.snapshot?.response?.request_id
        || (attempt.receipt && attempt.revision !== this.snapshot?.revision))) {
      this.submission = null;
    }
    if (this.frontierSourceId === null) this.frontierOrigin = null;
  }

  get busy() {
    return Boolean(this.snapshot?.pending || this.submission);
  }

  get frontierSourceId() {
    const state = this.snapshot;
    if (!state) return this.readError ? null : "";
    if (!state.active || state.pending_clarification || this.submission?.event.action === "clarify") return null;
    if (this.submission) return this.submission.event.id;
    if (state.error) return null;
    if (state.pending || (state.review?.status !== "complete" && !state.frontier.length)) {
      return this.graph.byId.has(this.frontierOrigin) ? this.frontierOrigin : "";
    }
    return null;
  }

  get spinnerNodeId() {
    if (this.frontierSourceId === null) return null;
    if (this.submission) return this.submission.event.id;
    return this.frontierOrigin == null && this.frontierSourceId === "" && !this.graph.nodes.length ? "" : null;
  }

  reviewStatus() {
    const state = this.snapshot;
    const error = this.readError || this.actionError || (!this.submission && state?.error);
    if (error) return { message: error, error: true };
    if (!state) return { message: "Loading the review…" };
    if (!state.active) return { message: "The review watcher has stopped. Resume the review in chat." };
    if (state.pending_clarification || this.submission?.event.action === "clarify") {
      return { message: "Request sent. Waiting for the agent." };
    }
    if (this.submission) return { message: "Saving decision…" };
    if (state.review?.status === "complete") {
      return { message: Object.keys(state.actions).length ? "Review complete. Select a decision to revise." : "Review complete." };
    }
    if (state.frontier.length) return { message: `Ready for your decision · ${state.frontier.join(", ")}` };
    if (this.frontierSourceId === null && Object.keys(state.actions).length) {
      return { message: "Select a decision to revise." };
    }
    return { message: "Waiting for the agent to prepare the next decisions." };
  }

  async submit(event, revision) {
    const state = this.snapshot;
    if (!state?.active || this.busy || revision !== state.revision || !state.actions[event.id]?.includes(event.action)) {
      throw new Error("The review has changed. Check the current decision and try again.");
    }
    this.actionError = "";
    const attempt = { event, revision, requestId: crypto.randomUUID() };
    const payload = { revision, event, request_id: attempt.requestId };
    this.submission = attempt;
    if (event.action !== "clarify") this.frontierOrigin = event.id;
    try {
      const receipt = await request("/api/decision", payload).catch(error => {
        if (!(error instanceof ReviewConnectionError)) throw error;
        return request("/api/decision", payload);
      });
      if (receipt.ok) attempt.receipt = receipt;
      this.settleSubmission();
    } catch (error) {
      if (this.submission === attempt) {
        this.submission = null;
        if (this.frontierOrigin === event.id) this.frontierOrigin = null;
      }
      throw error;
    }
  }

  async chooseAction(event) {
    const { action, node } = event.detail;
    if (action === "accept") {
      try {
        await this.submit({ id: node.id, action }, this.snapshot.revision);
      } catch (error) {
        this.actionError = error.message;
      }
      return;
    }
    await this.querySelector("review-action-dialog").open(action, node);
  }

  render() {
    const node = this.graph.byId.get(this.selectedId);
    const duration = reviewDuration(this.snapshot?.review, this.now);
    const complete = this.snapshot?.review?.status === "complete";
    const { message, error } = this.reviewStatus();
    const emptyMessage = this.snapshot?.review ? "This graph has no decisions."
      : this.snapshot ? "Decision files appear here as the review progresses."
      : "Decisions will appear here as the review progresses.";
    return html`
      <main class="workspace">
        <header class="topbar">
          <div class="folder">
            <h1>Spec review</h1>
            <code aria-label="Specification path">${this.snapshot?.specification_path}</code>
          </div>
          ${this.snapshot?.active ? html`<p>Leaving this page ends the review session.</p>` : nothing}
        </header>
        <section class="review" aria-label="Review">
          <header class="pane-heading">
            <review-tabs .view=${this.view} @review-view-change=${this.changeView}></review-tabs>
            <time id="review-duration" ?hidden=${!duration} datetime=${duration?.dateTime ?? nothing}>${duration?.label}</time>
          </header>
          <p class=${error ? "review-state error" : "review-state"} role="status">${message}</p>
          <review-graph
            id="graph-panel"
            class=${node ? "review-panel has-decision" : "review-panel"}
            role="tabpanel"
            aria-labelledby="graph-tab"
            ?hidden=${this.view !== "graph"}
            .graph=${this.graph}
            .selectedId=${this.selectedId}
            .frontierSourceId=${this.frontierSourceId}
            .spinnerNodeId=${this.spinnerNodeId}
            .progress=${this.snapshot?.agent_status_updates}
            .complete=${complete}
            .emptyMessage=${emptyMessage}
            .actions=${this.snapshot?.actions[node?.id]}
            .active=${this.snapshot?.active}
            .busy=${this.busy}
            .clarification=${this.snapshot?.clarifications[node?.id]?.at(-1)}
            @decision-select=${event => { this.selectedId = event.detail; }}
            @review-action=${this.chooseAction}
          ></review-graph>
          <review-specification id="spec-panel" class="review-panel spec-panel" role="tabpanel"
            aria-labelledby="spec-tab" tabindex="0" ?hidden=${this.view !== "spec"}
            .specification=${this.specification} .loading=${this.specLoading}
            .error=${this.specError}></review-specification>
        </section>
      </main>
      <review-action-dialog .snapshot=${this.snapshot} .submission=${this.submission}
        .busy=${this.busy} .submitDecision=${this.submitDecision}></review-action-dialog>
    `;
  }
}

customElements.define("spec-review", SpecReview);

class ReviewConnectionError extends Error {}

async function request(path, body) {
  let response, data;
  try {
    response = await fetch(path, body && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await response.json();
  } catch {
    throw new ReviewConnectionError("The local review server is unavailable.");
  }
  if (!response.ok) throw new Error(data.error);
  return data;
}

function reviewDuration(review, now) {
  const start = Date.parse(review?.started_at);
  const finished = Boolean(review?.ended_at);
  const end = finished ? Date.parse(review.ended_at) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  let remaining = Math.max(0, Math.floor((end - start) / 1000));
  const dateTime = `PT${remaining}S`;
  const parts = [];
  for (const [suffix, unit] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]) {
    const count = Math.floor(remaining / unit);
    if (count || suffix === "s") parts.push(`${count}${suffix}`);
    remaining %= unit;
  }
  return { dateTime, label: `${finished ? "Duration" : "Elapsed"} ${parts.join(" ")}` };
}
