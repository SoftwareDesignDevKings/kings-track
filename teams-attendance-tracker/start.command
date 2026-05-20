#!/bin/bash
#
# Teams Attendance Tracker - Start Script
# Double-click this file to launch the app.
#

# Move to the project directory (where this script lives)
cd "$(dirname "$0")"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Teams Attendance Tracker${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ----------------------------
# Check prerequisites
# ----------------------------

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed.${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org"
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}ERROR: Node.js 18+ required. You have $(node -v)${NC}"
    echo "Please update from https://nodejs.org"
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v) detected"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}WARNING: PostgreSQL CLI not found in PATH.${NC}"
    echo "  Make sure PostgreSQL is running and DATABASE_URL is set in backend/.env"
else
    echo -e "${GREEN}✓${NC} PostgreSQL CLI available"
fi

# ----------------------------
# Backend setup
# ----------------------------

echo ""
echo -e "${BLUE}--- Backend Setup ---${NC}"

cd backend

# Check if .env exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}No .env file found. Creating from .env.example...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}⚠  Please edit backend/.env with your DATABASE_URL before first use.${NC}"
    else
        echo -e "${RED}ERROR: No .env or .env.example found in backend/${NC}"
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}ERROR: Failed to install backend dependencies${NC}"
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Backend dependencies installed"
else
    echo -e "${GREEN}✓${NC} Backend dependencies already installed"
fi

# Build TypeScript
echo "Building backend..."
npm run build 2>&1 | tail -1
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Backend build failed${NC}"
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi
echo -e "${GREEN}✓${NC} Backend built"

# Run database migrations
echo "Running database migrations..."
source .env 2>/dev/null

if [ -n "$DATABASE_URL" ]; then
    for migration in ../database/migrations/*.sql; do
        psql "$DATABASE_URL" -f "$migration" 2>/dev/null
    done
    echo -e "${GREEN}✓${NC} Database migrations applied"
else
    echo -e "${YELLOW}⚠  DATABASE_URL not set — skipping migrations${NC}"
    echo "  Edit backend/.env and set your DATABASE_URL, then restart."
fi

cd ..

# ----------------------------
# Frontend setup
# ----------------------------

echo ""
echo -e "${BLUE}--- Frontend Setup ---${NC}"

cd frontend

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

cd ..

# ----------------------------
# Start services
# ----------------------------

echo ""
echo -e "${BLUE}--- Starting Services ---${NC}"
echo ""

# Start backend in background
echo "Starting backend server..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
echo -n "Waiting for backend..."
for i in {1..30}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

if ! curl -s http://localhost:3001/health > /dev/null 2>&1; then
    echo -e " ${YELLOW}backend may still be starting${NC}"
fi

# Start frontend in background
echo "Starting frontend..."
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

# Wait for frontend to be ready
echo -n "Waiting for frontend..."
for i in {1..30}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Open browser
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   App is running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Frontend:  ${BLUE}http://localhost:3000${NC}"
echo -e "  Backend:   ${BLUE}http://localhost:3001/api${NC}"
echo ""
echo -e "  Folder watcher is monitoring your Downloads folder."
echo -e "  Download attendance from Teams → it imports automatically."
echo ""
echo -e "${YELLOW}  Press Ctrl+C to stop the app.${NC}"
echo ""

# Open browser
open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null

# Trap Ctrl+C to clean up
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    # Kill any child processes
    pkill -P $BACKEND_PID 2>/dev/null
    pkill -P $FRONTEND_PID 2>/dev/null
    echo "Done. Goodbye!"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep script running until Ctrl+C
wait
