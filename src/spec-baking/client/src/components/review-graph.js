import { html, LitElement, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import { repeat } from "lit/directives/repeat.js";
import { decisionPaths, drawEdges, INSET, NODE_HEIGHT, NODE_WIDTH, statusLabel, STEP_X, STEP_Y } from "../graph.js";
import "./frontier-network.js";
import "./review-decision.js";

function position({ x, y }) {
  return `left: ${x}rem; top: ${y}rem`;
}

const progressTime = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

function renderProgressTime(timestamp) {
  const received = new Date(timestamp);
  return html`<time datetime=${timestamp} title=${received.toLocaleString()}>${progressTime.format(received)}</time>`;
}

class ReviewGraph extends LitElement {
  static properties = {
    graph: { attribute: false },
    selectedId: { attribute: false },
    frontierSourceId: { attribute: false },
    spinnerNodeId: { attribute: false },
    progress: { attribute: false },
    complete: { attribute: false },
    emptyMessage: { attribute: false },
    actions: { attribute: false },
    active: { attribute: false },
    busy: { attribute: false },
    clarification: { attribute: false },
  };

  constructor() {
    super();
    this.frontierSourceId = null;
    this.spinnerNodeId = null;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this.entering = new Set();
    this.resizeObserver = new ResizeObserver(() => {
      const view = this.querySelector("#graph-view");
      if (this.clientWidth) {
        const percentage = Math.round(100 * view.clientWidth / this.clientWidth);
        this.querySelector("#review-divider").setAttribute("aria-valuenow", String(percentage));
      }
      this.drawGraph();
    });
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.reducedMotion.addEventListener("change", this.drawGraph);
    if (this.hasUpdated) this.observeGraph();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.reducedMotion.removeEventListener("change", this.drawGraph);
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.drawFrame);
    this.drawFrame = undefined;
  }

  firstUpdated() {
    if (this.isConnected) this.observeGraph();
  }

  willUpdate(changed) {
    if (changed.has("graph") || changed.has("selectedId")) this.paths = decisionPaths(this.graph, this.selectedId);
  }

  updated(changed) {
    if (changed.has("graph")) this.animateNewNodes(changed.get("graph"));
    if (["graph", "selectedId", "frontierSourceId", "complete"].some(property => changed.has(property))) {
      this.drawGraph();
    }
  }

  observeGraph() {
    this.resizeObserver.observe(this.querySelector("#graph-view"));
    this.resizeObserver.observe(this);
  }

  animateNewNodes(previous) {
    if (!previous || this.reducedMotion.matches || this.hidden) return;
    const nodes = [...this.querySelectorAll("button[data-node-id]")]
      .filter(node => !previous.byId.has(node.dataset.nodeId));
    nodes.forEach((node, index) => {
      this.entering.add(node);
      const animation = node.animate([
        { opacity: 0, transform: `translate(${(index % 3 - 1) * .6}rem, -1.25rem) scale(.94)` },
        { opacity: getComputedStyle(node).opacity, transform: "none" },
      ], { duration: 380, delay: Math.min(index * 45, 200), easing: "ease-out", fill: "backwards" });
      const settle = () => this.entering.delete(node);
      animation.onfinish = settle;
      animation.oncancel = settle;
    });
  }

  drawGraph = () => {
    const view = this.querySelector("#graph-view");
    const map = view?.querySelector(".map");
    if (!this.isConnected || !map || !view.clientWidth || !view.clientHeight) return;
    drawEdges(view, this.graph, this.paths, this.entering);
    if (this.drawFrame === undefined && this.entering.size) {
      this.drawFrame = requestAnimationFrame(() => {
        this.drawFrame = undefined;
        this.drawGraph();
      });
    }
  }

  selectDecision(id) {
    this.dispatchEvent(new CustomEvent("decision-select", { detail: id }));
  }

  resizeGraph(pixels) {
    this.style.setProperty("--graph-width", `${100 * pixels / this.clientWidth}%`);
  }

  startResize(event) {
    if (event.button !== 0 || this.resizePointer !== undefined) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const view = this.querySelector("#graph-view");
    this.resizePointer = event.pointerId;
    this.resizeOffset = event.clientX - view.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    this.classList.add("resizing");
  }

  moveResize(event) {
    if (event.pointerId === this.resizePointer) this.resizeGraph(event.clientX - this.resizeOffset);
  }

  finishResize(event) {
    if (event.pointerId !== this.resizePointer) return;
    this.resizePointer = undefined;
    this.classList.remove("resizing");
  }

  handleResizeKey(event) {
    const width = this.querySelector("#graph-view").getBoundingClientRect().width;
    const step = event.shiftKey ? 50 : 16;
    const target = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: 0,
      End: this.clientWidth,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    this.resizeGraph(target);
  }

  renderMap() {
    const { nodes, points, rows, columns } = this.graph;
    const { selectedId, spinnerNodeId, emptyMessage } = this;
    const waiting = this.frontierSourceId !== null;
    const count = nodes.filter(node => node.issue).length;
    if (!nodes.length && !waiting && !this.complete) return html`<p class="graph-empty">${emptyMessage}</p>`;

    const width = INSET * 2 + STEP_X * (columns - 1) + NODE_WIDTH;
    const height = INSET * 2 + STEP_Y * (rows - 1) + NODE_HEIGHT;
    const mapHeight = waiting
      ? `calc(${height}rem + var(--frontier-network-gap) + var(--frontier-network-height))`
      : `${height}rem`;
    return html`
      <div class="map" style=${`width: ${width}rem; height: ${mapHeight}`}>
        <canvas aria-hidden="true"></canvas>
        <div class="node map-root" style=${position(points.get(""))} ?data-complete=${this.complete}
          data-path=${this.paths.get("") ?? nothing} aria-busy=${spinnerNodeId === ""}>
          Spec review<span>${count} ${count === 1 ? "decision" : "decisions"}</span>
          ${spinnerNodeId === "" ? html`<i class="node-spinner" aria-hidden="true"></i>` : nothing}
        </div>
        ${repeat(nodes, node => node.id, node => {
          const selected = node.id === selectedId;
          const label = node.title || (node.status === "out-of-scope" ? node.issue.issue : node.decision || node.issue.issue);
          return html`
            <button type="button" class="node" style=${position(points.get(node.id))}
              data-node-id=${node.id}
              data-status=${node.status}
              data-path=${this.paths.get(node.id) ?? nothing}
              aria-pressed=${String(selected)}
              aria-busy=${spinnerNodeId === node.id}
              @click=${() => this.selectDecision(node.id)}
            >
              <strong>${node.status === "function" ? statusLabel(node) : `${node.id} · ${statusLabel(node)}`}</strong>
              <span>${label}</span>
              ${spinnerNodeId === node.id ? html`<i class="node-spinner" aria-hidden="true"></i>` : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }

  renderProgress() {
    const latest = this.progress?.at(-1);
    if (!latest) return nothing;
    const history = this.progress.slice(0, -1).reverse();
    return html`
      <details class="graph-progress">
        <summary>
          ${renderProgressTime(latest.received_at)}
          <span class="graph-progress-latest" aria-live="polite" aria-atomic="true">${latest.message}</span>
          <span class="sr-only">Toggle model status history</span>
        </summary>
        ${history.length ? html`
          <ol role="list" aria-label="Earlier model updates, newest first">
            ${repeat(history, (_, index) => history.length - index, ({ message, received_at }) => html`
              <li>${renderProgressTime(received_at)} <span>${message}</span></li>
            `)}
          </ol>
        ` : nothing}
      </details>
    `;
  }

  render() {
    const node = this.graph?.byId.get(this.selectedId);
    return html`
      <div id="graph-view" class="graph-view" tabindex="0" aria-label="Dependency mind map" @scroll=${this.drawGraph}>
        ${guard([this.graph, this.selectedId, this.frontierSourceId, this.spinnerNodeId, this.complete, this.emptyMessage],
          () => this.graph ? this.renderMap() : nothing)}
        ${guard([this.progress, this.frontierSourceId === null], () => this.renderProgress())}
      </div>
      <div id="review-divider" class="splitter" role="separator" tabindex="0"
        aria-label="Resize graph and details" aria-controls="graph-view" aria-orientation="vertical"
        ?hidden=${!node} @pointerdown=${this.startResize} @pointermove=${this.moveResize}
        @pointerup=${this.finishResize} @pointercancel=${this.finishResize} @lostpointercapture=${this.finishResize}
        @keydown=${this.handleResizeKey}></div>
      <review-decision
        id="decision-pane"
        class="decision-pane"
        role="complementary"
        aria-label="Selected graph item"
        ?hidden=${!node}
        .node=${node}
        .actions=${this.actions}
        .active=${this.active}
        .busy=${this.busy}
        .clarification=${this.clarification}
        @decision-clear=${() => this.selectDecision(null)}></review-decision>
    `;
  }
}

customElements.define("review-graph", ReviewGraph);
