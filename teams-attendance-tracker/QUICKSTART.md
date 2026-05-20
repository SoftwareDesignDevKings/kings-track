# Quick Start Guide

Get the Teams Attendance Tracker running in 3 steps.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (running)

## Step 1: Database

```bash
createdb attendance_tracker

cd database
psql attendance_tracker < migrations/001_create_students.sql
psql attendance_tracker < migrations/002_create_meetings.sql
psql attendance_tracker < migrations/003_create_attendance.sql

# Canvas roster table (optional)
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
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS class_code VARCHAR(50);
"
```

## Step 2: Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and optional Canvas credentials
npm run dev
```

## Step 3: Frontend

```bash
cd frontend
npm install
npm start
```

App opens at `http://localhost:3000`.

## Import Attendance

1. After a Teams meeting, download the attendance CSV from the meeting chat
2. Save it to the `Attendance_Files/` folder
3. The app auto-imports it and shows the data on the dashboard

## Canvas Roster Sync (Optional)

1. Add your Canvas URL and API token to `backend/.env`
2. Go to **Sync Data** > **Sync All Class Rosters**
3. View class attendance with absent students on the **Classes** page

## Troubleshooting

- **Database error**: Check PostgreSQL is running (`pg_isready`) and `DATABASE_URL` is correct
- **Port in use**: `lsof -ti:3001 | xargs kill -9`
- **CSV not importing**: Check the backend logs and verify the watched folder path

See [docs/SETUP.md](docs/SETUP.md) for the full setup guide.
