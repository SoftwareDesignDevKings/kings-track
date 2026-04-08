# Kings Track Gradeo Extension

This extension signs admins into Kings Track, calls Gradeo's web APIs from the
browser, and uploads normalized class and reporting data to the backend import
pipeline.

## What it does

- Syncs Gradeo classes from the Admin classes API
- Syncs the Gradeo student directory from the Admin students API
- Imports exam-summary reporting data for every mapped Gradeo class
- Uses Kings Track's Supabase auth instead of storing Gradeo credentials

## Setup

1. Load the `extension/` folder as an unpacked extension in Chrome or Firefox.
2. Open the popup and save:
   - Kings Track API base URL, for example `https://your-backend.example.com/api`
   - Supabase URL
   - Supabase anon key
3. Sign in with Google from the popup.
4. Save a fresh copied Gradeo request in the `Gradeo API headers` field.
5. Run `Sync classes`.
6. Link Gradeo classes to Canvas courses in Kings Track.
7. Run `Sync students`.
8. Run `Import mapped classes`.

### Local testing

If your backend is running locally in `AUTH_MODE=local`, the extension can use
the local API without Supabase sign-in.

Use:

- API base URL: `http://localhost:8000/api`
- Supabase URL: optional for local-only testing
- Supabase anon key: optional for local-only testing

In that mode, the backend resolves the local dev user and the extension can
call `/auth/me` without a bearer token.

## Notes

- The visible popup flow is API-first and does not require opening a specific
  Gradeo page, as long as your browser still has a valid Gradeo session.
- The old Gradeo content-script scraping code is still present in the repo for
  fallback/debugging, but it is hidden from the primary popup flow.
- The backend still owns validation, mapping, and persistence.
- Chrome uses the Manifest V3 service worker entrypoint, while Firefox falls
  back to `background.scripts` because Firefox still requires that background
  mode for this extension setup.
- The local `vendor/webextension-polyfill.js` wrapper keeps the runtime API
  consistent across Chromium and Firefox. The package also declares the
  upstream `webextension-polyfill` dependency so this package can be bundled or
  swapped to the official polyfill later.

## Gradeo API Map

## Implementation Status

- `Sync classes`: implemented with the admin classes API
- `Sync students`: implemented with the student directory API
- `Import mapped classes`: implemented with the reporting APIs at exam-summary level
- CSV question-detail import: documented only for now, not used by the visible flow

These are the Gradeo endpoints we have confirmed from live browser traffic so
far. They all appear to require the same logged-in browser session plus the
runtime `Authorization: Bearer ...` header used by the Gradeo web app.

### Student directory from Admin > Students

- `GET /api/school/v2/list/student/:schoolId?limit=:limit&offset=:offset&searchTerm=:searchTerm`
- Example:
  - `/api/school/v2/list/student/7572b03a-1507-4309-950e-2a286bdcf0a4?limit=10&offset=0&searchTerm=`
- Purpose:
  - Returns the school's paginated student directory used by `Admin > Students`.
- Response shape:
  - `{ pgn: { total }, list: [{ id, email, firstName, lastName, roles, products, subscriptionStatus, details, groups, subscriptionAccess }] }`
- Important fields confirmed:
  - `id`
  - `email`
  - `firstName`
  - `lastName`
  - `groups[]` with `{ id, name, syllabuses }`
- Used for:
  - `Sync students`
- Notes:
  - `searchTerm` is part of the server-side filtering contract even when blank.
  - `pgn.total` gives the total number of students across pages.
  - The `groups` array is useful for cross-checking class membership during import.

### Class discovery from Admin > Classes

- `GET /api/student-group/v2/:schoolId/by-school?limit=:limit&studentGroupName=&offset=:offset`
- Example:
  - `/api/student-group/v2/7572b03a-1507-4309-950e-2a286bdcf0a4/by-school?limit=10&studentGroupName=&offset=0`
- Purpose:
  - Returns the school's discovered classes with syllabus, student count, and
    teacher count.
- Response shape:
  - `{ pgn: { total }, list: [{ id, name, syllabuses, studentCount, teacherCount }] }`
- Used for:
  - `Sync classes`

### Reporting class dropdown

- `GET /api/student-group/temp/group-and-high-stake-exams-all`
- Purpose:
  - Returns the class list shown in the Gradeo Reporting class dropdown.
- Response shape:
  - `[{ studentGroup: { id, name }, sessionInfo: null | object }]`
- Notes:
  - This is reporting-specific and is different from the admin classes endpoint.
  - The `studentGroup.id` values match the class ids returned by the admin
    class discovery endpoint.

### Reporting student dropdown for a selected class

- `GET /api/student-group/:groupId`
- Example:
  - `/api/student-group/bd073dae-d4e8-4748-9fda-b0691456e190`
- Purpose:
  - Returns the selected class with its students, teachers, and syllabuses.
- Response shape:
  - `{ id, name, users: [...], teachers: [...], syllabuses: [...] }`
- Notes:
  - `users` is the source for the Reporting student dropdown.
  - Each user has `{ id, firstName, lastName }`.
  - Used by:
    - `Import mapped classes`

### Reporting test results table

- `GET /api/statistics-student/teacher/exam-session-result?limit=:limit&offset=:offset&studentId=:studentId&groupId=:groupId`
- Examples:
  - `/api/statistics-student/teacher/exam-session-result?limit=10&offset=0&studentId=06ac46ae-40e5-4bff-ac32-0dc28e2e7262&groupId=bd073dae-d4e8-4748-9fda-b0691456e190`
  - `/api/statistics-student/teacher/exam-session-result?limit=10&offset=20&studentId=ec94031d-6da2-414d-b3f5-b793b7353389&groupId=bd073dae-d4e8-4748-9fda-b0691456e190`
- Purpose:
  - Returns the paginated test result rows shown in Reporting for one selected
    class and one selected student.
- Response shape:
  - `{ pgn: { total }, list: [{ examSessionId, examAnswerSheetId, markingSessionId, examSessionStartDate, examSessionMaxTimeSeconds, examTitle, examPointsTotal, studentMarkTotal, studentTimeSpentSeconds, studentGroupMarkAverage }] }`
- Notes:
  - `offset` is the pagination control.
  - `pgn.total` is the total row count for the current student.
  - `markingSessionId` is important because it is the key used by the CSV export.
  - `studentMarkTotal` and related fields can be `null` for unsubmitted or
    unmarked work.
  - Used by:
    - `Import mapped classes`
  - Current implementation:
    - We normalize these rows into exam-summary imports only.
    - We do not fetch CSV question detail yet.

### Per-marking-session CSV export

- `GET /api/statistics-marking-session/download-csv/:markingSessionId/`
- Example:
  - `/api/statistics-marking-session/download-csv/03a33acc-5e7a-4cc1-b5ea-d98b14b3a51c/`
- Purpose:
  - Downloads the detailed per-question CSV behind the Reporting row action.
- Response shape:
  - Raw CSV text.
- Important columns confirmed:
  - `Exam`
  - `Exam ID`
  - `Class name`
  - `Class average`
  - `Student`
  - `Student ID`
  - `Question`
  - `Question ID`
  - `Question part`
  - `Question part ID`
  - `Question link`
  - `Mark`
  - `Marks available`
  - `Answer submitted?`
  - `Feedback`
  - `Marker name`
  - `Marker ID`
  - `Marking session link`
  - `Exam mark`
  - `Syllabus title`
  - `Syllabus grade`
  - `Bands`
  - `Outcomes`
  - `Topics`
- Notes:
  - The export is keyed by `markingSessionId`, not `examSessionId`.
  - This looks like the richest source for question-level import data.

### Marking-session student completion summary

- `GET /api/marking-session-statistics/student-completion-statistics/:markingSessionId`
- Example:
  - `/api/marking-session-statistics/student-completion-statistics/4597ef59-2a22-4cae-9f99-6766398676ab`
- Purpose:
  - Returns a compact class-level progress summary for one marking session.
- Response shape:
  - `{ totalQuestionCount, totalStudentCount, completedCount, inProgressCount, overdueCount, notStartedCount }`
- Useful fields confirmed:
  - `totalStudentCount`
  - `completedCount`
  - `inProgressCount`
  - `overdueCount`
  - `notStartedCount`
- Notes:
  - This looks useful for progress dashboards and quick integrity checks.
  - It is summary-only, so it does not replace reporting import rows.
  - `totalQuestionCount` can be `null`.

### Per-student marking/exam state for a marking session

- `GET /api/exam-process/aggregated/state/marking/student/:markingSessionId`
- Example:
  - `/api/exam-process/aggregated/state/marking/student/4597ef59-2a22-4cae-9f99-6766398676ab`
- Purpose:
  - Returns the per-student state for a marking session, including submission metadata and completion counts.
- Response shape:
  - `[{ examAnswerSheetWithUser: { header, user, config }, markingSessionAnswerStatistics: { ... } }]`
- Useful fields confirmed:
  - `examAnswerSheetWithUser.header.id`
  - `examAnswerSheetWithUser.header.sessionId`
  - `examAnswerSheetWithUser.header.startDate`
  - `examAnswerSheetWithUser.header.submitDate`
  - `examAnswerSheetWithUser.header.isSubmitted`
  - `examAnswerSheetWithUser.user.{ id, firstName, lastName }`
  - `markingSessionAnswerStatistics.examSessionStatus`
  - `markingSessionAnswerStatistics.submittedPartCount`
  - `markingSessionAnswerStatistics.totalPartCount`
  - `markingSessionAnswerStatistics.timeSpentSeconds`
  - `markingSessionAnswerStatistics.studentGroupName`
- Notes:
  - This looks very useful for deriving richer per-student exam status than the reporting table alone.
  - `examSessionStatus` values observed include `COMPLETED` and `LIVE`.
  - Students without a submitted answer sheet can still appear here with `header: null`.
  - This route is likely a better source for submission progress than the reporting matrix if we later want “started vs submitted vs finished”.

### Marking-session aggregate metadata

- `GET /api/exam-process/aggregated/state/marking/:markingSessionId`
- Example:
  - `/api/exam-process/aggregated/state/marking/4597ef59-2a22-4cae-9f99-6766398676ab`
- Purpose:
  - Returns the parent exam session, exam metadata, and marking-session configuration for a marking session.
- Response shape:
  - `{ examSession, examSessionAccessAttribute, exam, markingSession, markingSessionMarkerType }`
- Useful fields confirmed:
  - `examSession.id`
  - `examSession.examId`
  - `examSession.safeExamBrowserConfigFile`
  - `exam.title`
  - `exam.grade`
  - `exam.publishDate`
  - `exam.syllabusId`
  - `markingSession.id`
  - `markingSession.examSessionId`
  - `markingSession.isFinished`
  - `markingSession.hideGradeUntilPublish`
  - `markingSession.enableSplitMarking`
  - `markingSessionMarkerType`
- Notes:
  - This looks useful for enriching exam metadata and understanding whether a marking session is finished/published.
  - It may also be the best source for future “exam mode” metadata such as Safe Exam Browser requirements.

### Marker completion summary

- `GET /api/marking-session-statistics/maker-completion-statistics/:markingSessionId`
- Example:
  - `/api/marking-session-statistics/maker-completion-statistics/4597ef59-2a22-4cae-9f99-6766398676ab`
- Purpose:
  - Returns aggregate answer-marking progress for the marking session.
- Response shape:
  - `{ totalAnswerCount, completedCount, inProgressCount }`
- Notes:
  - The route path appears to use `maker`, which may be an internal typo for `marker`; keep the captured path exactly as Gradeo serves it.
  - This looks useful for marker workload/progress dashboards, but not essential for v1 imports.

### Per-student answer-part marking statistics

- `GET /api/marking-session-statistics/student-answer-part-statistics-list/:markingSessionId/:studentId`
- Example:
  - `/api/marking-session-statistics/student-answer-part-statistics-list/4597ef59-2a22-4cae-9f99-6766398676ab/118527d0-92db-445a-9a2f-9b5bf7657533`
- Purpose:
  - Returns part-level marking progress for one student inside one marking session.
- Response shape:
  - `[{ partId, sectionDisplayIndex, questionDisplayIndex, partDisplayIndex, markingStatus, markSubmitDate, markerName, partWorkingTimeSeconds, isAutomarked }]`
- Useful fields confirmed:
  - `partId`
  - `sectionDisplayIndex`
  - `questionDisplayIndex`
  - `partDisplayIndex`
  - `markingStatus`
  - `markSubmitDate`
  - `markerName`
  - `partWorkingTimeSeconds`
  - `isAutomarked`
- Notes:
  - This is promising for future question-part level import or richer marking-state displays.
  - Observed `markingStatus` value: `NOT_STARTED`.
  - This could help bridge from exam-summary rows to finer part-level state even without CSV.

### Class roster variation for a specific exam

- `GET /api/student-group/v2/:groupId/variation-one/:examId`
- Example:
  - `/api/student-group/v2/001c4bb9-285d-4e16-a4a1-a880ada3348a/variation-one/9b7e9109-b76c-4db4-afad-99b40ef2cd07`
- Purpose:
  - Returns a class roster scoped to one exam, with student status, teacher list, and syllabus context.
- Response shape:
  - `{ id, name, students, teachers, syllabuses }`
- Useful fields confirmed:
  - `students[].{ id, email, firstName, lastName, status }`
  - `teachers[].{ id, email, firstName, lastName, status }`
  - `syllabuses[]`
- Notes:
  - This looks like an exam-scoped roster route rather than a general class-detail route.
  - It may be useful when we need to know which students were actually relevant to a specific exam, especially if class membership changed over time.
  - It could also help explain discrepancies between the general class roster and a single exam/marking session.

## What We Still Need

- Confirmation whether any non-CSV JSON detail endpoint exists for a single
  `markingSessionId` or `examSessionId`.
  - If yes, that may be easier and safer than parsing CSV.
- Confirmation whether Gradeo expects anything beyond the live bearer token and
  browser session for these requests in all cases.

## Sanity Checks On The Confirmed Routes

- The routes you captured are internally consistent.
- The student-directory route looks correct and is exactly the missing API route
  we needed for replacing the `schoolStudents` scraper.
- The reporting class route looks correct.
- The student list route looks correct, even though it is a class detail route
  rather than a dedicated reporting-students endpoint.
- The results route looks correct and clearly drives pagination through
  `limit`/`offset`.
- The CSV route looks correct, and the key detail is that it hangs off
  `markingSessionId`.

The one thing you have not missed but that is worth keeping straight is that
there are two different class-list endpoints:

- Admin class discovery:
  - `/api/student-group/v2/:schoolId/by-school`
- Reporting class dropdown:
  - `/api/student-group/temp/group-and-high-stake-exams-all`

They serve different parts of the UI, so we should keep both.

At this point, the core Gradeo import surface is covered:

- student directory
- admin class discovery
- reporting class dropdown
- reporting student list
- reporting paginated test results
- detailed CSV export by `markingSessionId`
- marking-session progress summaries
- per-student marking-session state
- exam-scoped roster data
