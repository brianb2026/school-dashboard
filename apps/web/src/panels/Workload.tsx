import type { HeatDay } from "./models";
import { Panel } from "./Panel";

function step(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 7) return 3;
  return 4;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

export function Workload({ days }: { days: HeatDay[] }) {
  const conflicts = days.filter((d) => d.conflict).length;
  return (
    <Panel title="Workload, next 14 days" meta={`${conflicts} conflict${conflicts === 1 ? "" : "s"}`} className="span-5">
      <div className="heat">
        {days.map((d) => (
          <div
            key={d.day}
            className={`cell ${d.conflict ? "conflict" : ""}`}
            style={{ background: `var(--heat-${step(d.hours)})` }}
            title={`${longDay.format(new Date(`${d.day}T12:00:00Z`))}: ${d.count} item${d.count === 1 ? "" : "s"}, about ${d.hours} h`}
          />
        ))}
        {days.map((d) => (
          <span key={`l${d.day}`} className="day">{weekday.format(new Date(`${d.day}T12:00:00Z`))}</span>
        ))}
      </div>
      <div className="legend">
        less {[0, 1, 2, 3, 4].map((s) => <span key={s} className="cell" style={{ background: `var(--heat-${s})` }} />)} more
        <span style={{ marginLeft: "auto" }}>outlined = deadline pile-up</span>
      </div>
    </Panel>
  );
}
