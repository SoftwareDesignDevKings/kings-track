# Microsoft Teams Attendance Tracker

A local desktop application for tracking student attendance in Microsoft Teams online classes. Automatically imports attendance data from Teams CSV exports and cross-references with Canvas LMS rosters to identify absent students.

## How It Works

```
Teams meeting ends
       |
       v
Download attendance CSV from Teams chat (2 clicks)
       |
       v
CSV lands in watched folder (e.g., Downloads)
       |
       v
App auto-imports attendance data
       |
       v
Canvas roster cross-referenced to detect absences
       |
       v
Dashboard shows attendance + absentees per class
```

No Azure AD app registration, no cloud deployment, no Power Automate required. Everything runs locally on your machine.

## Features

- **Auto-import**: Folder watcher detects new Teams attendance CSVs and imports them automatically
- **Manual import**: Upload CSV files directly through the web interface
- **Canvas integration**: Syncs student rosters from Canvas LMS to identify absent students
- **Class grouping**: Auto-extracts class codes from meeting titles (e.g., `11SENX`, `12SENX2`)
- **Class amalgamation**: Groups related classes that share the same meeting (e.g., 11SENX + 11SENX2)
- **Absence detection**: Cross-references Canvas roster against attendance records
- **Dashboard**: Pie chart of attendance distribution, stat cards, recent meetings
- **Students page**: Filter students by individual Canvas class via tabs
- **Classes page**: View per-class attendance with expandable meeting details
- **Reports**: Filter and export attendance data to CSV
- **Duplicate detection**: Safely re-import the same CSV without creating duplicates

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Material-UI v7, Recharts |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 14+ |
| File Watching | chokidar |
| Canvas API | REST API with token auth |
| CSV Parsing | csv-parse (handles native Teams UTF-16 LE format) |

## Project Structure

```
attendance-tracker/
├── frontend/                # React frontend
│   └── src/
│       ├── pages/           # Dashboard, Students, Meetings, Classes, Reports, SyncPage
│       ├── services/api.ts  # API client
│       └── types/           # TypeScript interfaces
│
├── backend/                 # Express API server
│   └── src/
│       ├── controllers/     # Request handlers (students, meetings, attendance, canvas, watcher)
│       ├── services/        # Business logic
│       │   ├── teams-csv-parser.service.ts   # Parses native Teams attendance CSVs
│       │   ├── folder-watcher.service.ts     # Watches folder for new CSVs
│       │   ├── canvas.service.ts             # Canvas LMS API integration
│       │   └── attendance.service.ts         # Attendance calculations
│       ├── models/          # Database models (Student, Meeting, AttendanceRecord)
│       ├── routes/          # API route definitions
│       ├── middleware/      # Error handling, auth
│       └── config/          # Database, logger, auth config
│
├── database/                # SQL migration scripts
│   └── migrations/
│
├── Attendance_Files/        # Default folder for Teams CSV imports
│
└── docs/                    # Documentation
    └── SETUP.md             # Detailed setup guide
```

## Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 14+
- **Canvas LMS** access token (optional, for roster sync)

## Quick Start

### 1. Database

```bash
createdb attendance_tracker

cd database
psql attendance_tracker < migrations/001_create_students.sql
psql attendance_tracker < migrations/002_create_meetings.sql
psql attendance_tracker < migrations/003_create_attendance.sql
```

You also need the `canvas_enrollments` table (if using Canvas integration):

```sql
psql attendance_tracker -c "
CREATE TABLE IF NOT EXISTS canvas_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  canvas_course_id INTEGER NOT NULL,
  canvas_user_id INTEGER NOT NULL,
  class_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, canvas_course_id)
);
"
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your database URL and Canvas credentials
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm start
```

The app opens at `http://localhost:3000`, API at `http://localhost:3001`.

## Configuration

### Backend `.env`

```env
# Server
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/attendance_tracker

# Application
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug

# Folder Watcher (auto-import Teams attendance CSVs)
WATCH_ENABLED=true
WATCH_FOLDER=../Attendance_Files
PROCESSED_FOLDER=./processed

# Canvas LMS Integration (optional)
CANVAS_API_URL=https://your-school.instructure.com
CANVAS_API_TOKEN=your-canvas-api-token
```

## Usage

### Importing Attendance

1. After a Teams meeting ends, open the meeting chat
2. Click the **Attendance** tab, then **Download**
3. Save the CSV to your watched folder (default: `Attendance_Files/`)
4. The app auto-imports it and the data appears in the dashboard

Or use **Sync Data > Manual CSV Upload** to upload directly.

### Canvas Roster Sync

1. Go to **Sync Data** and click **Sync All Class Rosters**
2. The app pulls enrolled students from Canvas for all online/external classes
3. Go to **Classes** to see attendance with absent students highlighted

### Class Code System

Class codes are automatically extracted from Teams meeting titles using the pattern `[YearLevel][SubjectCode][ClassNumber]`:
- `11SENX` - Year 11 Science External
- `12SENX2` - Year 12 Science External, class 2

Related classes (e.g., 11SENX + 11SENX2) are **amalgamated** when checking attendance because they join the same Teams meeting.

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Overview stats, attendance pie chart, recent meetings |
| **Classes** | Per-class attendance with Canvas roster cross-reference |
| **Students** | Student list with class filter tabs |
| **Meetings** | All meetings with class filter |
| **Reports** | Filtered attendance reports with CSV export |
| **Sync Data** | Folder watcher status, Canvas sync, manual CSV upload |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/students` | List students (optional `?class_code=` filter) |
| GET | `/api/students/class-codes` | Individual Canvas class codes |
| GET | `/api/meetings` | List meetings (optional `?class_code=` filter) |
| GET | `/api/meetings/classes` | Distinct class codes from meetings |
| GET | `/api/attendance` | Attendance records |
| POST | `/api/attendance/import` | Manual CSV upload |
| GET | `/api/attendance/export` | Export filtered attendance as CSV |
| GET | `/api/watcher/status` | Folder watcher status |
| POST | `/api/watcher/start` | Start folder watcher |
| POST | `/api/watcher/stop` | Stop folder watcher |
| GET | `/api/canvas/status` | Canvas sync status (amalgamated classes) |
| POST | `/api/canvas/sync-all` | Sync all Canvas rosters |
| GET | `/api/canvas/attendance/:meetingId` | Attendance with absence detection |

## Scripts

### Backend
- `npm run dev` - Start with hot reload
- `npm run build` - Compile TypeScript
- `npm start` - Start production server

### Frontend
- `npm start` - Start development server
- `npm run build` - Build for production

## Security Notes

- Never commit `.env` files to git
- Canvas API tokens should be kept secure
- The app runs locally only (no cloud deployment)
- All data stays on your machine

## License

MIT
