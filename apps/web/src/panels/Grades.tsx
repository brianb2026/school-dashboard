import type { SampleCourse } from "../lib/sample";
import { Panel } from "./Panel";

export function Grades({ courses }: { courses: SampleCourse[] }) {
  return (
    <Panel title="Grades" meta="current, from graded work only" className="span-7">
      {courses.map((c) => (
        <div key={c.id} className="row grade-row">
          <span className="chip" style={{ color: "var(--text)", fontSize: 14 }}>
            <span className="swatch" style={{ background: c.color }} />
            {c.name} <span className="faint">{c.code}</span>
          </span>
          <span className="num">{c.percent.toFixed(1)}%</span>
          <span className="num" style={{ fontWeight: 500 }}>{c.letter}</span>
          <span title={`${c.weightGraded}% of the course is graded so far`}>
            <div className="bar"><span style={{ width: `${c.weightGraded}%`, background: c.color }} /></div>
          </span>
        </div>
      ))}
    </Panel>
  );
}

export function GpaCard({ weighted, unweighted, credits }: { weighted: number; unweighted: number; credits: number }) {
  return (
    <Panel title="GPA" meta="this term, projected" className="span-5">
      <div className="gpa">
        <div><div className="big">{weighted.toFixed(2)}</div><div className="label">weighted</div></div>
        <div><div className="big muted">{unweighted.toFixed(2)}</div><div className="label">unweighted</div></div>
        <div><div className="big muted">{credits}</div><div className="label">credits</div></div>
      </div>
    </Panel>
  );
}
