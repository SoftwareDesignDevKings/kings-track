# Technical Design - Teams Attendance Tracker

## Overview

A local desktop application that tracks student attendance in Microsoft Teams online classes by importing native Teams attendance CSV exports and cross-referencing with Canvas LMS student rosters.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                Frontend (React)                   │
│  Dashboard, Classes, Students, Meetings, Reports  │
│  Material-UI  |  Recharts  |  Axios              │
└───────────────────────┬──────────────────────────┘
                        │ REST API (localhost:3001)
┌───────────────────────┴──────────────────────────┐
│               Backend (Express/Node.js)           │
│                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Folder      │  │ Teams CSV    │  │ Canvas   │ │
│  │ Watcher     │──│ Parser       │  │ Service  │ │
│  │ (chokidar)  │  │              │  │ (REST)   │ │
│  └─────────────┘  └──────┬───────┘  └────┬─────┘ │
│                          │               │        │
│  ┌───────────────────────┴───────────────┴──────┐ │
│  │            PostgreSQL Database                │ │
│  │  students | meetings | attendance_records     │ │
│  │  canvas_enrollments                           │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
   Teams CSV Files              Canvas LMS API
   (downloaded from              (roster sync)
    meeting chat)
```

## Data Flow

### Attendance Import

1. Teacher downloads attendance CSV from Teams meeting chat
2. File saved to watched folder (e.g., `Attendance_Files/`)
3. `chokidar` file watcher detects the new `.csv` file
4. `TeamsCSVParser` handles the native Teams format:
   - Detects UTF-16 LE encoding with BOM
   - Splits multi-section format (Summary, Participants, etc.)
   - Extracts meeting metadata from Summary section
   - Parses participant rows from Participants section
   - Converts duration format ("Xh Xm Xs") to minutes
5. Class code extracted from meeting title via regex (`/\b(\d{1,2}[A-Z]{2,}\d?)\b/`)
6. Students created/matched by email, meeting created/matched by Teams meeting ID
7. Attendance records inserted with duplicate detection (`ON CONFLICT DO NOTHING`)
8. Processed CSV moved to `processed/` folder

### Canvas Roster Sync

1. Backend fetches courses from Canvas REST API (`/api/v1/courses`)
2. Filtered to: current year, available, teacher enrollment, online/external only (`/X\d?$/`)
3. For each course, fetches active student enrollments with emails
4. Students upserted into `students` table, enrollment links stored in `canvas_enrollments`
5. Class code extracted from Canvas course code (e.g., `11SENX_2026` -> `11SENX`)

### Absence Detection

1. For a meeting with `class_code = "11SENX"`, the base code `"11SENX"` is computed
2. All related Canvas enrollments fetched via `LIKE '11SENX%'` (amalgamation)
3. Combines rosters from 11SENX, 11SENX2, etc. since they share the same meeting
4. Enrolled student IDs compared against attendance records for that meeting
5. Students on roster but not in attendance = absent

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React 18 + TypeScript | UI framework |
| UI Components | Material-UI v7 | Design system |
| Charts | Recharts | Pie charts, data visualization |
| Backend | Express + TypeScript | REST API server |
| File Watching | chokidar | Detect new CSV files |
| CSV Parsing | csv-parse + custom parser | Handle Teams CSV format |
| HTTP Client | axios | Canvas API calls |
| Database | PostgreSQL 14+ | Data storage |
| DB Client | pg (node-postgres) | Database queries |
| Validation | zod | Request validation |
| Logging | winston | Structured logging |

## Database Schema

### students
```sql
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    student_id VARCHAR(50),
    azure_ad_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### meetings
```sql
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teams_meeting_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(500),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    organizer_email VARCHAR(255),
    meeting_url TEXT,
    class_code VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### attendance_records
```sql
CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    join_time TIMESTAMP NOT NULL,
    leave_time TIMESTAMP,
    duration_minutes INTEGER,
    status VARCHAR(50),  -- 'present', 'late', 'partial'
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(meeting_id, student_id, join_time)
);
```

### canvas_enrollments
```sql
CREATE TABLE canvas_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    canvas_course_id INTEGER NOT NULL,
    canvas_user_id INTEGER NOT NULL,
    class_code VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(student_id, canvas_course_id)
);
```

## Attendance Status Rules

| Status | Condition |
|--------|-----------|
| Present | Joined within 10 minutes of meeting start AND stayed 30+ minutes |
| Late | Joined more than 10 minutes after meeting start |
| Partial | Attended less than 30 minutes of the meeting |
| Absent | On Canvas roster but no attendance record (computed at query time) |

## Class Code System

### Extraction

Class codes are extracted from Teams meeting titles using the regex `/\b(\d{1,2}[A-Z]{2,}\d?)\b/`:
- `"Week 3 11SENX Online Class"` -> `11SENX`
- `"12SENX2 Weekly Meeting"` -> `12SENX2`

### Amalgamation

Related classes share the same Teams meeting:
- `11SENX` + `11SENX2` -> same Year 11 meeting
- `12SENX` + `12SENX2` + `12SENX3` -> same Year 12 meeting

The base code is computed by stripping trailing digits after `X`:
- `11SENX2` -> base `11SENX`
- `12SENX3` -> base `12SENX`

Roster queries use `LIKE 'baseCode%'` to fetch all related enrollments.

### Canvas Course Code Format

Canvas courses use the format `{ClassCode}_{Year}`:
- `11SENX_2026` -> class code `11SENX`
- `12SENX2_2026` -> class code `12SENX2`

Only courses matching `/X\d?$/` (ending in X or X+digit) are synced.

## API Routes

### Students (`/api/students`)
- `GET /` - List all students (optional `?class_code=` filter)
- `GET /class-codes` - Individual Canvas class codes with counts
- `GET /search?q=` - Search by name/email/ID
- `GET /:id` - Get student by ID
- `GET /:id/attendance` - Student attendance summary
- `POST /` - Create student
- `PUT /:id` - Update student
- `DELETE /:id` - Delete student

### Meetings (`/api/meetings`)
- `GET /` - List meetings (optional `?class_code=` filter)
- `GET /classes` - Distinct class codes
- `GET /recent?limit=` - Recent meetings
- `GET /:id` - Get meeting by ID
- `GET /:id/attendance` - Meeting attendance summary

### Attendance (`/api/attendance`)
- `GET /` - List attendance records
- `GET /report` - Filtered report
- `POST /import` - Upload CSV
- `GET /export` - Download filtered CSV

### Folder Watcher (`/api/watcher`)
- `GET /status` - Watcher status (running, folder, file count)
- `POST /start` - Start watching
- `POST /stop` - Stop watching
- `PUT /config` - Update watched folder
- `GET /history` - Import history

### Canvas (`/api/canvas`)
- `GET /status` - Canvas config + amalgamated class counts
- `GET /courses` - Available Canvas courses
- `POST /sync` - Sync single course roster
- `POST /sync-all` - Sync all online course rosters
- `GET /roster/:classCode` - Get class roster
- `GET /attendance/:meetingId` - Attendance with absence detection

## Teams CSV Format

Teams exports attendance as a multi-section, tab-separated file with UTF-16 LE encoding:

```
1. Summary
Meeting Title	Week 3 11SENX Online Class
Start Time	5/04/2026, 4:21:32 PM
End Time	5/04/2026, 5:10:00 PM
Meeting Id	abc123

2. Participants
Full Name	First Join	Last Leave	In-Meeting Duration	Email	Role	Participant ID (UPN)
John Smith	5/04/2026, 4:22:00 PM	5/04/2026, 5:09:00 PM	0h 47m 0s	john@school.edu	Attendee	...

3. In-Meeting Activities
...
```

The parser handles:
- BOM detection and UTF-16 LE decoding
- Section splitting by numbered headers
- Australian date format (D/MM/YY or D/MM/YYYY)
- Duration parsing ("Xh Xm Xs" -> minutes)
- Tab-separated values

## Project Files

### Backend Services
| File | Purpose |
|------|---------|
| `teams-csv-parser.service.ts` | Parse native Teams CSV, extract class codes, import data |
| `folder-watcher.service.ts` | Watch folder for new CSVs, trigger auto-import |
| `canvas.service.ts` | Canvas API integration, roster sync, class amalgamation |
| `csv-import.service.ts` | Generic CSV import (manual upload) |
| `attendance.service.ts` | Attendance calculations and summaries |

### Frontend Pages
| File | Purpose |
|------|---------|
| `Dashboard.tsx` | Stats cards, attendance pie chart, recent meetings |
| `Classes.tsx` | Per-class attendance with expandable meetings and absence lists |
| `Students.tsx` | Student list with class filter tabs |
| `Meetings.tsx` | Meeting list with class filter |
| `Reports.tsx` | Filtered attendance reports with CSV export |
| `SyncPage.tsx` | Folder watcher controls, Canvas sync, manual upload |
