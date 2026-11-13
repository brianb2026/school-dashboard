import { relativeDue } from "../lib/format";
import type { SampleCourse, SampleMsg } from "../lib/sample";
import { Panel } from "./Panel";

export function Inbox({ items, courses }: { items: SampleMsg[]; courses: SampleCourse[] }) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  return (
    <Panel title="Teachers and announcements" meta={`${items.filter((i) => i.unread).length} unread`} className="span-12">
      {items.map((m) => {
        const c = m.courseId ? byId.get(m.courseId) : undefined;
        return (
          <div key={m.id} className="row inbox-row">
            <div className="subject" style={{ fontWeight: m.unread ? 500 : 400 }}>
              <span className="chip" style={{ marginRight: 10 }}>
                <span className="swatch" style={{ background: c?.color ?? "var(--text-faint)" }} />
                {m.from}
              </span>
              {m.subject}
            </div>
            <span className="chip">
              <span className="tag">{m.kind}</span>
              <span className="num faint">{relativeDue(m.at)}</span>
            </span>
          </div>
        );
      })}
    </Panel>
  );
}
