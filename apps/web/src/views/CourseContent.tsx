import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { AssignmentView, ContentItem, CourseFile, CourseView } from "@sd/core";
import { Icon, type IconName } from "../components/Icon";
import { canPreview } from "../components/Viewer";
import { api, enc } from "../lib/api";
import { lmsOf, useDash } from "../lib/dash";
import { relativeDue } from "../lib/format";
import { keepReading, setPref, usePref, useReadings } from "../lib/prefs";

const ICON: Record<ContentItem["kind"], IconName> = {
  folder: "folder", page: "page", file: "file", link: "link", assignment: "assignment", test: "test", tool: "tool", discussion: "discussion", other: "page",
};

/**
 * A class's Blackboard course page, laid out the way Blackboard does
 * (folders, pages, files, links, assignments, Gradescope, Qwickly
 * attendance…), with the dashboard's dates and scores beside each item, and
 * a folder of what the syllabus lists (readings, due dates) at the end.
 * Shown on the Grades tab under the class's work.
 */
export function CourseContent({ c }: { c: CourseView }) {
  const { d } = useDash();
  const [page, setPage] = useState<{ items: ContentItem[]; fetchedAt?: string }>();
  useEffect(() => {
    let live = true;
    api<{ items: ContentItem[]; fetchedAt?: string }>(`/api/courses/${enc(c.id)}/contents`)
      .then((r) => live && setPage(r))
      .catch(() => live && setPage({ items: [] }));
    return () => {
      live = false;
    };
  }, [c.id, d.lastSyncAt]);
  if (page === undefined) {
    return (
      <div className="tree">
        {[0, 1, 2].map((i) => (
          <span key={i} className="sk sk-line" />
        ))}
      </div>
    );
  }
  return (
    <>
      <Tree c={c} items={page.items} />
      {page.items.length === 0 && <p className="none">{lmsOf(c.id)}'s folders fill in after the next sync.</p>}
    </>
  );
}

/** Folders open and close like Blackboard's; the ones you open are remembered per class. */
function Tree({ c, items, focusId }: { c: CourseView; items: ContentItem[]; focusId?: string }) {
  const { d } = useDash();
  const readings = useReadings();
  const key = `open-${c.id}`;
  const saved = usePref(key);
  const open = useMemo(() => new Set<string>(saved ? (JSON.parse(saved) as string[]) : []), [saved]);
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPref(key, next.size ? JSON.stringify([...next]) : undefined);
  };

  const kids = useMemo(() => {
    const m = new Map<string, ContentItem[]>();
    for (const it of items) m.set(it.parentId ?? "", [...(m.get(it.parentId ?? "") ?? []), it]);
    return m;
  }, [items]);
  const mine = d.assignments.filter((a) => a.courseId === c.id);
  const byContent = new Map(mine.filter((a) => a.contentId).map((a) => [a.contentId!, a]));
  const files = d.files.filter((f) => f.courseId === c.id);

  // Opening the class to one item: open the folders above it.
  const focusContent = focusId ? mine.find((a) => a.id === focusId)?.contentId : undefined;
  useEffect(() => {
    if (!focusContent) return;
    const byId = new Map(items.map((x) => [x.id, x]));
    const up = new Set(open);
    for (let p = byId.get(focusContent)?.parentId; p; p = byId.get(p)?.parentId) up.add(p);
    if (up.size !== open.size) setPref(key, JSON.stringify([...up]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusContent, items]);

  // What only the syllabus lists (readings, in-class dates): its own folder at the end.
  const syllabusOnly = mine
    .filter((a) => a.origin === "Syllabus" && keepReading(readings.shows)(a))
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));

  const render = (parent: string, depth: number): ReactNode =>
    (kids.get(parent) ?? []).map((it) => {
      const children = kids.get(it.id) ?? [];
      const isOpen = open.has(it.id);
      return (
        <li key={it.id}>
          <Row item={it} depth={depth} count={children.length} open={isOpen} onToggle={() => toggle(it.id)} a={byContent.get(it.id)} files={files} flash={it.id === focusContent} />
          {it.kind === "folder" && isOpen && children.length > 0 && <ul>{render(it.id, depth + 1)}</ul>}
          {it.kind === "folder" && isOpen && children.length === 0 && (
            <p className="none" style={{ paddingLeft: 46 + depth * 22 }}>
              Empty folder
            </p>
          )}
        </li>
      );
    });

  return (
    <ul className="tree">
      {render("", 0)}
      {syllabusOnly.length > 0 && <SyllabusFolder items={syllabusOnly} open={!open.has("syllabus-closed")} onToggle={() => toggle("syllabus-closed")} focusId={focusId} />}
    </ul>
  );
}

function Row(props: { item: ContentItem; depth: number; count: number; open: boolean; onToggle: () => void; a?: AssignmentView; files: CourseFile[]; flash: boolean }) {
  const { view } = useDash();
  const { item: it, a } = props;
  const [showText, setShowText] = useState(false);
  const own = props.files.filter((f) => f.contentId === it.id || (f.contentId !== undefined && it.bodyIds?.includes(f.contentId)));
  const pad = { paddingLeft: 10 + props.depth * 22 } as CSSProperties;
  const label = it.tool ?? (it.kind === "assignment" ? "Assignment" : it.kind === "test" ? "Test" : it.kind === "discussion" ? "Discussion" : undefined);

  const main = (
    <>
      <span className={`kind-icon k-${it.kind}`} aria-hidden>
        <Icon name={ICON[it.kind]} />
      </span>
      <span className="tree-text">
        <span className="tree-title">{it.title}</span>
        {(a || label || (it.kind === "folder" && props.count > 0)) && (
          <span className="item-sub">
            {it.kind === "folder" ? `${props.count} item${props.count === 1 ? "" : "s"}` : label}
            {a && <Status a={a} />}
          </span>
        )}
      </span>
    </>
  );

  let action: ReactNode = null;
  if (it.kind === "file" && own[0]) {
    const f = own[0];
    action = canPreview(f.name) ? (
      <button type="button" className="chip-btn" onClick={() => view(f)}>
        Open
      </button>
    ) : (
      <a className="chip-btn" href={`/api/files/${enc(f.id)}/download`} download={f.name}>
        <Icon name="download" size={14} /> Download
      </a>
    );
  } else if (it.kind === "link" && it.href) {
    action = (
      <a className="icon-btn" href={it.href} target="_blank" rel="noreferrer noopener" aria-label={`Open ${it.title}`} title={it.href}>
        <Icon name="external" size={14} />
      </a>
    );
  } else if (it.kind !== "folder" && it.kind !== "page" && it.url) {
    action = (
      <a className="icon-btn" href={it.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${it.title} on the course site`} title="Open on the course site">
        <Icon name="external" size={14} />
      </a>
    );
  }

  const opens = it.kind === "folder" || (it.kind === "page" && Boolean(it.text || own.length > 0));
  const expanded = it.kind === "folder" ? props.open : showText;
  return (
    <>
      <div className={`tree-row ${props.flash ? "flash" : ""} ${a?.done ? "is-done" : ""}`} style={pad}>
        {opens ? (
          <button type="button" className="tree-main" onClick={it.kind === "folder" ? props.onToggle : () => setShowText(!showText)} aria-expanded={expanded}>
            <span className={`chev ${expanded ? "open" : ""}`} aria-hidden>
              <Icon name="next" size={12} />
            </span>
            {main}
          </button>
        ) : it.kind === "link" && it.href ? (
          <a className="tree-main" href={it.href} target="_blank" rel="noreferrer noopener">
            <span className="chev" aria-hidden />
            {main}
          </a>
        ) : (
          <span className="tree-main static">
            <span className="chev" aria-hidden />
            {main}
          </span>
        )}
        <span className="tree-act">
          {a?.materials?.[0] && it.kind !== "file" && (
            <button type="button" className="chip-btn" onClick={() => view(a.materials![0]!)}>
              <Icon name="file" size={14} /> Open
            </button>
          )}
          {action}
        </span>
      </div>
      {showText && (
        <div className="page-body" style={{ marginLeft: 46 + props.depth * 22 }}>
          {it.text && <p>{it.text}</p>}
          {own.length > 0 && (
            <div className="page-files">
              {own.map((f) =>
                canPreview(f.name) ? (
                  <button key={f.id} type="button" className="chip-btn" onClick={() => view(f)}>
                    <Icon name="file" size={14} /> {f.name.replace(/\.[a-z0-9]{2,5}$/i, "")}
                  </button>
                ) : (
                  <a key={f.id} className="chip-btn" href={`/api/files/${enc(f.id)}/download`} download={f.name}>
                    <Icon name="download" size={14} /> {f.name}
                  </a>
                ),
              )}
            </div>
          )}
          {it.url && (
            <a className="link quiet" href={it.url} target="_blank" rel="noreferrer noopener">
              Open in the course site <Icon name="external" size={12} />
            </a>
          )}
        </div>
      )}
    </>
  );
}

/** "due Thu 11:59 PM", "84/100", "done", "late" next to an item the dashboard knows. */
function Status({ a }: { a: AssignmentView }) {
  if (a.score !== undefined) return <span className="status"> · {a.score}/{a.possible}</span>;
  if (a.done) return <span className="status ok-text"> · done</span>;
  if (a.late) return <span className="status danger-text"> · late, was due {a.dueAt ? relativeDue(a.dueAt) : ""}</span>;
  if (a.dueAt) return <span className="status"> · due {relativeDue(a.dueAt)}</span>;
  return null;
}

/** Readings and dates only the syllabus lists, upcoming first; earlier ones folded. */
function SyllabusFolder({ items, open, onToggle, focusId }: { items: AssignmentView[]; open: boolean; onToggle: () => void; focusId?: string }) {
  const { view } = useDash();
  const [showPast, setShowPast] = useState(false);
  const now = Date.now();
  const upcoming = items.filter((a) => !a.dueAt || Date.parse(a.dueAt) >= now - 12 * 3_600_000);
  const past = items.filter((a) => !upcoming.includes(a)).reverse();
  const isOpen = open || items.some((a) => a.id === focusId);
  const row = (a: AssignmentView) => (
    <li key={a.id}>
      <div className={`tree-row ${a.id === focusId ? "flash" : ""} ${a.done ? "is-done" : ""}`} style={{ paddingLeft: 32 }}>
        <span className="tree-main static">
          <span className="chev" aria-hidden />
          <span className={`kind-icon k-${a.kind === "reading" ? "page" : "assignment"}`} aria-hidden>
            <Icon name={a.kind === "reading" ? "book" : "assignment"} />
          </span>
          <span className="tree-text">
            <span className="tree-title">{a.title}</span>
            <span className="item-sub">{a.dueAt ? (a.kind === "reading" ? `for class ${relativeDue(a.dueAt)}` : `due ${relativeDue(a.dueAt)}`) : "no date"}</span>
          </span>
        </span>
        <span className="tree-act">
          {a.materials?.[0] && (
            <button type="button" className="chip-btn" onClick={() => view(a.materials![0]!)}>
              <Icon name="file" size={14} /> Open
            </button>
          )}
          {a.url && (
            <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${a.title}`}>
              <Icon name="external" size={14} />
            </a>
          )}
        </span>
      </div>
    </li>
  );
  return (
    <li className="syllabus-folder">
      <div className="tree-row" style={{ paddingLeft: 10 }}>
        <button type="button" className="tree-main" onClick={onToggle} aria-expanded={isOpen}>
          <span className={`chev ${isOpen ? "open" : ""}`} aria-hidden>
            <Icon name="next" size={12} />
          </span>
          <span className="kind-icon k-syllabus" aria-hidden>
            <Icon name="book" />
          </span>
          <span className="tree-text">
            <span className="tree-title">From the syllabus</span>
            <span className="item-sub">{upcoming.length} coming up · readings and dates listed in the syllabus</span>
          </span>
        </button>
      </div>
      {isOpen && (
        <ul>
          {upcoming.map(row)}
          {past.length > 0 && (
            <li>
              <button type="button" className="fold-btn past-btn" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
                <span className={`chev ${showPast ? "open" : ""}`} aria-hidden>
                  <Icon name="next" size={12} />
                </span>
                {past.length} earlier
              </button>
            </li>
          )}
          {showPast && past.map(row)}
        </ul>
      )}
    </li>
  );
}
