# Kings Analytics Dashboard

A Canvas LMS analytics platform that gives teachers real-time visibility into student progress, assignment submissions, and course performance across Kings school.

## Features

- **Course overview** with summary statistics (completion rates, on-time submission, average scores)
- **Student activity matrix** showing per-student submission status and grades
- **Background sync** pulls data from Canvas on a configurable schedule
- **Admin dashboard** for managing users and controlling which courses are visible
- **Pluggable integrations** for third-party platforms (Gradeo, EdStem)

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, TanStack Query |
| Backend | FastAPI (async), SQLAlchemy 2.0, Alembic |
| Database | PostgreSQL 16 |
| Auth | Supabase JWT (production) / bypass mode (local dev) |
| Hosting | Vercel (frontend), Render (backend), Supabase (database) |
| CI | GitHub Actions |

## Quick start (local)

**Prerequisites:** Docker Desktop

```bash
python run_local.py
```

This prompts for your Canvas credentials, writes `.env`, starts Docker Compose, runs migrations, and opens the app.

**Or manually:**

```bash
cp .env.example .env        # fill in values
docker compose up -d db
docker compose run --rm backend alembic upgrade head
docker compose up backend frontend
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000/api`
- Swagger docs: `http://localhost:8000/docs`

### Without Docker

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Environment variables

### Backend

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string (must use `postgresql+asyncpg://`) | `postgresql+asyncpg://kings:kings@db:5432/kings_analytics` |
| `CANVAS_API_URL` | Canvas instance URL | `https://kings.instructure.com` |
| `CANVAS_API_TOKEN` | Canvas API access token | |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173` |
| `AUTH_MODE` | `local` or `supabase` | `local` |
| `SUPABASE_URL` | Supabase project URL (when `AUTH_MODE=supabase`) | `https://xxx.supabase.co` |
| `LOCAL_DEV_USER_EMAIL` | Dev user email (when `AUTH_MODE=local`) | `admin@local.dev` |
| `LOCAL_DEV_USER_ROLE` | Dev user role (when `AUTH_MODE=local`) | `admin` |
| `SYNC_INTERVAL_HOURS` | Background sync interval | `24` |

### Frontend

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API URL | `/api` (dev) or `https://your-app.onrender.com/api` (prod) |

See `.env.example` for defaults.

## Testing

```bash
# Backend
cd backend && pytest

# Frontend
cd frontend && npm test
```

CI runs both suites on every PR and push to `main`.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/auth/me` | Current user |
| `GET` | `/api/courses` | List courses with stats |
| `GET` | `/api/courses/:id` | Course detail |
| `GET` | `/api/courses/:id/matrix` | Student activity matrix |
| `GET` | `/api/sync/status` | Latest sync status |
| `POST` | `/api/sync/trigger` | Trigger manual sync |
| `GET` | `/admin/users` | List app users |
| `POST` | `/admin/users` | Add user |
| `DELETE` | `/admin/users/:email` | Remove user |
| `GET` | `/admin/whitelist` | List whitelisted courses |
| `POST` | `/admin/whitelist` | Add course to whitelist |
| `DELETE` | `/admin/whitelist/:id` | Remove from whitelist |

## Database migrations

```bash
cd backend
alembic upgrade head          # apply all
alembic downgrade -1          # rollback one
alembic revision -m "desc"   # create new
```

Migrations run automatically on deploy (the Dockerfile runs `alembic upgrade head` before starting the server).

## Deployment

Both services auto-deploy from `main` via their respective platform integrations.

### Backend (Render)

Render reads `render.yaml` and deploys the Docker image from `backend/`. Set the environment variables listed above in the Render dashboard. Health check endpoint: `/api/health`.

### Frontend (Vercel)

Vercel reads `vercel.json`, builds the Vite SPA from `frontend/`, and serves it with SPA rewrites. Set `VITE_API_BASE_URL` in Vercel project settings.

### Database (Supabase)

Create a Supabase project and use its Postgres connection string as `DATABASE_URL`. Keep the `postgresql+asyncpg://` prefix and `?ssl=require` suffix. Alembic handles all schema management — no Supabase migrations needed.

## Project structure

```
├── backend/
│   ├── app/
│   │   ├── api/routes/       # FastAPI route handlers
│   │   ├── canvas/           # Canvas API client
│   │   ├── integrations/     # Third-party platform plugins
│   │   ├── models/           # SQLAlchemy models
│   │   └── sync/             # Background sync engine
│   ├── alembic/              # Database migrations
│   └── tests/
├── frontend/
│   └── src/
│       ├── components/       # React components
│       ├── pages/            # Route pages
│       └── services/         # API client & hooks
├── docker-compose.yml        # Local dev environment
├── render.yaml               # Render deployment config
└── vercel.json               # Vercel deployment config
```
