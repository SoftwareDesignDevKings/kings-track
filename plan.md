# Plan: Merge Kings Analytics + Teams Attendance into Unified Super App

## Summary

Extend **Kings Analytics Dashboard** (kings-track-Demo) as the base application, porting all attendance features from **Teams Attendance Tracker** into it, and building a new **cross-course Student Profile** page that unifies academic and attendance data.

---

## Phase 1: Database — Add Attendance Tables

**New Alembic migration (`0013_attendance_tables.py`)** adding two tables:

### `meetings` table
```
id               SERIAL PK
teams_meeting_id VARCHAR(255) UNIQUE NOT NULL
title            VARCHAR(500)
start_time       TIMESTAMPTZ NOT NULL
end_time         TIMESTAMPTZ NOT NULL
organizer_email  VARCHAR(255)
class_code       VARCHAR(50)
course_id        BIGINT FK -> courses(id) (nullable, linked when class_code matches)
created_at       TIMESTAMPTZ DEFAULT now()

Indexes: teams_meeting_id, class_code, course_id, start_time
```

### `attendance_records` table
```
id               SERIAL PK
meeting_id       INT FK -> meetings(id) CASCADE
user_id          BIGINT FK -> users(id) CASCADE  (reuses existing Canvas users table)
join_time        TIMESTAMPTZ NOT NULL
leave_time       TIMESTAMPTZ
duration_minutes INT
status           VARCHAR(20) DEFAULT 'present'  (present|late|partial|absent)
created_at       TIMESTAMPTZ DEFAULT now()

Unique: (meeting_id, user_id, join_time)
Indexes: meeting_id, user_id, status
```

**Key design decisions:**
- Reuse the existing `users` table (Canvas user IDs) instead of a separate students table — match by email during CSV import
- Link meetings to courses via `course_id` FK (matched using class_code <-> course_code)
- No separate `canvas_enrollments` table needed — the existing `enrollments` table already tracks this

### New SQLAlchemy models
- `backend/app/models/meeting.py` — Meeting model
- `backend/app/models/attendance_record.py` — AttendanceRecord model

---

## Phase 2: Backend — Attendance Services (Python Port)

Port the core attendance logic from TypeScript to Python.

### 2a. CSV Parser (`backend/app/attendance/csv_parser.py`)
Port `teams-csv-parser.service.ts` to Python:
- Detect Teams native format (multi-section TSV) vs flat CSV
- Parse Summary section (title, start/end time, meeting ID)
- Parse Participants section (name, email, join/leave times, duration, role)
- Extract class code from meeting title via regex `\b(\d{1,2}[A-Z]{2,}\d?)\b`
- Determine attendance status (present/late/partial) using thresholds
- Handle UTF-16 LE/BE BOM encoding (native Teams export format)
- Match participants to existing `users` by email
- Link meetings to `courses` by matching class_code to course_code
- Bulk upsert with `ON CONFLICT` duplicate handling

### 2b. Folder Watcher (`backend/app/attendance/watcher.py`)
Port `folder-watcher.service.ts` using Python's `watchdog` library:
- Watch a configured directory for new `.csv` files
- Stability check (wait for file write completion)
- Validate file is a Teams attendance report (filename + content checks)
- Parse and import via CSV parser
- Move processed files to a `processed/` subfolder with timestamp prefix
- Track import history (filename, timestamp, success, meeting title, record count)
- Start/stop/scan controls via API

### 2c. Attendance Service (`backend/app/attendance/service.py`)
- `get_meetings()` — list meetings with optional class_code filter, pagination
- `get_meeting_attendance(meeting_id)` — attendance records + absence detection
- `get_student_attendance_summary(user_id)` — cross-course attendance stats
- `get_class_attendance_summary(class_code)` — per-class stats
- Class code amalgamation: strip trailing digit after X to get base code, LIKE query

### 2d. Manual CSV Upload
- Accept multipart file upload (10MB limit)
- Same parsing pipeline as folder watcher
- Return import results (records imported, meeting title, errors)

---

## Phase 3: Backend — Attendance API Routes

**New route file:** `backend/app/api/routes/attendance.py`

### Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/attendance/meetings` | List meetings (optional `?class_code=`, `?course_id=`) |
| `GET` | `/api/attendance/meetings/{id}` | Meeting detail with attendance + absences |
| `GET` | `/api/attendance/classes` | Distinct class codes with meeting counts |
| `POST` | `/api/attendance/import` | Manual CSV upload |
| `GET` | `/api/attendance/watcher/status` | Watcher status |
| `GET` | `/api/attendance/watcher/history` | Import history |
| `POST` | `/api/attendance/watcher/start` | Start watcher |
| `POST` | `/api/attendance/watcher/stop` | Stop watcher |
| `POST` | `/api/attendance/watcher/scan` | Scan and process existing files |

---

## Phase 4: Backend — Student Profile API

**New route file:** `backend/app/api/routes/students.py`

### Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/students` | List all students with summary stats |
| `GET` | `/api/students/search?q=` | Search students by name/email |
| `GET` | `/api/students/{user_id}/profile` | Full cross-course student profile |

### Student Profile Response Structure:
```json
{
  "student": {
    "id": 12345,
    "name": "John Smith",
    "email": "john.smith@school.edu",
    "sis_id": "JS001"
  },
  "courses": [
    {
      "course_id": 100,
      "course_name": "11 Software Engineering",
      "course_code": "11SEN_2026",
      "metrics": {
        "completion_rate": 85.0,
        "on_time_rate": 90.0,
        "current_score": 78.5
      }
    }
  ],
  "attendance_summary": {
    "total_meetings": 40,
    "present": 35,
    "late": 3,
    "partial": 1,
    "absent": 1,
    "attendance_rate": 95.0
  },
  "attendance_by_class": [
    {
      "class_code": "11SENX",
      "total": 20,
      "present": 18,
      "late": 1,
      "absent": 1,
      "rate": 95.0
    }
  ],
  "recent_attendance": [
    {
      "meeting_id": 1,
      "meeting_title": "11SENX Period 3",
      "date": "2026-05-06T09:00:00Z",
      "status": "present",
      "join_time": "2026-05-06T09:01:00Z",
      "duration_minutes": 48
    }
  ],
  "gradeo_summary": {
    "exams_taken": 5,
    "average_mark_percent": 72.5
  },
  "edstem_summary": {
    "lessons_completed": 12,
    "total_lessons": 15,
    "completion_rate": 80.0
  }
}
```

---

## Phase 5: Frontend — Attendance Pages

### 5a. New page: `Attendance.tsx` (`/attendance`)
- Meeting list with class code filter tabs
- Each meeting row shows: title, date, class code, attendance summary
- Click meeting to see full attendance with absent students highlighted
- Pie chart showing overall attendance distribution

### 5b. New page: `AttendanceSync.tsx` (`/attendance/sync`)
- Watcher status card (running/stopped, folder path, files processed)
- Start/Stop/Scan buttons
- Manual CSV upload drag-and-drop zone
- Import history table (recent imports with success/fail indicators)

### 5c. Update `Header.tsx`
- Add "Attendance" navigation link between Courses and Settings

### 5d. Update `App.tsx`
- Add routes: `/attendance`, `/attendance/sync`

---

## Phase 6: Frontend — Student Profile Page

### 6a. New page: `StudentProfile.tsx` (`/students/:userId`)

**Layout:**
- Breadcrumb: Courses > Student Name
- Header card with student info (name, email, SIS ID)
- Summary stats row: overall completion %, attendance %, current score average
- Tab bar with 4 tabs:

**Tab 1: Overview**
- Key metrics cards (attendance rate, avg completion, avg score)
- Course-by-course summary table
- Attendance trend (last 10 meetings: green/amber/red dots)

**Tab 2: Attendance**
- Attendance stats by class (table with rates)
- Full meeting attendance history (sortable, filterable)
- Status breakdown pie chart

**Tab 3: Academics**
- Per-course expansion panels showing:
  - Assignment submissions with status badges
  - Completion/on-time/score metrics
  - Gradeo exam results (if available)

**Tab 4: EdStem** (shown only if EdStem data exists)
- Lesson progress per course

### 6b. Make student names clickable in existing tables

Update these components to link student names to the profile:
- `ActivityTable.tsx` — student name column → `<Link to={/students/${student.id}}>`
- `EdStemLessonTable.tsx` — same pattern
- `GradeoReportTable.tsx` — same pattern

### 6c. New components:
- `AttendanceBadge.tsx` — status indicator for attendance (present/late/partial/absent)
- `AttendanceSummaryCard.tsx` — reusable attendance stats display
- `StudentSearchBar.tsx` — search bar for finding students across courses

### 6d. New TypeScript interfaces in `types/index.ts`:
- `Meeting`, `AttendanceRecord`, `AttendanceSummary`
- `StudentProfile`, `StudentCourseData`, `StudentAttendanceByClass`

### 6e. New API hooks in `services/api.ts`:
- `useStudentProfile(userId)` — fetch full profile
- `useMeetings(classCode?)` — meeting list
- `useMeetingAttendance(meetingId)` — single meeting attendance
- `useWatcherStatus()` — watcher status (polling)
- `useImportCSV()` — mutation for manual upload
- `useWatcherControl()` — mutations for start/stop/scan
- `useStudentSearch(query)` — search students

---

## Phase 7: Integration & Polish

### 7a. Link attendance to courses
- When CSV is imported and class_code is extracted, auto-match to `courses` table
- Use pattern: course_code starts with class_code (e.g., "11SENX" matches "11SENX_2026")
- Set `meetings.course_id` for matched meetings

### 7b. Update Course Detail page
- Add an "Attendance" tab to CourseDetail.tsx showing meetings for that course
- Show attendance stats alongside submission stats per student

### 7c. Update Overview page
- Add attendance rate to CourseCard if attendance data exists for that course

### 7d. Environment variables (new)
```
WATCH_FOLDER=/path/to/attendance/csvs
PROCESSED_FOLDER=/path/to/processed
WATCH_ENABLED=true
ATTENDANCE_LATE_THRESHOLD_MINUTES=10
ATTENDANCE_PARTIAL_THRESHOLD_MINUTES=30
```

---

## Implementation Order

1. **Phase 1** — Database migration + models (foundation, everything depends on this)
2. **Phase 2** — Backend attendance services (CSV parser, watcher, service)
3. **Phase 3** — Attendance API routes (enables testing with API)
4. **Phase 4** — Student profile API (backend for profile page)
5. **Phase 5** — Frontend attendance pages (attendance UI)
6. **Phase 6** — Frontend student profile page (core deliverable)
7. **Phase 7** — Integration and polish (connecting everything together)

---

## Files to Create (New)

| File | Purpose |
|------|---------|
| `backend/alembic/versions/0013_attendance_tables.py` | Migration |
| `backend/app/models/meeting.py` | Meeting SQLAlchemy model |
| `backend/app/models/attendance_record.py` | AttendanceRecord SQLAlchemy model |
| `backend/app/attendance/__init__.py` | Package init |
| `backend/app/attendance/csv_parser.py` | Teams CSV parser (ported from TS) |
| `backend/app/attendance/watcher.py` | Folder watcher (ported from TS) |
| `backend/app/attendance/service.py` | Attendance business logic |
| `backend/app/api/routes/attendance.py` | Attendance API endpoints |
| `backend/app/api/routes/students.py` | Student profile API endpoints |
| `frontend/src/pages/Attendance.tsx` | Attendance meetings page |
| `frontend/src/pages/AttendanceSync.tsx` | Watcher + upload page |
| `frontend/src/pages/StudentProfile.tsx` | Cross-course student profile |
| `frontend/src/components/AttendanceBadge.tsx` | Attendance status badge |
| `frontend/src/components/AttendanceSummaryCard.tsx` | Attendance stats display |

## Files to Modify (Existing)

| File | Changes |
|------|---------|
| `backend/app/main.py` | Register attendance + student routes, start watcher in lifespan |
| `backend/app/config.py` | Add attendance env vars |
| `backend/app/models/__init__.py` | Export new models |
| `backend/requirements.txt` | Add `watchdog`, `python-multipart` |
| `frontend/src/App.tsx` | Add new routes |
| `frontend/src/services/api.ts` | Add new query hooks |
| `frontend/src/types/index.ts` | Add new interfaces |
| `frontend/src/components/Header.tsx` | Add Attendance nav link |
| `frontend/src/components/ActivityTable.tsx` | Make student names clickable |
| `frontend/src/components/EdStemLessonTable.tsx` | Make student names clickable |
| `frontend/src/components/GradeoReportTable.tsx` | Make student names clickable |
| `frontend/src/pages/CourseDetail.tsx` | Add Attendance tab |
| `frontend/src/pages/Overview.tsx` | Add attendance rate to course cards |
