import { useState, type CSSProperties } from "react";
import type { CourseFile } from "@sd/core";
import { Icon } from "../components/Icon";
import { canPreview } from "../components/Viewer";
import { colorVar, enc } from "../lib/api";
import { useDash } from "../lib/dash";
import { setPref, usePref } from "../lib/prefs";

/** Folder names that say where, not what: "Unit 2", "Week 5", "Module 3". */
const PLACE = /^(unit|week|module|chapter|part|section|topic|lesson)\s*[\w.]*\s*$/i;
const COURSE_INFO = /course overview|start here|syllabus|course info|getting started/i;

/**
 * What kind of file this is, read from the class's own folders: the first
 * folder that names a kind ("Lab Assignments", "Exam material", "Readings"),
 * skipping ones that only say where ("Unit 1"). Files outside any folder
 * are guessed from their name.
 */
export function fileType(f: CourseFile): string {
  const seg = f.folder.find((x) => !PLACE.test(x.trim()));
  if (f.isSyllabus || (seg && COURSE_INFO.test(seg))) return "Course info";
  if (seg) return seg.trim();
  const n = f.name.toLowerCase();
  if (/\blab\b/.test(n)) return "Labs";
  if (/workshop/.test(n)) return "Workshops";
  if (/exam|midterm|final|practice|review/.test(n)) return "Exam material";
  if (/\bhw\b|homework|problem set|pset/.test(n)) return "Homework";
  if (/lecture|slides|\.pptx?$/.test(n)) return "Lecture slides";
  return "Other";
}

/**
 * Course files, one folding section per class (closed until you open it, and
 * remembered). Typing in the filter opens every class with a match.
 */
export function Files() {
  const { d, go, view } = useDash();
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<Record<string, string>>({});
  const saved = usePref("files-open");
  const openIds = new Set<string>(saved ? (JSON.parse(saved) as string[]) : []);
  const setOpen = (ids: Set<string>) => setPref("files-open", ids.size ? JSON.stringify([...ids]) : undefined);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (name: string, folder: string[]) => words.every((w) => `${name} ${folder.join(" ")}`.toLowerCase().includes(w));

  if (d.files.length === 0) {
    return (
      <p className="empty-lg">
        {d.links.blackboard.linked ? (
          "No course files found yet. Files are checked every few hours, or press sync at the top right."
        ) : (
          <>
            Course files appear here once Blackboard or Canvas is linked.{" "}
            <button type="button" className="link" onClick={() => go("Settings")}>
              Link your school
            </button>
          </>
        )}
      </p>
    );
  }

  const groups = d.courses
    .map((c) => ({
      c,
      files: d.files
        .filter((f) => f.courseId === c.id && match(f.name, f.folder))
        .sort((a, b) => Number(b.isSyllabus) - Number(a.isSyllabus) || a.folder.join("/").localeCompare(b.folder.join("/")) || a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.files.length > 0);
  const allOpen = groups.every((g) => openIds.has(g.c.id));

  return (
    <div className="files-page">
      <div className="files-bar">
        <h1>Files</h1>
        <input placeholder="Find a file…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a file" />
        <button type="button" className="btn ghost sm" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.c.id)))}>
          {allOpen ? "Close all" : "Open all"}
        </button>
      </div>
      {groups.length === 0 && <p className="empty-lg">No file matches “{q}”.</p>}
      {groups.map(({ c, files }) => {
        const open = words.length > 0 || openIds.has(c.id);
        return (
          <section key={c.id} className={`file-group ${open ? "open" : ""}`} style={{ "--c": colorVar(c.color) } as CSSProperties}>
            <button
              type="button"
              className="file-group-head"
              aria-expanded={open}
              onClick={() => {
                const next = new Set(openIds);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                setOpen(next);
              }}
            >
              <span className={`chev ${open ? "open" : ""}`} aria-hidden>
                <Icon name="next" size={14} />
              </span>
              <span className="swatch" />
              <b>{c.code}</b>
              <span className="muted name">{c.name}</span>
              <span className="faint num">
                {files.length} file{files.length === 1 ? "" : "s"}
              </span>
            </button>
            {open && (() => {
              const counts = new Map<string, number>();
              for (const f of files) counts.set(fileType(f), (counts.get(fileType(f)) ?? 0) + 1);
              const kinds = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
              const only = types[c.id] && counts.has(types[c.id]!) ? types[c.id] : undefined;
              const shown = only ? files.filter((f) => fileType(f) === only) : files;
              return (
                <>
                  {kinds.length > 1 && (
                    <div className="filter-chips in-files" role="group" aria-label={`${c.code}: show one kind of file`}>
                      <button type="button" aria-pressed={!only} onClick={() => setTypes({ ...types, [c.id]: "" })}>
                        All <span className="num">{files.length}</span>
                      </button>
                      {kinds.map(([k, n]) => (
                        <button key={k} type="button" aria-pressed={only === k} onClick={() => setTypes({ ...types, [c.id]: only === k ? "" : k })}>
                          {k} <span className="num">{n}</span>
                        </button>
                      ))}
                    </div>
                  )}
              <ul className="file-list">
                {shown.map((f) => (
                  <li key={f.id}>
                    <Icon name="file" size={14} />
                    <span className="file-name">
                      {canPreview(f.name) ? (
                        <button type="button" className="link plain" onClick={() => view(f)}>
                          {f.name}
                        </button>
                      ) : (
                        <a className="plain-a" href={`/api/files/${enc(f.id)}/download`} download={f.name}>
                          {f.name}
                        </a>
                      )}
                      {f.isSyllabus && <span className="tag ok">syllabus</span>}
                    </span>
                    <span className="faint folder">{f.folder.join(" / ")}</span>
                    <a className="icon-btn" href={`/api/files/${enc(f.id)}/download`} download={f.name} aria-label={`Download ${f.name}`} title="Download">
                      <Icon name="download" size={14} />
                    </a>
                  </li>
                ))}
              </ul>
                </>
              );
            })()}
          </section>
        );
      })}
    </div>
  );
}
