import { css, html, LitElement, svg } from "lit";

const layers = [
  [
    [[14, 40], [10, 64], [22, 80]],
    [[57, 16], [46, 49], [60, 77]],
    [[101, 31], [108, 56], [122, 82]],
    [[144, 8], [154, 38], [166, 69]],
    [[201, 20], [192, 49], [207, 63]],
    [[251, 9], [275, 41], [264, 63]],
  ],
  [
    [[13, 56], [11, 70], [30, 80]],
    [[49, 42], [42, 62], [51, 76]],
    [[83, 36], [77, 53], [95, 73]],
    [[116, 26], [122, 49], [110, 67]],
    [[144, 6], [151, 39], [162, 64]],
    [[183, 24], [177, 44], [192, 58]],
    [[218, 16], [214, 36], [227, 62]],
    [[254, 7], [269, 28], [261, 53]],
  ],
].map(columns => {
  const edges = [];
  columns.forEach((column, index) => {
    const start = index * column.length;
    column.forEach((_, row) => {
      const node = start + row;
      if (row > 0) edges.push([node - 1, node]);
      if (index === 0) return;
      const previous = node - column.length;
      edges.push([previous, node]);
      if (index % 2 === 0 && row > 0) edges.push([previous - 1, node]);
      if (index % 2 === 1 && row < column.length - 1) edges.push([previous + 1, node]);
    });
  });
  return { nodes: columns.flat(), edges };
});

class FrontierNetwork extends LitElement {
  static properties = { active: { type: Boolean } };

  static styles = css`
    :host {
      display: block;
      position: absolute;
      width: var(--frontier-network-width);
      height: var(--frontier-network-height);
      translate: -50% 0;
      pointer-events: none;
    }
    svg { display: block; width: 100%; height: 100%; }
    g { color: var(--graph-color, #819c8b); }
    g + g { color: var(--muted, #4c6258); }
    path { fill: none; stroke: currentColor; stroke-width: .75; stroke-opacity: .55; }
    circle { fill: currentColor; }
  `;

  constructor() {
    super();
    this.active = false;
    this.visible = false;
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.visibility = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.syncAnimation();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.motion.addEventListener("change", this.syncAnimation);
    this.visibility.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.motion.removeEventListener("change", this.syncAnimation);
    this.visibility.disconnect();
    this.visible = false;
    this.syncAnimation();
  }

  firstUpdated() {
    this.mesh = [...this.renderRoot.querySelectorAll("g")].map(group => ({
      path: group.querySelector("path"),
      circles: [...group.querySelectorAll("circle")],
    }));
    this.drawMesh();
  }

  updated() {
    this.syncAnimation();
  }

  syncAnimation = () => {
    if (this.mesh && this.active && this.visible && !this.motion.matches) {
      this.frame ??= requestAnimationFrame(this.animate);
      return;
    }
    cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.motion.matches && this.mesh) this.drawMesh();
  };

  animate = (now) => {
    this.drawMesh(2 * now / 1000);
    this.frame = requestAnimationFrame(this.animate);
  };

  drawMesh(time) {
    layers.forEach(({ nodes, edges }, layer) => {
      const { path, circles } = this.mesh[layer];
      const positions = nodes.map(([x, y], index) => {
        if (time === undefined) return [x, y, 0];
        const phase = index * 1.7 + layer * 2;
        return [
          x + Math.sin(time * 1.6 + phase) * 5,
          y + Math.cos(time * 1.9 + phase) * 4,
          (1 + Math.sin(time * 3.1 - x / 26)) / 2,
        ];
      });
      path.setAttribute("d", edges.map(([from, to]) => {
        const [x1, y1] = positions[from];
        const [x2, y2] = positions[to];
        return `M${x1} ${y1}L${x2} ${y2}`;
      }).join(" "));
      circles.forEach((circle, index) => {
        const [x, y, pulse] = positions[index];
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.setAttribute("r", (layer === 0 ? 2 : 1.5) + pulse * .85);
      });
    });
  }

  render() {
    return html`
      <svg viewBox="0 0 288 88" preserveAspectRatio="xMidYMin meet">
        ${layers.map(({ nodes }) => svg`<g><path />${nodes.map(() => svg`<circle />`)}</g>`)}
      </svg>
    `;
  }
}

customElements.define("frontier-network", FrontierNetwork);
