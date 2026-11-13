import { shortDay } from "../lib/format";
import { Panel } from "./Panel";

function step(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 7) return 3;
  return 4;
}

export function Workload({ hours, conflicts }: { hours: number[]; conflicts: Set<number> }) {
  return (
    <Panel title="Workload, next 14 days" meta={`${conflicts.size} conflict${conflicts.size === 1 ? "" : "s"}`} className="span-5">
      <div className="heat">
        {hours.map((h, i) => (
          <div
            key={i}
            className={`cell ${conflicts.has(i) ? "conflict" : ""}`}
            style={{ background: `var(--heat-${step(h)})` }}
            title={`${h} h of work due`}
          />
        ))}
        {hours.map((_, i) => (
          <span key={`d${i}`} className="day">{shortDay(i)}</span>
        ))}
      </div>
      <div className="legend">
        less {[0, 1, 2, 3, 4].map((s) => <span key={s} className="cell" style={{ background: `var(--heat-${s})` }} />)} more
        <span style={{ marginLeft: "auto" }}>outlined = two big items the same day</span>
      </div>
    </Panel>
  );
}
