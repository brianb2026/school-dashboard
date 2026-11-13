/** What the Today panels draw. Built from live data or from the sample set. */
export interface DueItem {
  id: string;
  title: string;
  kind: string;
  dueAt: string;
  late: boolean;
  courseCode?: string;
  color?: string;
}

export interface GradeRow {
  id: string;
  name: string;
  code: string;
  color: string;
  percent?: number;
  letter?: string;
  weightGraded: number;
  hasScheme: boolean;
}

export interface InboxItem {
  id: string;
  from: string;
  subject: string;
  at: string;
  kind: "email" | "announcement";
  unread: boolean;
  color?: string;
}

export interface HeatDay {
  day: string;
  hours: number;
  count: number;
  conflict: boolean;
}
