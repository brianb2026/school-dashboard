import { colorVar } from "../lib/api";
import { relativeDue } from "../lib/format";
import type { DueItem } from "./models";
import { Panel } from "./Panel";

export function DueNext({ items, emptyHint }: { items: DueItem[]; emptyHint?: string }) {
  const sorted = [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return (
    <Panel title="Due next" meta={`${sorted.length} open`} className="span-7">
      {sorted.length === 0 && <p className="empty">{emptyHint ?? "Nothing due. Enjoy it."}</p>}
      {sorted.slice(0, 12).map((d) => (
        <div key={d.id} className="row due-row">
          <span className="num muted" style={{ fontSize: 12 }}>{relativeDue(d.dueAt)}</span>
          <span>{d.title}</span>
          <span className="chip">
            <span className="swatch" style={{ background: colorVar(d.color) }} />
            {d.courseCode ?? "Unmatched"}
          </span>
          {d.late ? <span className="tag danger">late</span> : <span className="tag">{d.kind}</span>}
        </div>
      ))}
    </Panel>
  );
}
