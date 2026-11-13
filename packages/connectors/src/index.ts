import { blackboardIcal } from "./blackboard/ical.js";
import { blackboardRest } from "./blackboard/rest.js";
import { blackboardSession } from "./blackboard/session.js";
import { gmail } from "./gmail/index.js";
import { gradescope } from "./gradescope/index.js";
import { manual } from "./manual/index.js";
import { qwickly } from "./qwickly/index.js";
import type { Connector } from "./types.js";

export * from "./types.js";
export * from "./net.js";
export { guessKind } from "./kinds.js";
export { parseIcs, eventsToAssignments, ICAL_SECRET } from "./blackboard/ical.js";
export { BlackboardClient } from "./blackboard/client.js";
export * from "./blackboard/map.js";
export { syncBlackboard, downloadBlackboardFile, MAX_FILE_BYTES } from "./blackboard/sync.js";
export { blackboardSession, SESSION_COOKIES, normalizeBaseUrl, sessionWorks } from "./blackboard/session.js";
export { blackboardRest, REST_TOKENS, restAuthUrl, restConfigured, restExchangeCode } from "./blackboard/rest.js";
export { gradescope, GRADESCOPE_COOKIES, GRADESCOPE_ORIGIN, gradescopeWorks, parseGsAssignments, parseGsCourses } from "./gradescope/index.js";
export {
  gmail,
  GMAIL_SCOPES,
  GMAIL_TOKEN,
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
export const ALL_CONNECTORS: Connector[] = [manual, blackboardRest, blackboardSession, blackboardIcal, gradescope, qwickly, gmail];

export function connectorById(id: string): Connector | undefined {
  return ALL_CONNECTORS.find((c) => c.id === id);
}
