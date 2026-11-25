import { html, LitElement } from "lit";

class ReviewTabs extends LitElement {
  static properties = {
    view: { attribute: false },
  };

  createRenderRoot() {
    return this;
  }

  requestView(view) {
    this.dispatchEvent(new CustomEvent("review-view-change", { detail: view }));
  }

  selectView(event) {
    this.requestView(event.currentTarget.dataset.view);
  }

  handleTabKey(event) {
    const next = {
      Home: "graph",
      End: "spec",
      ArrowLeft: this.view === "graph" ? "spec" : "graph",
      ArrowRight: this.view === "graph" ? "spec" : "graph",
    }[event.key];
    if (!next) return;
    event.preventDefault();
    this.requestView(next);
    this.querySelector(`#${next}-tab`).focus();
  }

  render() {
    return html`
      <div class="review-tabs" role="tablist" aria-label="Review view">
        ${[["graph", "Graph"], ["spec", "Spec"]].map(([view, label]) => html`
          <button type="button" id=${`${view}-tab`}
            role="tab"
            data-view=${view}
            aria-selected=${String(this.view === view)}
            aria-controls=${`${view}-panel`}
            tabindex=${this.view === view ? 0 : -1}
            @click=${this.selectView} @keydown=${this.handleTabKey}>${label}</button>
        `)}
      </div>
    `;
  }
}

customElements.define("review-tabs", ReviewTabs);
