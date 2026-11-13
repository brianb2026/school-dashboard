import type { Connector } from "../types.js";

/**
 * Things you add yourself: uploaded syllabi (parsed by @sd/syllabus-parser and
 * confirmed in a review screen), hand-entered grades, courses, check-ins.
 * Stored directly in the database by the server; sync is a no-op.
 */
export const manual: Connector = {
  id: "manual",
  label: "Uploads and manual entries",
  capabilities: ["courses", "assignments", "grades", "attendance"],
  async status() {
    return { state: "ready" };
  },
  async sync() {
    return {};
  },
};
