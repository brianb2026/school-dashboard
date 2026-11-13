import { useState } from "react";
import { colorVar, enc } from "../lib/api";
import { useDash } from "../lib/dash";
import { Panel } from "../panels/Panel";

export function Files() {
  const { d, go } = useDash();
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (name: string, folder: string[]) => words.every((w) => `${name} ${folder.join(" ")}`.toLowerCase().includes(w));

  if (d.files.length === 0) {
    return (
      <p className="empty">
        {d.links.blackboard.linked
          ? "No course files found yet. Files are checked every few hours, or press the sync button at the top right."
          : <>Course files appear here once Blackboard is linked. <button type="button" className="link" onClick={() => go("Today")}>Link Blackboard</button></>}
      </p>
    );
  }
  return (
    <div className="stack wide">
      <div className="toolbar">
        <input placeholder="Filter files…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter files" style={{ maxWidth: 320 }} />
        <span className="faint" style={{ fontSize: 12 }}>A file you open is kept on this Mac, so it still opens offline.</span>
      </div>
      {d.courses.map((c) => {
        const files = d.files.filter((f) => f.courseId === c.id && match(f.name, f.folder)).sort((a, b) => a.folder.join("/").localeCompare(b.folder.join("/")) || a.name.localeCompare(b.name));
        if (files.length === 0) return null;
        return (
          <Panel key={c.id} title={`${c.code} · ${c.name}`} meta={<span className="chip"><span className="swatch" style={{ background: colorVar(c.color) }} />{files.length} file{files.length === 1 ? "" : "s"}</span>}>
            {files.map((f) => (
              <div key={f.id} className="row file-row">
                <a href={`/api/files/${enc(f.id)}/download`} download={f.name}>{f.name}</a>
                <span className="faint">{f.folder.join(" / ")}</span>
                {f.isSyllabus ? <span className="tag ok">syllabus</span> : <span />}
              </div>
            ))}
          </Panel>
        );
      })}
    </div>
  );
}
