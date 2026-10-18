/**
 * Lightweight, zero-dependency Mermaid syntax highlighter.
 * Converts raw Mermaid text into safe syntax-highlighted HTML spans.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function highlightMermaid(source: string): string {
  if (!source) return ''

  const lines = source.split('\n')
  const highlightedLines = lines.map((line) => {
    // 1. Check for comments: %% ...
    const commentIndex = line.indexOf('%%')
    let codePart = commentIndex !== -1 ? line.slice(0, commentIndex) : line
    const commentPart = commentIndex !== -1 ? line.slice(commentIndex) : ''

    let escaped = escapeHtml(codePart)

    // 2. Highlight strings "..." or '...'
    escaped = escaped.replace(
      /(&quot;[^&]*?&quot;|"[^"]*?"|'[^']*?')/g,
      '<span class="tok-string">$1</span>',
    )

    // 3. Highlight Diagram declarations & structure keywords
    escaped = escaped.replace(
      /\b(erDiagram|flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|gitGraph|mindmap|subgraph|end|direction|TB|TD|BT|RL|LR|participant|actor|autonumber|activate|deactivate)\b/g,
      '<span class="tok-keyword">$1</span>',
    )

    // 4. Highlight ERD key markers: PK, FK, UK
    escaped = escaped.replace(
      /\b(PK|FK|UK)\b/g,
      '<span class="tok-key">$1</span>',
    )

    // 5. Highlight common database column types
    escaped = escaped.replace(
      /\b(int|integer|string|varchar|boolean|bool|date|datetime|timestamp|decimal|float|text|blob|json|uuid|bigint|serial|numeric|char)\b/g,
      '<span class="tok-type">$1</span>',
    )

    // 6. Highlight relationships & connectors
    // ERD: ||--o{, }|--|{, ||--||, etc.
    // Flowchart: -->, ---, -.->, ==>, etc.
    escaped = escaped.replace(
      /(\|\|--[o|]\{?|\}\|--[o|]\{?|\|\|--\|\||--&gt;|-{2,3}|-\.-&gt;|={2,}&gt;|--o|--x|&lt;--|&lt;\|--)/g,
      '<span class="tok-arrow">$1</span>',
    )

    if (commentPart) {
      escaped += `<span class="tok-comment">${escapeHtml(commentPart)}</span>`
    }

    return escaped || ' '
  })

  return highlightedLines.join('\n')
}
