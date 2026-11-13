import { DueNext } from "../panels/DueNext";
import { GpaCard, Grades } from "../panels/Grades";
import { Inbox } from "../panels/Inbox";
import { Workload } from "../panels/Workload";
import type { TodayModel } from "../lib/sample";

export function Today({ model, live, unmatched, goTo }: { model: TodayModel; live: boolean; unmatched: number; goTo: (v: "Settings") => void }) {
  return (
    <>
      {live && unmatched > 0 && (
        <div className="notice warn">
          {unmatched} calendar item{unmatched === 1 ? " isn't" : "s aren't"} matched to a course yet.{" "}
          <button type="button" className="link" onClick={() => goTo("Settings")}>Fix in Settings</button>
        </div>
      )}
      <div className="grid">
        <DueNext items={model.due} emptyHint={live ? "Nothing due. Paste your Blackboard calendar link or confirm a syllabus to fill this in." : undefined} />
        <Workload days={model.heat} />
        <Grades rows={model.grades} />
        <GpaCard gpa={model.gpa} />
        <Inbox items={model.inbox} emptyHint="Teacher email arrives once Gmail is connected (v0.3)." />
      </div>
    </>
  );
}
