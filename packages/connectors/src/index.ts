import { blackboardIcal } from "./blackboard/ical.js";
import { blackboardRest } from "./blackboard/rest.js";
import { blackboardSession } from "./blackboard/session.js";
import { canvas } from "./canvas/index.js";
import { gmail } from "./gmail/index.js";
import { gradescope } from "./gradescope/index.js";
import { manual } from "./manual/index.js";
import { sis } from "./sis/index.js";
import type { Connector } from "./types.js";

export * from "./types.js";
export * from "./net.js";
export { guessKind } from "./kinds.js";
export { parseIcs, eventsToAssignments, ICAL_SECRET } from "./blackboard/ical.js";
export { BlackboardClient } from "./blackboard/client.js";
export * from "./blackboard/map.js";
export { syncBlackboard, downloadBlackboardFile, MAX_FILE_BYTES } from "./blackboard/sync.js";
export { blackboardSession, SESSION_COOKIES, normalizeBaseUrl, sessionUser, sessionWorks } from "./blackboard/session.js";
export { blackboardRest, REST_TOKENS, restAuthUrl, restConfigured, restExchangeCode } from "./blackboard/rest.js";
export { canvas, CANVAS_COOKIES, CANVAS_TOKEN, canvasCurrent, canvasUser, contentKey, mapCanvasAnnouncement, mapCanvasCourse, syncCanvas } from "./canvas/index.js";
export { CanvasClient } from "./canvas/client.js";
export { sis, SIS_COOKIES, SIS_PRESETS, presetLmsFor, candidatePaths, cellText, grid, parseCourseHistory, parseStudentCenter, peopleSoftPath, sisGet, sisWorks, syncSis, tablesIn } from "./sis/index.js";
export { gradescope, GRADESCOPE_COOKIES, GRADESCOPE_ORIGIN, gradescopeCourseCount, gradescopeWorks, parseGsAssignments, parseGsCourses } from "./gradescope/index.js";
export {
  gmail,
  GMAIL_SCOPES,
  GMAIL_CLIENT_SECRET, GMAIL_TOKEN,
  buildMime,
  composeLink,
  gmailAuthUrl,
  gmailBody,
  gmailConfigured,
  gmailExchangeCode,
  mapGmailMessage,
  parseAddress,
  teacherQuery,
} from "./gmail/index.js";

/** Sync order matters: later sources attach to courses found by earlier ones. */
export const ALL_CONNECTORS: Connector[] = [manual, blackboardRest, blackboardSession, blackboardIcal, canvas, gradescope, sis, gmail];

export function connectorById(id: string): Connector | undefined {
  return ALL_CONNECTORS.find((c) => c.id === id);
}
