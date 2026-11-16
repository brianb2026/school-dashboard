import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewName } from "@sd/core";
import { api, colorVar, enc } from "../lib/api";
import { courseMap, useDash, type Focus } from "../lib/dash";
import { relativeDue } from "../lib/format";

interface Hit {
  key: string;
  kind: string;
  text: string;
  sub?: string;
  color?: string;
  view?: ViewName;
  focus?: Focus;
  href?: string;
  /** A match inside a course file: open it (at the page) in the viewer. */
  file?: { id: string; name: string; page: number };
  snippet?: string;
}

/** "…the [[amortized]] cost…" → text with the matched words marked. Plain text only, never HTML. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\[.*?\]\])/).map((part, i) =>
        part.startsWith("[[") ? <mark key={i}>{part.slice(2, -2)}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** ⌘K: find anything by typing. Enter opens the first result. */
export function Search({ onClose }: { onClose: () => void }) {
  const { d, go, setFocus, view } = useDash();
  const [q, setQ] = useState("");
  const [inFiles, setInFiles] = useState<Hit[]>([]);
  const [index, setIndex] = useState<{ indexed: number; readable: number; on: boolean }>();
  // Inside files: asked of the server a moment after typing stops.
  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) {
      setInFiles([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void api<{ hits: { fileId: string; name: string; courseId: string; page: number; snippet: string }[]; indexed: number; readable: number; on: boolean }>(`/api/search/files?q=${encodeURIComponent(words)}`)
        .then((r) => {
          if (!live) return;
          const cm = courseMap(d);
          setIndex({ indexed: r.indexed, readable: r.readable, on: r.on });
          setInFiles(
            r.hits.map((h) => ({
              key: `x${h.fileId}:${h.page}`,
              kind: "in file",
              text: h.name,
              sub: `${cm.get(h.courseId)?.code ?? ""}${h.page > 1 || /\.(pdf|pptx)$/i.test(h.name) ? ` · ${/\.pptx$/i.test(h.name) ? "slide" : "page"} ${h.page}` : ""}`,
              color: cm.get(h.courseId)?.color,
              file: { id: h.fileId, name: h.name, page: h.page },
              snippet: h.snippet,
            })),
          );
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, d]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const all = useMemo<Hit[]>(() => {
    const cm = courseMap(d);
    const col = (id?: string) => cm.get(id ?? "")?.color;
    const code = (id?: string) => cm.get(id ?? "")?.code ?? "";
    return [
      ...d.courses.map((c) => ({ key: `c${c.id}`, kind: "class", text: `${c.code} ${c.name}`, sub: c.instructors.map((p) => p.name).join(", "), color: c.color, focus: { mode: "class" as const, courseId: c.id } })),
      ...d.assignments.map((a) => ({
        key: `a${a.id}`,
        kind: a.kind,
        text: a.title,
        sub: [code(a.courseId), a.dueAt ? relativeDue(a.dueAt) : "", a.score !== undefined ? `${a.score}/${a.possible}` : ""].filter(Boolean).join(" · "),
        color: col(a.courseId),
        focus: { mode: "class" as const, courseId: a.courseId, itemId: a.id },
      })),
      ...d.announcements.map((n) => ({ key: `n${n.id}`, kind: "announcement", text: n.title, sub: `${code(n.courseId)} ${n.body.slice(0, 80)}`, color: col(n.courseId), view: "Inbox" as const })),
      ...d.messages.map((m) => ({ key: `m${m.id}`, kind: "email", text: m.subject, sub: m.from.name, color: col(m.courseId), view: "Inbox" as const })),
      ...d.files.map((f) => ({ key: `f${f.id}`, kind: "file", text: f.name, sub: [code(f.courseId), ...f.folder].join(" / "), color: col(f.courseId), href: `/api/files/${enc(f.id)}/download` })),
    ];
  }, [d]);

  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return all.filter((h) => words.every((w) => `${h.text} ${h.sub ?? ""} ${h.kind}`.toLowerCase().includes(w))).slice(0, 12);
  }, [q, all]);

  // Names and titles first, then matches inside files.
  const shown = useMemo(() => [...hits, ...inFiles], [hits, inFiles]);

  const open = (h: Hit | undefined) => {
    if (!h) return;
    if (h.file) view(h.file);
    else if (h.href) window.location.assign(h.href);
    else if (h.focus) setFocus(h.focus);
    else if (h.view) go(h.view);
    onClose();
  };

  return (
    <div className="modal-back top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal search" role="dialog" aria-modal="true" aria-label="Search">
        <input
          ref={input}
          value={q}
          placeholder="Search assignments, classes, announcements, files…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, shown.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            else if (e.key === "Enter") open(shown[sel]);
            else if (e.key === "Escape") onClose();
          }}
          aria-label="Search"
        />
        <div className="hits" role="listbox">
          {q.trim() && shown.length === 0 && <p className="empty">Nothing matches “{q}”.</p>}
          {shown.map((h, i) => (
            <div key={h.key}>
              {h.file && i === hits.length && <p className="hits-head">Inside files</p>}
              <button type="button" role="option" aria-selected={i === sel} className={`hit ${i === sel ? "on" : ""} ${h.file ? "in-file" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => open(h)}>
                <span className="swatch" style={{ background: colorVar(h.color) }} />
                <span className="hit-text">
                  {h.text}
                  {h.sub && <span className="faint"> {h.sub}</span>}
                  {h.snippet && (
                    <span className="hit-snip">
                      <Snippet text={h.snippet} />
                    </span>
                  )}
                </span>
                {!h.file && <span className="tag">{h.kind}</span>}
              </button>
            </div>
          ))}
        </div>
        {q.trim().length >= 2 && index && (
          <p className="hits-foot faint">
            {!index.on
              ? "Searching inside files is off (Settings → Display)."
              : index.indexed < index.readable
                ? `Searching inside ${index.indexed} of ${index.readable} files; the rest are being read a few at a time.`
                : `Searching inside all ${index.readable} files.`}
          </p>
        )}
      </div>
    </div>
  );
}
