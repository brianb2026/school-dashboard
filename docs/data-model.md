# Data model

Types live in `packages/core/src/types.ts`; tables in `apps/server/src/db/schema.ts`.

| Entity | Key fields | Notes |
|---|---|---|
| `Course` | id, code, name, term, credits, level, color, instructors[], meetings[] | `level` (regular/honors/ap/ib/de) drives the GPA bonus |
| `Assignment` | id, courseId, title, kind, category, dueAt, pointsPossible, status, submittable, attachments[], effortHours | `category` must match a grading category name |
| `GradeEntry` | assignmentId, courseId, score, pointsPossible, dropped | one row per source; merge picks one |
| `GradingScheme` | courseId, categories[{name, weight, dropLowest}] | usually from the syllabus |
| `AttendanceRecord` | courseId, date, status | present/absent/late/excused |
| `Announcement` | id, courseId, title, body, postedAt, read | |
| `Message` | id, threadId, courseId, from, to[], subject, snippet, receivedAt, unread | email only; bodies fetched on open |
| `syllabi` (table) | id, courseId, filename, parse JSON, confirmed | parse waits for your review |

Every record has `sources[]` (`SourceRef`: source, externalId, url, fetchedAt).

## Grade math

- Category percent = Σ earned / Σ possible over graded, non-dropped items (after drop-lowest).
- Current grade = Σ(category% × weight) / Σ(weights of categories with graded work).
- What-if: needed on the rest = (target × 100 − current × weightGraded) / (100 − weightGraded).
- Letter: highest cutoff in `config/school.json` that the percent meets.
- GPA: Σ((points + level bonus) × credits) / Σ credits; no bonus on an F; unweighted shown alongside.
