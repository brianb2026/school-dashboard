import type { DashboardData } from "@sd/core";
import type { TodayModel } from "./sample";

/** Turn /api/dashboard into what the Today panels draw. */
export function liveToday(d: DashboardData, now = new Date()): TodayModel {
  const byId = new Map(d.courses.map((c) => [c.id, c]));
  const nowIso = now.toISOString();
  const due = d.assignments
    .filter((a) => a.dueAt && !["submitted", "graded", "excused"].includes(a.status))
    .filter((a) => a.dueAt! >= nowIso || a.status === "late" || a.status === "missing")
    .map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      dueAt: a.dueAt!,
      late: a.status === "late" || a.status === "missing",
      courseCode: byId.get(a.courseId)?.code,
      color: byId.get(a.courseId)?.color,
    }));
  const inbox = [
    ...d.announcements.map((x) => ({
      id: x.id,
      from: x.author ?? byId.get(x.courseId ?? "")?.code ?? "Blackboard",
      subject: x.title,
      at: x.postedAt,
      kind: "announcement" as const,
      unread: !x.read,
      color: byId.get(x.courseId ?? "")?.color,
    })),
    ...d.messages.map((m) => ({
      id: m.id,
      from: m.from.name,
      subject: m.subject,
      at: m.receivedAt,
      kind: "email" as const,
      unread: m.unread,
      color: byId.get(m.courseId ?? "")?.color,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    due,
    grades: d.courses.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      color: c.color,
      percent: c.grade?.percent,
      letter: c.grade?.letter,
      weightGraded: c.grade?.weightGraded ?? 0,
      hasScheme: c.hasScheme,
    })),
    inbox,
    heat: d.workload,
    gpa: d.gpa,
    rail: d.courses.map((c) => ({ id: c.id, code: c.code, color: c.color })),
  };
}
