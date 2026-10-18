/**
 * Strips markdown code fences (```mermaid ... ``` or ``` ... ```) and
 * conversational AI wrapper text so only pure Mermaid syntax remains.
 * Also sanitizes conflicting characters in quoted strings (such as pipe '|' in comments)
 * that cause Mermaid parser errors.
 */
export function sanitizeMermaidCode(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()

  // 1. If text contains a fenced markdown block (even inside conversational text),
  // extract the inner code block directly.
  let content = trimmed
  const blockMatch = trimmed.match(/```(?:mermaid)?\s*\r?\n([\s\S]*?)\r?\n```/i)
  if (blockMatch && blockMatch[1]) {
    content = blockMatch[1].trim()
  } else {
    // 2. Strip leading / trailing code fences if unclosed or partially copied
    content = content.replace(/^```(?:mermaid)?\s*\r?\n?/i, '')
    content = content.replace(/\r?\n?```\s*$/i, '').trim()
  }

  // 3. Sanitize pipe '|' characters inside quoted attribute comments
  // (Mermaid's ER parser uses '|' for relationship cardinality and breaks on pipe in comments)
  content = content.replace(/"([^"]*)"/g, (_, inner) => {
    return `"${inner.replace(/\|/g, '/')}"`
  })

  return content
}
