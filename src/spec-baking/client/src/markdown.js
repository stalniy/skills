import { html } from "lit";
import { html as staticHtml, literal } from "lit/static-html.js";

const HEADINGS = [literal`h1`, literal`h2`, literal`h3`, literal`h4`, literal`h5`, literal`h6`];
const CRITERION_MARKER = /^<!-- spec-baking:(?:acceptance-criteria:(?:start|end)|criterion I[1-9][0-9]*) -->$/;

export function markdownInline(text, renderText = value => value) {
  const tokens = /(`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    const [source, , code, bold, label, href] = match;
    parts.push(renderText(text.slice(offset, match.index)));
    parts.push(href ? html`<a href=${href} target="_blank" rel="noopener noreferrer">${renderText(label)}</a>`
      : code ? html`<code>${code}</code>` : html`<strong>${renderText(bold)}</strong>`);
    offset = match.index + source.length;
  }
  parts.push(renderText(text.slice(offset)));
  return parts;
}

export function markdown(text, documentHeadings = false, inline = markdownInline) {
  const blocks = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index++];
    if (!line.trim() || (documentHeadings && CRITERION_MARKER.test(line))) continue;
    const fence = /^( {0,3})(`{3,}|~{3,})/.exec(line);
    const heading = /^(?:(#{1,6}) |🔎 )(.*)$/.exec(line);
    const item = /^(?:([-*])|(\d+)\.) (.*)$/.exec(line);
    if (fence) {
      const code = [];
      const close = new RegExp(`^ {0,3}${fence[2][0]}{${fence[2].length},}\\s*$`);
      while (index < lines.length && !close.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(html`<pre><code>${code.join("\n")}</code></pre>`);
    } else if (heading) {
      const level = (documentHeadings && heading[1]?.length) || 3;
      const tag = HEADINGS[level - 1];
      blocks.push(staticHtml`<${tag}>${inline(heading[2])}</${tag}>`);
    } else if (item) {
      const items = [html`<li>${inline(item[3])}</li>`];
      const nextItem = item[1] ? /^[-*] (.*)$/ : /^\d+\. (.*)$/;
      for (let next; (next = nextItem.exec(lines[index] ?? "")); index++) {
        items.push(html`<li>${inline(next[1])}</li>`);
      }
      blocks.push(item[1] ? html`<ul>${items}</ul>` : html`<ol start=${Number(item[2])}>${items}</ol>`);
    } else if (line.startsWith(">")) {
      const quote = [line.replace(/^> ?/, "")];
      while (lines[index]?.startsWith(">")) quote.push(lines[index++].replace(/^> ?/, ""));
      blocks.push(html`<blockquote>${markdown(quote.join("\n"), documentHeadings, inline)}</blockquote>`);
    } else {
      blocks.push(html`<p>${inline(line)}</p>`);
    }
  }
  return html`<div class="markdown">${blocks}</div>`;
}
