import type { AssignmentKind } from "@sd/core";

/** Best guess at what kind of work a title describes. Most specific first. */
export function guessKind(title: string): AssignmentKind {
  if (/\bproject\b/i.test(title)) return "project";
  if (/\blab\b/i.test(title)) return "lab";
  if (/\bquiz/i.test(title)) return "quiz";
  if (/\b(exam|midterm|final|test)\b/i.test(title)) return "exam";
  if (/\b(paper|essay|report)\b/i.test(title)) return "paper";
  if (/\b(discussion|participation|forum)\b/i.test(title)) return "discussion";
  if (/\b(reading|chapter)\b/i.test(title)) return "reading";
  if (/\b(attendance|survey|bonus|extra credit)\b/i.test(title)) return "other";
  return "homework";
}
