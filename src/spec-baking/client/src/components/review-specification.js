import { html, LitElement } from "lit";
import { guard } from "lit/directives/guard.js";
import { markdown } from "../markdown.js";

class ReviewSpecification extends LitElement {
  static properties = {
    specification: { attribute: false },
    loading: { attribute: false },
    error: { attribute: false },
  };

  createRenderRoot() {
    return this;
  }

  render() {
    const spec = this.specification;
    return guard([spec?.path, spec?.text, this.loading, this.error], () => {
      if (this.loading) return html`<p class="review-empty" role="status">Loading the specification…</p>`;
      if (this.error) return html`<p class="review-empty" role="alert">${this.error}</p>`;
      if (spec) {
        return html`
          <code class="spec-path">${spec.path}</code>
          ${markdown(spec.text, true)}
        `;
      }

      return html`<p class="review-empty">The specification file is unavailable.</p>`;
    });
  }
}

customElements.define("review-specification", ReviewSpecification);
