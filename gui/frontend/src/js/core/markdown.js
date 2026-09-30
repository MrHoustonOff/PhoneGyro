// A small Markdown renderer for the user guide (docs/guide.*.md), just what the
// guide uses: headings, paragraphs, nested lists, tables, fenced code, quotes and
// GitHub alerts (> [!NOTE] → design pg-callout), images, rules, and inline
// **bold**, *italic*, `code`, <kbd>, [links](…). Inline HTML is escaped except
// <kbd>, <br> and the guide's coloured <span>s (their colour is dropped: design
// Prose rule). Output goes inside .pg-prose.

import { esc } from './dom.js';

/** GitHub's heading anchor: lowercase, spaces → '-', punctuation dropped. */
export const slug = (s) => s.toLowerCase().trim()
  .replace(/<[^>]+>/g, '')
  .replace(/[^\p{L}\p{N}\s_-]/gu, '')
  .replace(/\s/g, '-');

const ALERTS = { NOTE: '', TIP: 'tip', IMPORTANT: 'warn', WARNING: 'warn', CAUTION: 'danger' };

function inline(s) {
  let h = esc(s);
  // allowed tags back (escaped above)
  h = h.replace(/&lt;(\/?)kbd&gt;/g, '<$1kbd>').replace(/&lt;br\s*\/?&gt;/g, '<br>')
    .replace(/&lt;span[^&]*?&gt;/g, '').replace(/&lt;\/span&gt;/g, '');
  const codes = [];
  h = h.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="docs/$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

/**
 * render(md) → { html, headings: [{ level, text, id }] }
 * Headings (##, ###) get GitHub-style ids so the guide's own #links work.
 */
export function render(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  const headings = [];
  let i = 0;

  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };

  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flush(); i++; continue; }

    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flush();
      const level = m[1].length, text = m[2].trim(), id = slug(text);
      headings.push({ level, text: text.replace(/<[^>]+>/g, ''), id });
      out.push(`<h${level} id="${esc(id)}">${inline(text)}</h${level}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    if (line.startsWith('```')) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      i++; continue;
    }

    if (line.startsWith('>')) {
      flush();
      const body = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) body.push(lines[i].replace(/^>\s?/, ''));
      const alert = body[0] && body[0].match(/^\[!(\w+)\]\s*$/);
      if (alert) {
        const kind = ALERTS[alert[1].toUpperCase()] ?? '';
        const inner = render(body.slice(1).join('\n')).html;
        out.push(`<div class="pg-callout${kind ? ' pg-callout--' + kind : ''}" data-alert="${alert[1].toUpperCase()}">${inner}</div>`);
      } else {
        out.push(`<div class="pg-callout">${render(body.join('\n')).html}</div>`);
      }
      continue;
    }

    if (line.startsWith('|')) {
      flush();
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|[\s:|-]+\|?$/.test(r)));
      out.push('<table><thead><tr>' + cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.slice(1).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    if ((m = line.match(/^(\s*)([-*]|\d+\.)\s+/))) {
      flush();
      // A list block: items and their indented children, until a blank line
      // followed by a non-indented, non-list line.
      const block = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim()) {
          const nx = lines[i + 1] || '';
          if (/^(\s+|\s*([-*]|\d+\.)\s)/.test(nx)) { block.push(''); continue; }
          break;
        }
        if (!/^(\s*)([-*]|\d+\.)\s+/.test(l) && !/^\s/.test(l) && block.length) break;
        block.push(l);
      }
      out.push(list(block));
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return { html: out.join('\n'), headings };
}

// Nested lists by indentation.
function list(block) {
  const items = [];
  const base = block[0].match(/^(\s*)/)[1].length;
  for (const l of block) {
    const m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (m && m[1].length <= base + 1) items.push({ ordered: /\d/.test(m[2]), text: [m[3]], sub: [] });
    else if (items.length) {
      const cur = items[items.length - 1];
      if (m || cur.sub.length) cur.sub.push(l); else if (l.trim()) cur.text.push(l.trim());
    }
  }
  const tag = items[0] && items[0].ordered ? 'ol' : 'ul';
  return `<${tag}>` + items.map((it) => `<li>${inline(it.text.join(' '))}${it.sub.filter((s) => s.trim()).length ? list(it.sub.filter((s) => s.trim())) : ''}</li>`).join('') + `</${tag}>`;
}
