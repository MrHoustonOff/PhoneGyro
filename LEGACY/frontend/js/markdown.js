'use strict';

  // ── High-Fidelity Markdown Parser & Sanitizer ───────────────────────────────
  function renderMarkdown(str) {
    if (!str) return '';
    // 1. Escape HTML special characters for security
    let s = String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Markdown Links: [text](https://url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

    // 3. Inline Monospace Code: `code`
    s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');

    // 4. Bold: **text**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 5. Italic: *text*
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return s;
  }

  // Open markdown links in external browser instead of inside Wails webview
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a.md-link');
    if (link && link.href) {
      e.preventDefault();
      if (window.runtime && window.runtime.BrowserOpenURL) {
        window.runtime.BrowserOpenURL(link.href);
      } else {
        window.open(link.href, '_blank');
      }
    }
  });
