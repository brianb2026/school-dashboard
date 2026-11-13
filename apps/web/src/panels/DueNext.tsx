import { relativeDue } from "../lib/format";
import type { SampleCourse, SampleDue } from "../lib/sample";
import { Panel } from "./Panel";

export function DueNext({ due, courses }: { due: SampleDue[]; courses: SampleCourse[] }) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const sorted = [...due].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return (
    <Panel title="Due next" meta={`${sorted.filter((d) => d.status !== "submitted").length} open`} className="span-7">
      {sorted.map((d) => {
        const c = byId.get(d.courseId);
        return (
          <div key={d.id} className="row due-row">
            <span className="num muted" style={{ fontSize: 12 }}>{relativeDue(d.dueAt)}</span>
            <span>{d.title}</span>
            <span className="chip">
              <span className="swatch" style={{ background: c?.color }} />
              {c?.code}
            </span>
            {d.status === "late" ? <span className="tag danger">late</span> : <span className="tag">{d.kind}</span>}
          </div>
        );
      })}
    </Panel>
  );
}
