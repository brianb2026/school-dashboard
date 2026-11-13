import { colorVar } from "../lib/api";
import { relativeDue } from "../lib/format";
import type { InboxItem } from "./models";
import { Panel } from "./Panel";

export function Inbox({ items, emptyHint }: { items: InboxItem[]; emptyHint?: string }) {
  return (
    <Panel title="Teachers and announcements" meta={`${items.filter((i) => i.unread).length} unread`} className="span-12">
      {items.length === 0 && <p className="empty">{emptyHint ?? "No messages."}</p>}
      {items.map((m) => (
        <div key={m.id} className="row inbox-row">
          <div className="subject" style={{ fontWeight: m.unread ? 500 : 400 }}>
            <span className="chip" style={{ marginRight: 10 }}>
              <span className="swatch" style={{ background: colorVar(m.color) }} />
              {m.from}
            </span>
            {m.subject}
          </div>
          <span className="chip">
            <span className="tag">{m.kind}</span>
            <span className="num faint">{relativeDue(m.at)}</span>
          </span>
        </div>
      ))}
    </Panel>
  );
}
