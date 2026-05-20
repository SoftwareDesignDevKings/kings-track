# CST LMS - Complete Technical Reference

This document provides a comprehensive understanding of both applications in the CST LMS workspace, intended as a reference for ongoing development work.

---

## MERGED APPLICATION — What Changed

The two apps have been merged into one unified platform inside `kings-track-Demo/`. The Teams Attendance Tracker's functionality was ported into the Kings Analytics Dashboard.

### New Backend Files
| File | Purpose |
|------|---------|
| `backend/app/models/meeting.py` | `meetings` table (Teams meeting records) |
| `backend/app/models/attendance_record.py` | `attendance_records` table (per-student attendance) |
| `backend/alembic/versions/0013_attendance_tables.py` | Migration for attendance tables |
| `backend/app/attendance/__init__.py` | Attendance package |
| `backend/app/attendance/csv_parser.py` | Teams CSV parser (ported from TypeScript) |
| `backend/app/attendance/service.py` | Attendance queries, student profile, concern flagging |
| `backend/app/attendance/watcher.py` | Folder watcher (ported from chokidar to watchdog) |
| `backend/app/api/routes/attendance.py` | Attendance API endpoints |
| `backend/app/api/routes/students.py` | Student profile API endpoints |

### New Frontend Files
| File | Purpose |
|------|---------|
| `frontend/src/pages/Dashboard.tsx` | Main dashboard with Students/Classes/Academic tabs |
| `frontend/src/pages/StudentProfile.tsx` | Cross-course student profile with concern flagging |

### Modified Files
| File | Changes |
|------|---------|
| `backend/app/main.py` | Registers attendance + student routes, starts watcher |
| `backend/app/config.py` | Added watch_folder, processed_folder, watch_enabled settings |
| `backend/app/models/__init__.py` | Exports Meeting + AttendanceRecord |
| `backend/requirements.txt` | Added watchdog, python-multipart |
| `frontend/src/App.tsx` | New routes: `/` (Dashboard), `/courses` (old Overview), `/students/:userId` |
| `frontend/src/services/api.ts` | Added attendance + student hooks |
| `frontend/src/types/index.ts` | Added attendance + student profile types |
| `frontend/src/components/Header.tsx` | Added Dashboard nav link |
| `frontend/src/components/ActivityTable.tsx` | Student names are clickable links |
| `frontend/src/components/EdStemLessonTable.tsx` | Student names are clickable links |
| `frontend/src/components/GradeoReportTable.tsx` | Student names are clickable links |

### New API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/attendance/meetings` | List meetings |
| `GET` | `/api/attendance/meetings/{id}` | Meeting detail + absences |
| `GET` | `/api/attendance/classes` | Class codes list |
| `GET` | `/api/attendance/stats` | Dashboard stats |
| `POST` | `/api/attendance/import` | Manual CSV upload |
| `GET/POST` | `/api/attendance/watcher/*` | Watcher controls |
| `GET` | `/api/students` | All students with metrics + concern flags |
| `GET` | `/api/students/{id}/profile` | Full student profile |

### New Database Tables
- `meetings` — Teams meeting records linked to courses via class_code
- `attendance_records` — Per-student attendance linked to existing `users` table

### Student of Concern Logic
A student is flagged if ANY of these conditions are met:
- **High concern**: attendance <50% OR completion <30% OR both attendance <75% and completion <60%
- **Moderate concern**: attendance <75% OR completion <50% OR on-time rate <50% OR missing assignments >30%

### New Frontend Routes
| Route | Page |
|-------|------|
| `/` | Dashboard (was previously Overview/Courses) |
| `/courses` | Course list (moved from `/`) |
| `/students/:userId` | Student profile |

---

## Table of Contents

1. [Application Overview](#application-overview)
2. [App 1: Kings Analytics Dashboard (kings-track-Demo)](#app-1-kings-analytics-dashboard)
3. [App 2: Teams Attendance Tracker (teams-attendance-tracker)](#app-2-teams-attendance-tracker)
4. [Shared Concepts & Integration Points](#shared-concepts--integration-points)
5. [Quick Reference Tables](#quick-reference-tables)

---

## Application Overview

| Property | Kings Analytics Dashboard | Teams Attendance Tracker |
|----------|--------------------------|--------------------------|
| **Purpose** | Canvas LMS analytics platform for teachers - tracks student submissions, grades, and progress | Microsoft Teams attendance tracking - imports attendance CSVs and cross-references with Canvas rosters |
| **Frontend** | React 18 + TypeScript + Vite + TailwindCSS | React 18 + TypeScript + MUI v7 |
| **Backend** | Python FastAPI (async) | Node.js Express (TypeScript) |
| **Database** | PostgreSQL 16 (via Supabase) | PostgreSQL 14+ (local) |
| **ORM/DB Client** | SQLAlchemy 2.0 + asyncpg | node-postgres (pg) raw SQL |
| **Deployment** | Cloud (Vercel + Render + Supabase) | Local desktop only |
| **Auth** | Supabase JWT / Google OAuth | Disabled (local use) |
| **Canvas Integration** | Full API sync (courses, enrollments, assignments, submissions) | Roster sync only (courses, students) |

Both applications serve teachers at Kings school and share Canvas LMS as a common data source.

---

## App 1: Kings Analytics Dashboard

**Repo path:** `kings-track-Demo/`

### Purpose

Provides teachers with real-time visibility into student progress across Canvas LMS. Aggregates data from three platforms:
- **Canvas LMS** - submissions, grades, assignment completion
- **Gradeo** - exam results with question-level feedback (via browser extension)
- **EdStem** - lesson/module progress (placeholder, not yet active)

### Tech Stack Detail

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS v3.4, TanStack Query v5, React Router v6 |
| Backend | FastAPI, SQLAlchemy 2.0, asyncpg, Alembic (migrations), Uvicorn, httpx |
| Database | PostgreSQL 16 (Supabase managed) |
| Auth | Supabase JWT (RS256/ES256), Google OAuth |
| Browser Extension | TypeScript, esbuild, WebExtension Manifest V3 |
| Deployment | Frontend: Vercel / Backend: Render (Docker) / DB: Supabase |
| CI/CD | GitHub Actions |

### Architecture

```
[Browser Extension] --postMessage--> [Frontend (React/Vite)]
                                          |
                                     [Supabase Auth]
                                          |
                                   [FastAPI Backend]
                                    /       |       \
                              [Canvas]  [EdStem]  [Gradeo]
                                    \       |       /
                                   [PostgreSQL (Supabase)]
```

### Directory Structure (Key Files)

```
kings-track-Demo/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app factory, CORS, lifespan
│   │   ├── config.py                  # Pydantic settings (all env vars)
│   │   ├── db.py                      # Async engine, connection pool (5+2)
│   │   ├── whitelist.py               # Course visibility filtering
│   │   ├── api/
│   │   │   ├── deps.py                # Auth dependencies (require_auth, require_admin)
│   │   │   └── routes/
│   │   │       ├── auth.py            # GET /api/auth/me
│   │   │       ├── courses.py         # Course list, detail, matrix, EdStem, Gradeo
│   │   │       ├── sync.py            # Trigger/status sync
│   │   │       ├── admin.py           # User & whitelist management
│   │   │       ├── gradeo_admin.py    # Gradeo integration management
│   │   │       ├── reminders_admin.py # Reminder config
│   │   │       └── canvas_health.py   # Canvas connectivity check
│   │   ├── canvas/
│   │   │   ├── client.py              # Canvas API client with rate limiting
│   │   │   └── pagination.py          # RFC 5988 Link header parser
│   │   ├── sync/
│   │   │   ├── engine.py              # Sync orchestrator + scheduler
│   │   │   ├── tasks.py               # Per-entity sync (courses, enrollments, etc.)
│   │   │   └── edstem_tasks.py        # EdStem sync tasks
│   │   ├── models/                    # 32 SQLAlchemy models
│   │   ├── gradeo/                    # Gradeo import pipeline
│   │   │   ├── importer.py            # Class/student/exam import
│   │   │   ├── matcher.py             # Canvas user matching
│   │   │   ├── normalizer.py          # Data normalization
│   │   │   ├── source.py              # Extension payload adapter
│   │   │   └── types.py               # Gradeo data types
│   │   ├── reminders/                 # Email reminder system
│   │   │   ├── engine.py              # Scheduler
│   │   │   ├── service.py             # Business logic
│   │   │   ├── email.py               # SMTP delivery
│   │   │   └── templates.py           # Email templates
│   │   └── edstem/
│   │       └── client.py              # EdStem REST API wrapper
│   ├── alembic/versions/              # 12 migration files (0001-0012)
│   ├── tests/                         # pytest + respx mocking
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # Root with React Router
│   │   ├── pages/
│   │   │   ├── Login.tsx              # Google OAuth entry
│   │   │   ├── Overview.tsx           # Course list dashboard
│   │   │   ├── CourseDetail.tsx       # Course analytics (tabs)
│   │   │   ├── Admin.tsx              # Admin panel
│   │   │   └── ExtensionBridge.tsx    # Gradeo extension bridge
│   │   ├── components/
│   │   │   ├── ActivityTable.tsx      # Student submission matrix
│   │   │   ├── GradeoReportTable.tsx  # Exam results matrix
│   │   │   ├── EdStemLessonTable.tsx  # Lesson progress matrix
│   │   │   ├── CourseCard.tsx         # Course summary card
│   │   │   ├── StatusBadge.tsx        # Status indicator
│   │   │   ├── CanvasOutageBanner.tsx # API status alert
│   │   │   └── ProtectedRoute.tsx     # Auth route guard
│   │   ├── services/api.ts           # TanStack Query hooks
│   │   ├── lib/
│   │   │   ├── auth.ts               # Supabase/local auth helpers
│   │   │   ├── supabase.ts           # Supabase client init
│   │   │   └── extensionBridge.ts    # postMessage bridge
│   │   └── types/index.ts            # All TypeScript interfaces
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── extension/
│   ├── manifest.json                  # WebExtension Manifest V3
│   ├── src/
│   │   ├── background/               # Service worker
│   │   │   ├── index.ts              # Tab navigation handler
│   │   │   ├── worker.ts             # Service worker entry
│   │   │   ├── messages.ts           # Message handlers
│   │   │   ├── payload.ts            # Gradeo data utilities
│   │   │   ├── state.ts              # Extension state
│   │   │   ├── gradeoApi.ts          # Gradeo platform interaction
│   │   │   └── kingsTrackApi.ts      # Kings Track API calls
│   │   ├── content/                   # Content scripts (scrape Gradeo)
│   │   │   ├── reporting.ts           # Exam results scraper
│   │   │   ├── schoolStudents.ts      # Student directory scraper
│   │   │   ├── schoolGroups.ts        # Class groups scraper
│   │   │   └── bridge.ts             # Extension-to-page messaging
│   │   └── popup/                     # Extension popup UI
│   ├── build.mjs                      # esbuild config
│   └── package.json
├── docker-compose.yml                 # Local dev (db + backend + frontend)
├── render.yaml                        # Render deployment config
└── vercel.json                        # Vercel deployment config
```

### Database Schema

**Core Canvas Tables:**

| Table | Primary Key | Key Columns | Unique Constraints |
|-------|-------------|-------------|-------------------|
| `users` | `id` (BigInt) | name, email, sis_id | - |
| `courses` | `id` (BigInt) | name, course_code, workflow_state, synced_at | - |
| `enrollments` | `id` (BigInt) | course_id FK, user_id FK, role, current_score, final_grade | (course_id, user_id, role) |
| `assignments` | `id` (BigInt) | course_id FK, name, due_at, points_possible, position | - |
| `submissions` | `id` (BigInt) | assignment_id FK, user_id FK, course_id FK, score, late, missing, excused | (assignment_id, user_id) |
| `student_metrics` | `id` (Int) | course_id FK, user_id FK, completion_rate, on_time_rate, current_score, computed_at | (course_id, user_id) |

**App Management Tables:**

| Table | Primary Key | Key Columns |
|-------|-------------|-------------|
| `app_users` | `id` (Int) | email (unique), role ('admin'\|'teacher'), created_at |
| `course_whitelist` | `course_id` (BigInt) | name, course_code, added_by, added_at |
| `sync_log` | `id` (Int) | entity_type, course_id, status, records_synced, error_message |

**EdStem Tables:**

| Table | Key Columns | Unique |
|-------|-------------|--------|
| `edstem_course_mappings` | canvas_course_id, edstem_course_id | edstem_course_id |
| `edstem_lessons` | id, edstem_course_id, title, module_name, position | - |
| `edstem_lesson_progress` | user_id, edstem_lesson_id, status, completed_at | (user_id, edstem_lesson_id) |

**Gradeo Tables (14 models):**

| Table | Key Columns |
|-------|-------------|
| `gradeo_classes` | gradeo_class_id (String PK), name, normalized_name |
| `gradeo_class_mappings` | canvas_course_id, gradeo_class_id (unique) |
| `gradeo_students` | gradeo_student_id (String PK), name, email |
| `gradeo_exams` | exam definitions |
| `gradeo_exam_sessions` | marking sessions |
| `gradeo_exam_results` | gradeo_student_id FK, exam_mark, marks_available, status |
| `gradeo_assignment_results` | per-assignment results |
| `gradeo_assignment_question_results` | gradeo_student_id, gradeo_question_part_id, mark, feedback |
| `gradeo_class_exam_assignments` | gradeo_class_id FK, exam_name, class_average |
| `gradeo_import_runs` | run_type, status, matched_students, imported_exams |

**Reminder Tables:**

| Table | Key Columns |
|-------|-------------|
| `reminder_runs` | scheduled_for, triggered_by, status, recipient counts |
| `reminder_deliveries` | reminder_run_id, recipient_email, recipient_type, status |

**Other:**

| Table | Key Columns |
|-------|-------------|
| `schools` | name (unique) |
| `school_contacts` | school_id, email, relationship |
| `guardian_contacts` | user_id FK, name, email, relationship_label, unique(user_id, email) |
| `student_school_links` | user_id FK, school_id FK |

### API Endpoints

**Auth & Health:**
- `GET /api/auth/me` - Current user info
- `GET /api/health` - Health check
- `GET /api/canvas/health` - Canvas connectivity

**Courses & Analytics:**
- `GET /api/courses` - All whitelisted courses with stats
- `GET /api/courses/{id}` - Single course
- `GET /api/courses/{id}/matrix` - Student submission matrix (students x assignments)
- `GET /api/courses/{id}/edstem-matrix` - EdStem lesson progress matrix
- `GET /api/courses/{id}/gradeo` - Gradeo exam results

**Sync:**
- `POST /api/sync/trigger` - Trigger full Canvas sync
- `GET /api/sync/status` - Sync progress & logs

**Admin - Users:**
- `GET /api/admin/users` - List users
- `POST /api/admin/users` - Create user
- `DELETE /api/admin/users/{email}` - Delete user

**Admin - Whitelist:**
- `GET /api/admin/whitelist` - List whitelisted courses
- `GET /api/admin/whitelist/available` - All Canvas courses
- `POST /api/admin/whitelist` - Add course
- `DELETE /api/admin/whitelist/{course_id}` - Remove course

**Admin - EdStem:**
- `GET /api/admin/edstem-mappings` - List mappings
- `GET /api/admin/edstem-courses` - All EdStem courses
- `POST /api/admin/edstem-mappings` - Create mapping
- `POST /api/admin/edstem-mappings/auto-match` - Auto-match
- `DELETE /api/admin/edstem-mappings/{canvas_course_id}` - Remove

**Admin - Gradeo:**
- `GET /admin/gradeo/student-directory` - Student sync status
- `POST /admin/gradeo/student-directory/refresh` - Sync students
- `GET /admin/gradeo/classes` - Gradeo classes
- `POST /admin/gradeo/class-discovery` - Register classes
- `GET /admin/gradeo/mappings` - Canvas-Gradeo mappings
- `POST /admin/gradeo/mappings` - Create mapping
- `DELETE /admin/gradeo/mappings/{canvas_course_id}` - Remove by Canvas
- `DELETE /admin/gradeo/mappings/by-gradeo-class/{gradeo_class_id}` - Remove by Gradeo
- `POST /admin/gradeo/mappings/auto-match` - Auto-match
- `POST /admin/gradeo/import` - Import exam results
- `GET /admin/gradeo/import-runs` - Import history

**Admin - Reminders:**
- `GET /admin/reminders/preview` - Preview next reminder
- `POST /admin/reminders/run` - Trigger reminder
- `GET /admin/reminders/runs` - Reminder history

### Authentication Flow

**Production:**
1. User clicks "Login with Google" on frontend
2. Supabase handles Google OAuth flow
3. Supabase returns JWT token
4. Frontend sends token as `Authorization: Bearer <token>` on all requests
5. Backend verifies JWT against Supabase JWKS endpoint
6. Email extracted from JWT must exist in `app_users` table
7. Role (admin/teacher) determines access level

**Local Dev:**
- `AUTH_MODE=local` skips all token verification
- Returns hardcoded user from `LOCAL_DEV_USER_EMAIL` / `LOCAL_DEV_USER_ROLE`

### Canvas API Client (Rate Limiting)

- Monitors `X-Rate-Limit-Remaining` header
- Backs off 1 second if remaining < 100
- Exponential backoff (1s, 2s, 4s) on 429/403 rate limit responses
- Max 3 retry attempts per request
- RFC 5988 Link header pagination for large datasets

### Sync Engine

- **Full sync** (every 6 hours): courses -> enrollments -> assignments -> submissions -> metrics
- **Incremental sync** (every 30 min): only updated submissions/enrollments since last sync
- Processes one course at a time (caps memory at ~256MB)
- Progress tracking with phase/step for UI display
- All operations logged to `sync_log` table

### Browser Extension

- Manifest V3 architecture (Chrome/Firefox)
- Content scripts inject on Gradeo reporting/student/class pages
- Scrapes HTML tables for exam/student/grade data
- Sends data to dashboard via `postMessage` bridge through the `/extension-bridge` page
- Payload size capped at 25MB

### Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CANVAS_API_URL` | required | Canvas instance URL |
| `CANVAS_API_TOKEN` | required | Canvas API token |
| `DATABASE_URL` | `postgresql+asyncpg://kings:kings@db:5432/kings_analytics` | DB connection |
| `SYNC_INTERVAL_HOURS` | 6 | Full sync interval |
| `INCREMENTAL_SYNC_INTERVAL_MINUTES` | 30 | Incremental sync interval |
| `AUTH_MODE` | `local` | `local` or `supabase` |
| `LOCAL_DEV_USER_EMAIL` | `admin@local.dev` | Dev user |
| `LOCAL_DEV_USER_ROLE` | `admin` | Dev role |
| `SUPABASE_URL` | optional | Supabase project URL |
| `EDSTEM_API_URL` | `https://edstem.org/api` | EdStem endpoint |
| `EDSTEM_API_TOKEN` | optional | EdStem token |
| `REMINDER_TIMEZONE` | `Australia/Sydney` | Reminder timezone |
| `REMINDER_EMAIL_ENABLED` | `false` | Enable email delivery |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed origins |
| `VITE_API_BASE_URL` | `/api` | Frontend API base |

---

## App 2: Teams Attendance Tracker

**Repo path:** `teams-attendance-tracker/`

### Purpose

Local desktop application for tracking student attendance in Microsoft Teams online classes. Auto-imports Teams attendance CSV exports and cross-references with Canvas LMS rosters to identify absent students.

### Key Features

- Auto-imports Teams attendance CSVs from a watched folder (chokidar file watcher)
- Manual CSV upload through web interface
- Canvas LMS roster sync for absence detection
- Auto-extracts class codes from meeting titles (e.g., "11SENX", "12SENX2")
- Class amalgamation (groups related classes sharing the same Teams meeting)
- Dashboard with attendance pie charts and statistics
- Attendance reports with CSV export
- Duplicate detection for safe re-imports

### Tech Stack Detail

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, MUI v7, Emotion, Recharts, React Router v7, Axios |
| Backend | Node.js, Express 4, TypeScript 5.3, Zod validation |
| Database | PostgreSQL 14+ (local), node-postgres (pg) |
| File Watching | chokidar v5 |
| CSV Parsing | csv-parse v6 |
| Logging | Winston |
| Security | Helmet, express-rate-limit, CORS |
| File Upload | multer (memory storage, 10MB limit) |
| Build | react-scripts 5 (frontend), ts-node-dev (backend dev) |

### Architecture

```
[Teams CSV Files] --> [Folder Watcher (chokidar)] --> [CSV Parser]
                                                          |
[Manual Upload] ----------------------------------------->|
                                                          v
                                                   [Express API]
                                                    /          \
                                              [Canvas API]  [PostgreSQL]
                                                    \          /
                                                   [React Frontend]
```

### Directory Structure (Key Files)

```
teams-attendance-tracker/
├── backend/
│   ├── src/
│   │   ├── server.ts                        # Express app init, middleware, auto-start watcher
│   │   ├── config/
│   │   │   ├── database.ts                  # pg Pool (max 20 connections)
│   │   │   ├── logger.ts                    # Winston config (file + console)
│   │   │   └── auth.ts                      # Azure AD config (disabled)
│   │   ├── controllers/
│   │   │   ├── students.controller.ts       # Student CRUD + search + attendance stats
│   │   │   ├── meetings.controller.ts       # Meeting list + class codes
│   │   │   ├── attendance.controller.ts     # Import, export, CRUD
│   │   │   ├── canvas.controller.ts         # Canvas sync + absence detection
│   │   │   └── watcher.controller.ts        # Watcher start/stop/scan/config
│   │   ├── models/
│   │   │   ├── Student.ts                   # Student table queries
│   │   │   ├── Meeting.ts                   # Meeting table queries
│   │   │   └── AttendanceRecord.ts          # Attendance queries + bulk import
│   │   ├── services/
│   │   │   ├── teams-csv-parser.service.ts  # Core: Teams CSV format parser
│   │   │   ├── folder-watcher.service.ts    # File system watcher
│   │   │   ├── canvas.service.ts            # Canvas API + roster sync
│   │   │   ├── attendance.service.ts        # Attendance calculations
│   │   │   ├── csv-import.service.ts        # Generic CSV import
│   │   │   └── graph.service.ts             # MS Graph API (unused)
│   │   ├── routes/
│   │   │   ├── students.routes.ts
│   │   │   ├── meetings.routes.ts
│   │   │   ├── attendance.routes.ts
│   │   │   ├── canvas.routes.ts
│   │   │   └── watcher.routes.ts
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts            # Auth (placeholder, not enforced)
│   │   │   └── error.middleware.ts           # Error handling + 404
│   │   └── types/index.ts                   # TypeScript interfaces
│   ├── test-data/                           # Sample CSV files
│   ├── processed/                           # Auto-imported CSVs moved here
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                          # Main layout (AppBar + Drawer + Routes)
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx                # Stats cards + pie chart + recent meetings
│   │   │   ├── Classes.tsx                  # Class attendance summary
│   │   │   ├── Students.tsx                 # Student list with class filter
│   │   │   ├── Meetings.tsx                 # Meeting list
│   │   │   ├── Reports.tsx                  # Attendance reports + CSV export
│   │   │   └── SyncPage.tsx                 # Watcher + Canvas sync controls
│   │   ├── services/api.ts                  # Axios API client (singleton)
│   │   ├── types/index.ts                   # TypeScript interfaces
│   │   └── config/authConfig.ts             # Azure AD config (unused)
│   ├── .env.example
│   └── package.json
├── database/migrations/
│   ├── 001_create_students.sql
│   ├── 002_create_meetings.sql
│   ├── 003_create_attendance.sql
│   └── 004_add_class_code.sql
├── Attendance_Files/                        # Default watched folder
├── docs/SETUP.md
├── TECHNICAL_DESIGN.md
├── QUICKSTART.md
├── start.command                            # macOS startup script
└── README.md
```

### Database Schema

**students:**
```
id                UUID PK (gen_random_uuid)
email             VARCHAR(255) UNIQUE NOT NULL
name              VARCHAR(255) NOT NULL
student_id        VARCHAR(50)
azure_ad_id       VARCHAR(255)
created_at        TIMESTAMP DEFAULT NOW()
updated_at        TIMESTAMP DEFAULT NOW()

Indexes: email, azure_ad_id, student_id
```

**meetings:**
```
id                UUID PK (gen_random_uuid)
teams_meeting_id  VARCHAR(255) UNIQUE NOT NULL
title             VARCHAR(500)
start_time        TIMESTAMP NOT NULL
end_time          TIMESTAMP NOT NULL
organizer_email   VARCHAR(255)
meeting_url       TEXT
class_code        VARCHAR(50)
created_at        TIMESTAMP DEFAULT NOW()

Check: end_time > start_time
Indexes: teams_meeting_id, start_time, end_time, organizer_email, class_code
```

**attendance_records:**
```
id                UUID PK (gen_random_uuid)
meeting_id        UUID FK -> meetings(id) CASCADE
student_id        UUID FK -> students(id) CASCADE
join_time         TIMESTAMP NOT NULL
leave_time        TIMESTAMP
duration_minutes  INTEGER
status            VARCHAR(50) DEFAULT 'present'  -- present|late|absent|partial
created_at        TIMESTAMP DEFAULT NOW()

Unique: (meeting_id, student_id, join_time)
Check: status IN ('present','late','absent','partial')
Check: leave_time IS NULL OR leave_time > join_time
Indexes: meeting_id, student_id, join_time, status
```

**canvas_enrollments:**
```
id                UUID PK (gen_random_uuid)
student_id        UUID FK -> students(id) CASCADE
canvas_course_id  INTEGER NOT NULL
canvas_user_id    INTEGER NOT NULL
class_code        VARCHAR(50) NOT NULL
created_at        TIMESTAMP DEFAULT NOW()
updated_at        TIMESTAMP DEFAULT NOW()

Unique: (student_id, canvas_course_id)
```

### API Endpoints

**Students (`/api/students`):**
- `GET /` - List all (optional `?class_code=`)
- `GET /class-codes` - Canvas class codes with counts
- `GET /search?q=` - Search by name/email/ID
- `GET /:id` - Single student
- `GET /:id/attendance` - Student attendance stats
- `POST /` - Create student
- `PUT /:id` - Update student
- `DELETE /:id` - Delete student

**Meetings (`/api/meetings`):**
- `GET /` - List (optional `?class_code=`, limit, offset)
- `GET /classes` - Distinct class codes
- `GET /recent?limit=` - Recent meetings
- `GET /:id` - Single meeting

**Attendance (`/api/attendance`):**
- `GET /` - All records (paginated)
- `GET /report` - Filtered report (student_id, meeting_id, dates, status)
- `GET /export` - CSV export of filtered report
- `GET /:id` - Single record
- `POST /` - Create record
- `POST /import` - Upload and import CSV
- `PUT /:id` - Update record
- `DELETE /:id` - Delete record

**Folder Watcher (`/api/watcher`):**
- `GET /status` - Watcher status (running, folder, file counts, last import)
- `GET /history` - Recent import history (50 entries)
- `POST /start` - Start watcher
- `POST /stop` - Stop watcher
- `POST /scan` - Scan and process existing files
- `PUT /config` - Update folder paths

**Canvas (`/api/canvas`):**
- `GET /status` - Config status + amalgamated class counts
- `GET /courses` - Available Canvas courses (online/external only)
- `GET /roster/:classCode` - Synced roster (with amalgamation)
- `GET /attendance/:meetingId` - Attendance with absence detection
- `POST /sync` - Sync single course roster
- `POST /sync-all` - Sync all online course rosters

**Other:**
- `GET /health` - Health check
- `GET /api` - API docs

### CSV Parsing (Core Logic)

**Teams CSV format handling:**
- Detects and decodes UTF-16 LE with BOM (native Teams export format)
- Parses three sections: Summary, Participants, In-Meeting Activities
- Date parsing handles multiple formats: `D/MM/YY AM/PM`, `M/D/YYYY`, ISO
- Duration parsing: converts "Xh Xm Xs" to minutes

**Class code extraction:**
- Regex: `/\b(\d{1,2}[A-Z]{2,}\d?)\b/`
- Extracts codes like "11SENX", "12SENX2" from meeting titles

**Class amalgamation:**
- Base code = strip trailing digits after X: "11SENX2" -> "11SENX"
- Canvas roster query uses `LIKE 'baseCode%'` to fetch all related enrollments
- Deduplicates students by ID across related classes

### Attendance Status Rules

| Status | Condition |
|--------|-----------|
| Present | Joined within 10 min of start AND stayed 30+ min |
| Late | Joined more than 10 min after start |
| Partial | Attended less than 30 min |
| Absent | On Canvas roster but no attendance record (computed at query time) |

### Folder Watcher System

- **Library:** chokidar with 2-second stability threshold
- **Flow:** New CSV detected -> Parse -> Import to DB -> Move file to `processed/` folder with timestamp
- **Duplicate prevention:** Set of processed file paths
- **Fallback:** Cross-device move failures use copy+delete

### Canvas Integration Details

- Filters courses by year: `course_code INCLUDES '_2026'`
- Only syncs online/external classes: code ends with `X` (regex `/X\d?$/`)
- Pagination: 100 items per page
- Upsert enrollments with `ON CONFLICT` + `updated_at` tracking

### Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Environment |
| `PORT` | `3001` | Express port |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `CORS_ORIGIN` | `http://localhost:3000` | Frontend URL |
| `WATCH_ENABLED` | `true` | Auto-start file watcher |
| `WATCH_FOLDER` | `../Attendance_Files` | CSV watch folder |
| `PROCESSED_FOLDER` | `./processed` | Processed CSV folder |
| `CANVAS_API_URL` | optional | Canvas instance URL |
| `CANVAS_API_TOKEN` | optional | Canvas API token |
| `LOG_LEVEL` | `debug` | Winston log level |
| `REACT_APP_API_URL` | `http://localhost:3001/api` | Frontend API URL |

### Security

- **Rate limiting:** 100 requests / 15 minutes per IP
- **Helmet:** Security headers
- **CORS:** Configurable origin
- **Zod:** Request body validation
- **File upload:** 10MB limit, CSV MIME type only
- **Auth:** Disabled (local-only app); Azure AD/MSAL installed but not active

### Database Connection Pool

- Max 20 connections
- 30s idle timeout
- 2s connection timeout
- Query logging in development mode

---

## Shared Concepts & Integration Points

### Canvas LMS (Common to Both)

Both apps connect to the same Canvas LMS instance:
- **Kings Analytics Dashboard:** Full sync of courses, enrollments, assignments, submissions, and computed metrics
- **Teams Attendance Tracker:** Roster sync only (courses + student enrollments for absence detection)

Both use the Canvas REST API with pagination support and API token authentication.

### Class Code Convention

Both apps use the same Kings school class code format:
- Pattern: `{YearLevel}{SubjectCode}{Suffix}` e.g., "11SENX", "12SENX2"
- The `X` suffix indicates online/external classes
- Amalgamation groups related codes (e.g., 11SENX + 11SENX2) for shared meetings

### Student Identity

- **Canvas user ID** is the shared identifier across both systems
- **Email** is used as secondary matching key
- Kings Analytics additionally matches students to Gradeo via email/name normalization

### PostgreSQL

Both use PostgreSQL but with different configurations:
- Kings Analytics: Supabase-managed, async driver (asyncpg), SQLAlchemy ORM
- Teams Attendance: Local PostgreSQL, sync driver (pg), raw SQL queries

---

## Quick Reference Tables

### How to Run Each App Locally

**Kings Analytics Dashboard:**
```bash
# Start all services
cd kings-track-Demo
docker-compose up

# Or individually:
# Backend: cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
# Frontend: cd frontend && npm install && npm run dev
# Extension: cd extension && npm install && npm run build
```

**Teams Attendance Tracker:**
```bash
# Create database
createdb attendance_tracker
# Run migrations
cd teams-attendance-tracker/backend && npm run migrate

# Backend
cd teams-attendance-tracker/backend && npm install && npm run dev

# Frontend
cd teams-attendance-tracker/frontend && npm install && npm start
```

### Port Mapping

| Service | Kings Analytics | Teams Attendance |
|---------|----------------|------------------|
| Frontend | :5173 (Vite) | :3000 (react-scripts) |
| Backend | :8000 (Uvicorn) | :3001 (Express) |
| Database | :5432 (Docker/Supabase) | :5432 (local) |

### Migration Count

| App | Migration Files | Notable Changes |
|-----|----------------|-----------------|
| Kings Analytics | 12 (Alembic) | Initial schema, EdStem tables, Gradeo tables (14 models), reminders, multi-class mappings |
| Teams Attendance | 4 (raw SQL) | Students, meetings, attendance_records, class_code column |

### Frontend Routes

**Kings Analytics:**
| Route | Page | Auth Required |
|-------|------|--------------|
| `/login` | Login | No |
| `/` | Overview (course list) | Yes |
| `/courses/:courseId` | Course detail (tabs) | Yes |
| `/admin` | Admin panel | Yes (admin) |
| `/extension-bridge` | Gradeo bridge | Yes |

**Teams Attendance:**
| Route | Page | Auth Required |
|-------|------|--------------|
| `/` | Dashboard | No |
| `/classes` | Classes | No |
| `/students` | Students | No |
| `/meetings` | Meetings | No |
| `/reports` | Reports | No |
| `/sync` | Sync controls | No |
