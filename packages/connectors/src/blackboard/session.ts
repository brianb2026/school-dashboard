import { NotImplementedYet, type Connector } from "../types.js";

/**
 * OPT-IN session reader. Off unless BLACKBOARD_SESSION_READER_ENABLED=true.
 *
 * How it will work:
 *   - Opens a real, visible browser window at your Blackboard sign-in page.
 *     You type your own password / do SSO / 2FA. The app never sees or stores it.
 *   - After sign-in it keeps only the session cookie, in the macOS Keychain.
 *   - It then reads the same JSON the Blackboard web page itself loads
 *     (same paths as the REST connector, called with your session), slowly and
 *     only for your own courses.
 *
 * Caveats (shown in the UI before you turn it on):
 *   - This may conflict with your school's acceptable-use policy. Your call.
 *   - It breaks when Blackboard changes its pages; the calendar feed keeps working.
 *   - No write actions (submissions) through this path in v1: read-only.
 */
export const blackboardSession: Connector = {
  id: "blackboard-session",
  label: "Blackboard (signed-in session, opt-in)",
  capabilities: ["courses", "assignments", "grades", "attendance", "announcements", "download"],
  async status(ctx) {
    return ctx.env.BLACKBOARD_SESSION_READER_ENABLED === "true"
      ? { state: "needs-sign-in" }
      : { state: "not-configured", detail: "Opt-in; off by default" };
  },
  async connect() {
    throw new NotImplementedYet("Blackboard session sign-in window");
  },
  async sync() {
    throw new NotImplementedYet("Blackboard session sync");
  },
};
