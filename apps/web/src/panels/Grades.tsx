import { colorVar } from "../lib/api";
import type { GradeRow } from "./models";
import { Panel } from "./Panel";

export function Grades({ rows }: { rows: GradeRow[] }) {
  return (
    <Panel title="Grades" meta="current, from graded work only" className="span-7">
      {rows.length === 0 && <p className="empty">Add a course or upload a syllabus to see grades here.</p>}
      {rows.map((c) => (
        <div key={c.id} className="row grade-row">
          <span className="chip" style={{ color: "var(--text)", fontSize: 14 }}>
            <span className="swatch" style={{ background: colorVar(c.color) }} />
            {c.name} <span className="faint">{c.code}</span>
          </span>
          {c.percent !== undefined ? (
            <>
              <span className="num">{c.percent.toFixed(1)}%</span>
              <span className="num" style={{ fontWeight: 500 }}>{c.letter}</span>
              <span title={`${c.weightGraded}% of the course is graded so far`}>
                <div className="bar"><span style={{ width: `${c.weightGraded}%`, background: colorVar(c.color) }} /></div>
              </span>
            </>
          ) : (
            <span className="faint" style={{ gridColumn: "span 3", fontSize: 12, textAlign: "right" }}>
              {c.hasScheme ? "no graded work yet" : "no grading weights — upload the syllabus"}
            </span>
          )}
        </div>
      ))}
    </Panel>
  );
}

export function GpaCard({ gpa }: { gpa?: { gpa: number; unweighted: number; credits: number } }) {
  return (
    <Panel title="GPA" meta="this term, projected" className="span-5">
      {gpa ? (
        <div className="gpa">
          <div><div className="big">{gpa.gpa.toFixed(2)}</div><div className="label">weighted</div></div>
          <div><div className="big muted">{gpa.unweighted.toFixed(2)}</div><div className="label">unweighted</div></div>
          <div><div className="big muted">{gpa.credits}</div><div className="label">credits</div></div>
        </div>
      ) : (
        <p className="empty">Shows up once a course has grading weights and at least one grade.</p>
      )}
    </Panel>
  );
}
