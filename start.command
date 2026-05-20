#!/bin/bash
#
# Kings Analytics - Local Start Script
# Double-click this file (macOS) or run ./start.command to launch the app.
#

# Move to the project directory (where this script lives)
cd "$(dirname "$0")"

PROJECT_DIR="kings-track-Demo"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "ERROR: Could not find $PROJECT_DIR directory."
    echo "Make sure this script is in the same folder as the $PROJECT_DIR directory."
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}       Kings Analytics${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ----------------------------
# Check prerequisites
# ----------------------------

MISSING=0

# Check Python
if command -v python3 &> /dev/null; then
    PY=python3
elif command -v python &> /dev/null; then
    PY=python
else
    echo -e "${RED}ERROR: Python is not installed.${NC}"
    echo "Please install Python 3.11+ from https://www.python.org/downloads/"
    MISSING=1
fi

if [ $MISSING -eq 0 ]; then
    PY_VERSION=$($PY --version 2>&1 | awk '{print $2}')
    PY_MAJOR=$($PY -c 'import sys; print(sys.version_info.major)')
    PY_MINOR=$($PY -c 'import sys; print(sys.version_info.minor)')
    if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 11 ]); then
        echo -e "${RED}ERROR: Python 3.11+ required. You have $PY_VERSION${NC}"
        echo "Please update from https://www.python.org/downloads/"
        MISSING=1
    else
        echo -e "${GREEN}✓${NC} Python $PY_VERSION detected"
    fi
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed.${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org"
    MISSING=1
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}ERROR: Node.js 18+ required. You have $(node -v)${NC}"
        echo "Please update from https://nodejs.org"
        MISSING=1
    else
        echo -e "${GREEN}✓${NC} Node.js $(node -v) detected"
    fi
fi

if [ $MISSING -ne 0 ]; then
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

# ----------------------------
# Database — Docker or local
# ----------------------------

echo ""
echo -e "${BLUE}--- Database ---${NC}"

DB_READY=0

# Try Docker first (docker-compose.yml is inside the project dir)
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker detected"

    # Check if our postgres container is already running
    if docker compose -f "$PROJECT_DIR/docker-compose.yml" ps db 2>/dev/null | grep -q "running"; then
        echo -e "${GREEN}✓${NC} PostgreSQL container already running"
        DB_READY=1
    else
        echo "Starting PostgreSQL via Docker Compose..."
        docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d db 2>&1
        if [ $? -eq 0 ]; then
            # Wait for it to be healthy
            echo -n "Waiting for PostgreSQL..."
            for i in {1..30}; do
                if docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T db pg_isready -U kings -d kings_analytics &> /dev/null; then
                    echo -e " ${GREEN}ready!${NC}"
                    DB_READY=1
                    break
                fi
                echo -n "."
                sleep 1
            done
            if [ $DB_READY -eq 0 ]; then
                echo -e " ${YELLOW}still starting — will retry${NC}"
                DB_READY=1  # Let it proceed, alembic will wait
            fi
        else
            echo -e "${YELLOW}Docker Compose failed — falling back to local PostgreSQL${NC}"
        fi
    fi
fi

if [ $DB_READY -eq 0 ]; then
    # Check local PostgreSQL
    if command -v psql &> /dev/null; then
        echo -e "${GREEN}✓${NC} Local PostgreSQL CLI available"

        # Figure out which user can connect (try common defaults)
        PG_ADMIN=""
        for try_user in "$(whoami)" "postgres"; do
            if psql -U "$try_user" -d postgres -c "SELECT 1" &> /dev/null; then
                PG_ADMIN="$try_user"
                break
            fi
        done

        if [ -n "$PG_ADMIN" ]; then
            # Create role 'kings' if it doesn't exist
            if ! psql -U "$PG_ADMIN" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='kings'" 2>/dev/null | grep -q 1; then
                echo "Creating PostgreSQL role 'kings'..."
                psql -U "$PG_ADMIN" -d postgres -c "CREATE ROLE kings WITH LOGIN PASSWORD 'kings' CREATEDB;" 2>&1
                echo -e "${GREEN}✓${NC} Role 'kings' created"
            else
                echo -e "${GREEN}✓${NC} Role 'kings' exists"
            fi

            # Create database 'kings_analytics' if it doesn't exist
            if ! psql -U "$PG_ADMIN" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='kings_analytics'" 2>/dev/null | grep -q 1; then
                echo "Creating database 'kings_analytics'..."
                psql -U "$PG_ADMIN" -d postgres -c "CREATE DATABASE kings_analytics OWNER kings;" 2>&1
                echo -e "${GREEN}✓${NC} Database 'kings_analytics' created"
            else
                echo -e "${GREEN}✓${NC} Database 'kings_analytics' exists"
            fi
        else
            echo -e "${YELLOW}  Could not auto-detect PostgreSQL admin user.${NC}"
            echo -e "${YELLOW}  Make sure the 'kings' role and 'kings_analytics' database exist.${NC}"
        fi

        DB_READY=1
    else
        echo -e "${RED}ERROR: No Docker or PostgreSQL found.${NC}"
        echo ""
        echo "Option 1: Install Docker Desktop from https://www.docker.com/products/docker-desktop"
        echo "Option 2: Install PostgreSQL from https://www.postgresql.org/download/"
        echo ""
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
fi

# ----------------------------
# Environment file
# ----------------------------

echo ""
echo -e "${BLUE}--- Environment ---${NC}"

# Create .env inside the project dir if missing
if [ ! -f "$PROJECT_DIR/.env" ]; then
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        echo "Creating .env from .env.example..."
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"

        # For local (non-Docker) runs, update the DATABASE_URL host from 'db' to 'localhost'
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' 's|@db:|@localhost:|g' "$PROJECT_DIR/.env"
        else
            sed -i 's|@db:|@localhost:|g' "$PROJECT_DIR/.env"
        fi

        echo -e "${GREEN}✓${NC} .env created (AUTH_MODE=local, DATABASE_URL points to localhost)"
        echo -e "${YELLOW}  Edit $PROJECT_DIR/.env to add your CANVAS_API_TOKEN for full functionality.${NC}"
    else
        echo -e "${YELLOW}No .env.example found — creating minimal .env...${NC}"
        cat > "$PROJECT_DIR/.env" <<'ENVEOF'
DATABASE_URL=postgresql+asyncpg://kings:kings@localhost:5432/kings_analytics
AUTH_MODE=local
LOCAL_DEV_USER_EMAIL=admin@local.dev
LOCAL_DEV_USER_ROLE=admin
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
CANVAS_API_URL=https://kings.instructure.com
CANVAS_API_TOKEN=
ENVEOF
        echo -e "${GREEN}✓${NC} Minimal .env created"
    fi
else
    echo -e "${GREEN}✓${NC} .env already exists"
fi

# ----------------------------
# Backend setup
# ----------------------------

echo ""
echo -e "${BLUE}--- Backend Setup ---${NC}"

cd "$PROJECT_DIR/backend"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    $PY -m venv venv
    if [ $? -ne 0 ]; then
        echo -e "${RED}ERROR: Failed to create virtual environment${NC}"
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Virtual environment created"
else
    echo -e "${GREEN}✓${NC} Virtual environment exists"
fi

# Activate venv
source venv/bin/activate

# Install/update dependencies
echo "Installing backend dependencies..."
pip install -q -r requirements.txt 2>&1 | tail -3
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to install backend dependencies${NC}"
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi
echo -e "${GREEN}✓${NC} Backend dependencies installed"

# Load env vars for alembic/uvicorn
set -a
source ../.env 2>/dev/null
set +a

# If DATABASE_URL still points to 'db' (docker hostname), fix it for local run
if [[ "$DATABASE_URL" == *"@db:"* ]]; then
    export DATABASE_URL="${DATABASE_URL/@db:/@localhost:}"
fi

# Run database migrations
echo "Running database migrations..."
alembic upgrade head 2>&1
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠  Migration failed — the database may not be ready yet.${NC}"
    echo -e "${YELLOW}  Check that PostgreSQL is running and DATABASE_URL in .env is correct.${NC}"
    echo ""
    echo "Press any key to continue anyway, or Ctrl+C to exit..."
    read -n 1
else
    echo -e "${GREEN}✓${NC} Database migrations applied"
fi

cd ../..

# ----------------------------
# Frontend setup
# ----------------------------

echo ""
echo -e "${BLUE}--- Frontend Setup ---${NC}"

cd "$PROJECT_DIR/frontend"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}ERROR: Failed to install frontend dependencies${NC}"
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Frontend dependencies installed"
else
    echo -e "${GREEN}✓${NC} Frontend dependencies already installed"
fi

cd ../..

# ----------------------------
# Start services
# ----------------------------

echo ""
echo -e "${BLUE}--- Starting Services ---${NC}"
echo ""

# Load env vars again for backend process
set -a
source "$PROJECT_DIR/.env" 2>/dev/null
set +a

if [[ "$DATABASE_URL" == *"@db:"* ]]; then
    export DATABASE_URL="${DATABASE_URL/@db:/@localhost:}"
fi

# Export Vite env vars for frontend
export VITE_AUTH_MODE="${AUTH_MODE:-local}"
export VITE_LOCAL_DEV_USER_EMAIL="${LOCAL_DEV_USER_EMAIL:-admin@local.dev}"
export VITE_LOCAL_DEV_USER_ROLE="${LOCAL_DEV_USER_ROLE:-admin}"

# Start backend in background (using venv python)
echo "Starting backend server on port 8000..."
cd "$PROJECT_DIR/backend"
source venv/bin/activate
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!
cd ../..

# Wait for backend to be ready
echo -n "Waiting for backend..."
for i in {1..30}; do
    if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

if ! curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo -e " ${YELLOW}backend may still be starting${NC}"
fi

# Start frontend in background
echo "Starting frontend on port 5173..."
cd "$PROJECT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
cd ../..

# Wait for frontend to be ready
echo -n "Waiting for frontend..."
for i in {1..20}; do
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# ----------------------------
# Ready!
# ----------------------------

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Kings Analytics is running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Frontend:  ${CYAN}http://localhost:5173${NC}"
echo -e "  Backend:   ${CYAN}http://localhost:8000/api${NC}"
echo -e "  API docs:  ${CYAN}http://localhost:8000/docs${NC}"
echo ""
echo -e "  Auth mode: ${CYAN}${AUTH_MODE:-local}${NC}"
echo ""
echo -e "${YELLOW}  Press Ctrl+C to stop all services.${NC}"
echo ""

# Open browser
sleep 1
open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null

# Trap Ctrl+C to clean up
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    # Kill any child processes
    pkill -P $BACKEND_PID 2>/dev/null
    pkill -P $FRONTEND_PID 2>/dev/null
    # Stop Docker DB if we started it
    if command -v docker &> /dev/null && docker info &> /dev/null; then
        echo "Stopping database container..."
        docker compose -f "$PROJECT_DIR/docker-compose.yml" stop db 2>/dev/null
    fi
    echo -e "${GREEN}Done. Goodbye!${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep script running until Ctrl+C
wait
