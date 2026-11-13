const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * HTML from a source system → plain text. Nothing from Blackboard, Gradescope
 * or email is ever rendered as HTML in the dashboard, so a hostile page can't
 * run script here. Links are kept as "text (https://…)".
 */
export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, d: string, q: string, text: string) => {
    const href = decodeEntities(d ?? q ?? "").trim();
    const label = text.replace(/<[^>]+>/g, "").trim();
    if (!/^https?:\/\//i.test(href) || !label || label === href) return label || (/^https?:\/\//i.test(href) ? href : "");
    return `${label} (${href})`;
  });
  s = s.replace(/<li\b[^>]*>/gi, "\n• ");
  s = s.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|tr|ul|ol|table|blockquote|section|article)\s*>/gi, "\n");
  s = s.replace(/<\/(td|th)\s*>/gi, "  ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
