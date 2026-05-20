# Setup Guide - Teams Attendance Tracker

Step-by-step guide to get the Teams Attendance Tracker running on your machine.

## Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **PostgreSQL** 14+ ([Download](https://www.postgresql.org/download/))

Optional (for roster sync):
- **Canvas LMS** API access token from your school's Canvas instance

## Step 1: Database Setup

### 1.1 Create the Database

```bash
createdb attendance_tracker
```

Or using psql:
```bash
psql -U your_username
CREATE DATABASE attendance_tracker;
\q
```

### 1.2 Run Migrations

```bash
cd database

psql attendance_tracker < migrations/001_create_students.sql
psql attendance_tracker < migrations/002_create_meetings.sql
psql attendance_tracker < migrations/003_create_attendance.sql
```

### 1.3 Create Canvas Enrollments Table

If you plan to use Canvas integration for roster sync:

```bash
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

### 1.4 Add class_code Column to Meetings

```bash
psql attendance_tracker -c "
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS class_code VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_meetings_class_code ON meetings(class_code);
"
```

### 1.5 Verify Tables

```bash
psql attendance_tracker -c "\dt"
```

You should see: `students`, `meetings`, `attendance_records`, `canvas_enrollments`.

## Step 2: Backend Setup

### 2.1 Install Dependencies

```bash
cd backend
npm install
```

### 2.2 Configure Environment

```bash
cp .env.example .env
```

Edit `backend/.env`:

```env
# Server
NODE_ENV=development
PORT=3001

# Database (update with your credentials)
DATABASE_URL=postgresql://your_username:your_password@localhost:5432/attendance_tracker

# Application
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug

# Folder Watcher - watches for new Teams attendance CSVs
WATCH_ENABLED=true
WATCH_FOLDER=../Attendance_Files
PROCESSED_FOLDER=./processed

# Canvas LMS Integration (optional - remove if not using Canvas)
CANVAS_API_URL=https://your-school.instructure.com
CANVAS_API_TOKEN=your-canvas-api-token-here
```

### 2.3 Create the Watch Folder

```bash
mkdir -p ../Attendance_Files
```

### 2.4 Start the Backend

```bash
npm run dev
```

You should see:
```
Server running on port 3001
Folder watcher active. Watching: ../Attendance_Files
```

## Step 3: Frontend Setup

### 3.1 Install Dependencies

```bash
cd frontend
npm install
```

### 3.2 Start the Frontend

```bash
npm start
```

The app opens at `http://localhost:3000`.

## Step 4: Canvas Integration (Optional)

If your school uses Canvas LMS, you can sync student rosters to detect absent students.

### 4.1 Get a Canvas API Token

1. Log in to your Canvas instance
2. Go to **Account** > **Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Give it a description (e.g., "Attendance Tracker")
6. Click **Generate Token**
7. Copy the token and add it to `backend/.env` as `CANVAS_API_TOKEN`

### 4.2 Configure Canvas URL

Set `CANVAS_API_URL` in `backend/.env` to your school's Canvas URL (e.g., `https://canvas.yourschool.edu.au`).

### 4.3 Sync Rosters

1. Open the app at `http://localhost:3000`
2. Go to **Sync Data**
3. Click **Sync All Class Rosters**
4. The app pulls enrolled students from all your online/external classes

### 4.4 How Class Filtering Works

The app filters Canvas courses to only sync **online/external classes** (class codes ending in `X`, e.g., `11SENX`, `12SENX2`). This is controlled by the regex filter in `canvas.service.ts`.

Canvas course codes must follow the format `{ClassCode}_{Year}` (e.g., `11SENX_2026`).

## Step 5: Import Your First Attendance Data

### Option A: Auto-Import (Recommended)

1. After a Teams meeting ends, open the meeting chat
2. Click the **Attendance** tab
3. Click **Download** to save the CSV
4. Move or save the file to your watched folder (`Attendance_Files/`)
5. The app detects and imports it automatically
6. Check the **Dashboard** to see the data

### Option B: Manual Upload

1. Go to **Sync Data** in the sidebar
2. Under **Manual CSV Upload**, click **Choose File**
3. Select your Teams attendance CSV
4. Click **Upload**

## Troubleshooting

### Database connection error

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

- Ensure PostgreSQL is running: `pg_isready`
- Check your `DATABASE_URL` in `backend/.env`
- Verify the database exists: `psql -l | grep attendance_tracker`

### Folder watcher not detecting files

- Check that `WATCH_FOLDER` in `.env` points to the correct path
- The path is relative to the `backend/` directory
- Verify the folder exists
- Check the backend logs for watcher status

### Canvas sync fails

- Verify `CANVAS_API_URL` doesn't have a trailing slash
- Check that your API token is valid and hasn't expired
- Ensure you have teacher enrollment in Canvas courses
- Check backend logs for specific error messages

### Port already in use

```bash
lsof -ti:3001 | xargs kill -9
```

### Teams CSV not importing correctly

The app handles the native Teams attendance CSV format:
- UTF-16 LE encoded (with BOM)
- Tab-separated (despite the .csv extension)
- Multi-section format (Summary, Participants, In-Meeting Activities)

If your CSV has a different format, check `backend/src/services/teams-csv-parser.service.ts`.

## Useful Commands

```bash
# Backend
cd backend
npm run dev          # Start with hot reload
npm run build        # Compile TypeScript
npm start            # Start production server

# Frontend
cd frontend
npm start            # Start development server
npm run build        # Build for production

# Database
psql attendance_tracker
psql attendance_tracker -c "SELECT COUNT(*) FROM students;"
psql attendance_tracker -c "SELECT class_code, COUNT(*) FROM canvas_enrollments GROUP BY class_code;"
```

## Security Notes

- Never commit your `.env` file to git
- Keep your Canvas API token secure
- The app runs locally only
- All data stays on your machine
