import { NotImplementedYet, type Connector } from "../types.js";

/**
 * Gradescope. There is no public student API.
 *
 * Plan, in order of preference:
 *   1. Nothing to do: many instructors sync Gradescope scores back into the
 *      Blackboard gradebook, so they arrive through the Blackboard connector.
 *   2. Opt-in session reader (GRADESCOPE_SESSION_READER_ENABLED=true): you sign
 *      in (or use "School Credentials"/Blackboard SSO) in a visible window; it
 *      reads your course list and the assignments table on each course page
 *      (name, due date, status, score). Same caveats as the Blackboard session reader.
 *   3. Manual: paste or upload a score.
 * Submitting to Gradescope stays on Gradescope: the dashboard deep-links to it.
 */
export const gradescope: Connector = {
  id: "gradescope",
  label: "Gradescope (opt-in)",
  capabilities: ["assignments", "grades"],
  async status(ctx) {
    return ctx.env.GRADESCOPE_SESSION_READER_ENABLED === "true"
      ? { state: "needs-sign-in" }
      : { state: "not-configured", detail: "Opt-in; scores often already sync into Blackboard" };
  },
  async sync() {
    throw new NotImplementedYet("Gradescope sync");
  },
};
