import type { Connector } from "../types.js";
import { REST_TOKENS } from "../blackboard/rest.js";
import { SESSION_COOKIES } from "../blackboard/session.js";

/**
 * Qwickly Attendance runs inside Blackboard as an LTI tool: no separate login
 * and no student API. When the instructor syncs it to the gradebook it shows
 * up as a column ("Qwickly Attendance" / "Attendance"), and the Blackboard
 * sync turns that column into your attendance percentage (see mapGradebook).
 * So there is nothing to fetch here; this entry only reports where the
 * numbers come from. For classes that don't sync it, the Attendance view has
 * a one-tap check-in log.
 */
export const qwickly: Connector = {
  id: "qwickly",
  label: "Qwickly attendance",
  capabilities: ["attendance"],
  async status(ctx) {
    const linked = (await ctx.secrets.get(SESSION_COOKIES)) || (await ctx.secrets.get(REST_TOKENS));
    return linked
      ? { state: "ready", detail: "Read from the attendance column in Blackboard grades" }
      : { state: "not-configured", detail: "Comes in with Blackboard once it is linked" };
  },
  async sync() {
    return {};
  },
};
