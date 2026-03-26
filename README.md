# kings-track

This repo is already split the right way for your target stack:

- `frontend/` -> Vercel
- `backend/` -> Render
- Postgres -> Supabase

The clean deployment pattern is:

1. Vercel stays connected directly to GitHub and auto-deploys the frontend on pushes to `main`.
2. Render stays connected directly to GitHub and auto-deploys the backend on pushes to `main`.
3. Supabase hosts the database, while Alembic migrations continue to run from the backend release step.

## What is already wired up in this repo

- [vercel.json](/Users/hamillmamo_li/kings-track/app/vercel.json) builds the Vite frontend as a single-page app for Vercel.
- [render.yaml](/Users/hamillmamo_li/kings-track/app/render.yaml) defines a Render web service that deploys the backend Docker image from GitHub.
- [.github/workflows/ci.yml](/Users/hamillmamo_li/kings-track/app/.github/workflows/ci.yml) runs frontend and backend checks on PRs and `main`.
- [frontend/src/services/api.ts](/Users/hamillmamo_li/kings-track/app/frontend/src/services/api.ts) supports `VITE_API_BASE_URL`, which should point at your Render backend in production.
- [backend/Dockerfile](/Users/hamillmamo_li/kings-track/app/backend/Dockerfile) now starts Uvicorn on the platform-provided `PORT`, which Render expects.

## 1. Supabase setup

Create a new Supabase project, then copy its Postgres connection string.

Use that connection string as `DATABASE_URL` for the backend. For this app it should look like:

```env
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:5432/postgres?ssl=require
```

Notes:

- Keep the `postgresql+asyncpg://` prefix because the backend uses SQLAlchemy async mode.
- Keep SSL enabled.
- You do not need to move schema management into Supabase. Alembic already handles it from the backend deploy.

## 2. Render backend setup

### First-time setup

1. In Render, create a new `Web Service` from this GitHub repo.
2. Let Render use [render.yaml](/Users/hamillmamo_li/kings-track/app/render.yaml), or mirror its settings manually:
   service type `web`, runtime `docker`, branch `main`, health check `/api/health`.
3. In Render, set these environment variables:

```env
CANVAS_API_URL=https://kings.instructure.com
CANVAS_API_TOKEN=your-token
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:5432/postgres?ssl=require
CORS_ORIGINS=https://your-vercel-app.vercel.app
SYNC_INTERVAL_HOURS=24
CANVAS_COURSE_WHITELIST=
```

4. Trigger the first deploy. The backend container already runs `alembic upgrade head` before starting Uvicorn, so your schema will migrate during deploy.

### GitHub auto-deploy

Once the Render service is linked to GitHub with Auto-Deploy enabled, pushes to `main` will deploy the backend automatically. No GitHub Actions secret is needed for backend deployment anymore.

## 3. Vercel frontend setup

In Vercel:

1. Import this GitHub repo.
2. Set the Root Directory to `.`.
3. Vercel will read [vercel.json](/Users/hamillmamo_li/kings-track/app/vercel.json), so the build/install/output settings are already defined.
4. Add `VITE_API_BASE_URL=https://your-render-service.onrender.com/api`.

Once the repo is connected, Vercel will auto-deploy on every push to `main` by default.

Why this changed:

- The frontend no longer relies on a hardcoded Fly rewrite.
- Vercel serves the SPA.
- The browser calls the Render API URL directly.
- CORS must include your Vercel frontend origin on the backend.

## 4. Production values to set

Use these values as your production baseline:

```env
CANVAS_API_URL=https://kings.instructure.com
CANVAS_API_TOKEN=...
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST:5432/postgres?ssl=require
CORS_ORIGINS=https://your-vercel-app.vercel.app
VITE_API_BASE_URL=https://your-render-service.onrender.com/api
SYNC_INTERVAL_HOURS=24
CANVAS_COURSE_WHITELIST=
```

Set them in:

- Render for backend runtime variables
- Vercel for `VITE_API_BASE_URL`

## 5. How updates flow

- Push to `main`
- GitHub Actions runs CI
- Render detects the same GitHub push and deploys the backend
- Vercel detects the same GitHub push and deploys the frontend
- Frontend calls backend through `VITE_API_BASE_URL`
- Backend talks to Supabase through `DATABASE_URL`

## 6. Local vs production

Local development can keep using the root `.env` and `docker-compose.yml`.

Production should use:

- Render environment variables for backend runtime config
- Vercel project settings for frontend env vars
- Supabase only as the managed Postgres host
