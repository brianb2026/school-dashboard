import { blackboardIcal } from "./blackboard/ical.js";
import { blackboardRest } from "./blackboard/rest.js";
import { blackboardSession } from "./blackboard/session.js";
import { gmail } from "./gmail/index.js";
import { gradescope } from "./gradescope/index.js";
import { manual } from "./manual/index.js";
import { qwickly } from "./qwickly/index.js";
import type { Connector } from "./types.js";

export * from "./types.js";
export { parseIcs, eventsToAssignments, ICAL_SECRET } from "./blackboard/ical.js";
export { teacherQuery, GMAIL_SCOPES } from "./gmail/index.js";
export { ATTENDANCE_COLUMN } from "./qwickly/index.js";

/** Sync order matters: later sources attach to courses found by earlier ones. */
export const ALL_CONNECTORS: Connector[] = [
  manual,
  blackboardRest,
  blackboardSession,
  blackboardIcal,
  gradescope,
  qwickly,
  gmail,
];
