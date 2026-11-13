import { NotImplementedYet, type Connector } from "../types.js";

/**
 * Official Blackboard Learn REST API with 3-legged OAuth (you sign in as
 * yourself; the app gets your permissions, nothing more).
 *
 * Needs, before it can work:
 *   1. An app registered at developer.anthology.com (gives Application ID, key, secret).
 *   2. School IT adding that Application ID under System Admin → REST API Integrations,
 *      with "End User Access" on. A student cannot do this step.
 *
 * Endpoints to use (all under /learn/api/public):
 *   GET  v1/oauth2/authorizationcode?redirect_uri=…&response_type=code&client_id=…&scope=read
 *   POST v1/oauth2/token                                   (code → access/refresh token)
 *   GET  v1/users/me/courses?expand=course                 courses
 *   GET  v1/calendars/items?since=…&until=…                due dates + class meetings
 *   GET  v2/courses/{id}/gradebook/columns                 assignments + points
 *   GET  v2/courses/{id}/gradebook/users/{me}              your grades
 *   GET  v1/courses/{id}/announcements                     announcements
 *   GET  v1/courses/{id}/contents (+ /children, /attachments)  course files
 *   GET  v1/courses/{id}/meetings/users/{me}               attendance (Learn's own attendance tool)
 *   POST v1/courses/{id}/gradebook/columns/{col}/attempts  submit (only where the column allows it)
 */
export const blackboardRest: Connector = {
  id: "blackboard-rest",
  label: "Blackboard (official API)",
  capabilities: ["courses", "assignments", "grades", "attendance", "announcements", "download", "submit"],
  async status(ctx) {
    return ctx.env.BLACKBOARD_APP_KEY ? { state: "needs-sign-in" } : { state: "not-configured", detail: "Needs an app key and school IT approval" };
  },
  async connect() {
    throw new NotImplementedYet("Blackboard OAuth sign-in");
  },
  async sync() {
    throw new NotImplementedYet("Blackboard REST sync");
  },
};
