import { NotImplementedYet, type Connector } from "../types.js";

/**
 * Qwickly Attendance runs inside Blackboard as an LTI tool, so there is no
 * separate login and no public student API.
 *
 * Plan:
 *   1. Qwickly can push attendance into the Blackboard gradebook as a column
 *      (often named "Qwickly Attendance" or "Attendance"). The Blackboard
 *      connector exposes that column; this module turns it into an
 *      attendance percentage per course.
 *   2. If your instructor doesn't sync it: a quick "I checked in" log you tap
 *      after each class, plus counts you copy from the Qwickly student view.
 */
export const ATTENDANCE_COLUMN = /\b(qwickly|attendance)\b/i;

export const qwickly: Connector = {
  id: "qwickly",
  label: "Qwickly attendance",
  capabilities: ["attendance"],
  async status() {
    // Becomes "ready" once the Blackboard grade connector (v0.3) provides the attendance column.
    return { state: "not-configured", detail: "Arrives with Blackboard grades (v0.3)" };
  },
  async sync() {
    throw new NotImplementedYet("Qwickly attendance mapping");
  },
};
