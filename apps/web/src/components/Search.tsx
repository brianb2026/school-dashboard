import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewName } from "@sd/core";
import { colorVar, enc } from "../lib/api";
import { courseMap, useDash } from "../lib/dash";
import { relativeDue } from "../lib/format";

interface Hit {
  key: string;
  kind: string;
  text: string;
  sub?: string;
  color?: string;
  view?: ViewName;
  href?: string;
}

/** ⌘K: find anything by typing. Enter opens the first result. */
export function Search({ onClose }: { onClose: () => void }) {
  const { d, go } = useDash();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const all = useMemo<Hit[]>(() => {
    const cm = courseMap(d);
    const col = (id?: string) => cm.get(id ?? "")?.color;
    const code = (id?: string) => cm.get(id ?? "")?.code ?? "";
    return [
      ...d.courses.map((c) => ({ key: `c${c.id}`, kind: "course", text: `${c.code} ${c.name}`, sub: c.instructors.map((p) => p.name).join(", "), color: c.color, view: "Grades" as const })),
      ...d.assignments.map((a) => ({
        key: `a${a.id}`,
        kind: a.kind,
        text: a.title,
        sub: [code(a.courseId), a.dueAt ? relativeDue(a.dueAt) : "", a.score !== undefined ? `${a.score}/${a.possible}` : ""].filter(Boolean).join(" · "),
        color: col(a.courseId),
        view: "Assignments" as const,
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

  const open = (h: Hit | undefined) => {
    if (!h) return;
    if (h.href) window.location.assign(h.href);
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
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, hits.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            else if (e.key === "Enter") open(hits[sel]);
            else if (e.key === "Escape") onClose();
          }}
          aria-label="Search"
        />
        <div className="hits" role="listbox">
          {q.trim() && hits.length === 0 && <p className="empty">Nothing matches “{q}”.</p>}
          {hits.map((h, i) => (
            <button key={h.key} type="button" role="option" aria-selected={i === sel} className={`hit ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => open(h)}>
              <span className="swatch" style={{ background: colorVar(h.color) }} />
              <span className="hit-text">
                {h.text}
                {h.sub && <span className="faint"> {h.sub}</span>}
              </span>
              <span className="tag">{h.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
