"""
Folder watcher — monitors a directory for new Teams attendance CSVs
and auto-imports them. Uses watchdog (Python equivalent of chokidar).
"""
import os
import shutil
import logging
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from dataclasses import dataclass

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent

from app.attendance.csv_parser import decode_teams_file, parse_and_import
from app.db import AsyncSessionLocal

logger = logging.getLogger(__name__)

TEAMS_FILENAME_PATTERNS = [
    "attendance",
    "meetingattendance",
    "meeting_attendance",
]

TEAMS_CONTENT_MARKERS = [
    "1. summary",
    "2. participants",
    "full name",
    "first join",
    "meeting title",
]


@dataclass
class WatcherHistoryEntry:
    file_name: str
    timestamp: str
    success: bool
    meeting_title: str = ""
    records_imported: int = 0
    error: str | None = None


class AttendanceWatcher:
    """Singleton folder watcher for Teams attendance CSVs."""

    def __init__(self) -> None:
        self._observer: Observer | None = None
        self._running = False
        self._watch_folder = ""
        self._processed_folder = ""
        self._processed_files: set[str] = set()
        self._skipped_files: set[str] = set()
        self._history: list[WatcherHistoryEntry] = []
        self._last_import_time: datetime | None = None
        self._last_import_file: str | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def running(self) -> bool:
        return self._running

    @property
    def watch_folder(self) -> str:
        return self._watch_folder

    def configure(self, watch_folder: str, processed_folder: str) -> None:
        """Set watch/processed folders without starting the observer."""
        if not watch_folder or not watch_folder.strip():
            raise ValueError("watch_folder must be a non-empty path")
        self._watch_folder = self._resolve_folder(watch_folder)
        self._processed_folder = self._resolve_folder(processed_folder)

    def start(self, watch_folder: str, processed_folder: str) -> dict:
        """Start watching a folder for new CSVs."""
        if self._running:
            return {"status": "already_running", "folder": self._watch_folder}

        if not watch_folder or not watch_folder.strip():
            raise ValueError("watch_folder must be a non-empty path")

        self._watch_folder = self._resolve_folder(watch_folder)
        self._processed_folder = self._resolve_folder(processed_folder)

        # Ensure directories exist
        os.makedirs(self._watch_folder, exist_ok=True)
        os.makedirs(self._processed_folder, exist_ok=True)

        self._loop = asyncio.get_event_loop()

        handler = _CSVHandler(self)
        self._observer = Observer()
        self._observer.schedule(handler, self._watch_folder, recursive=False)
        self._observer.start()
        self._running = True

        logger.info("Attendance watcher started: %s", self._watch_folder)
        return {"status": "started", "folder": self._watch_folder}

    def stop(self) -> dict:
        """Stop the folder watcher."""
        if not self._running or not self._observer:
            return {"status": "not_running"}

        self._observer.stop()
        self._observer.join(timeout=5)
        self._observer = None
        self._running = False

        logger.info("Attendance watcher stopped")
        return {"status": "stopped"}

    async def scan(self) -> list[dict]:
        """Scan the watch folder and process any existing CSV files."""
        if not self._watch_folder:
            return []

        results = []
        folder = Path(self._watch_folder)
        for csv_file in sorted(folder.glob("*.csv")):
            if csv_file.name.startswith("."):
                continue
            path_str = str(csv_file)
            if path_str in self._processed_files or path_str in self._skipped_files:
                continue
            result = await self._process_file(path_str)
            results.append(result)

        return results

    async def _process_file(self, file_path: str) -> dict:
        """Process a single CSV file."""
        file_name = os.path.basename(file_path)

        if file_path in self._processed_files:
            return {"file": file_name, "status": "skipped", "reason": "already_processed"}

        try:
            # Read and decode file
            with open(file_path, "rb") as f:
                raw_bytes = f.read()
            content = decode_teams_file(raw_bytes)

            # Validate it looks like a Teams attendance report
            if not self._is_attendance_report(file_name, content):
                self._skipped_files.add(file_path)
                return {"file": file_name, "status": "skipped", "reason": "not_attendance_report"}

            # Parse and import
            async with AsyncSessionLocal() as db:
                result = await parse_and_import(db, content, file_name)

            entry = WatcherHistoryEntry(
                file_name=file_name,
                timestamp=datetime.now(timezone.utc).isoformat(),
                success=result.success,
                meeting_title=result.meeting_title,
                records_imported=result.attendance_records_created,
                error=result.errors[0] if result.errors else None,
            )
            self._history.insert(0, entry)
            if len(self._history) > 100:
                self._history = self._history[:100]

            if result.success:
                self._processed_files.add(file_path)
                self._last_import_time = datetime.now(timezone.utc)
                self._last_import_file = file_name
                self._move_to_processed(file_path)

            return {
                "file": file_name,
                "status": "imported" if result.success else "error",
                "meeting_title": result.meeting_title,
                "records": result.attendance_records_created,
                "errors": result.errors,
            }

        except Exception as e:
            logger.error("Error processing file %s: %s", file_name, e)
            entry = WatcherHistoryEntry(
                file_name=file_name,
                timestamp=datetime.now(timezone.utc).isoformat(),
                success=False,
                error=str(e),
            )
            self._history.insert(0, entry)
            return {"file": file_name, "status": "error", "error": str(e)}

    def _is_attendance_report(self, file_name: str, content: str) -> bool:
        """Check if a file looks like a Teams attendance report."""
        name_lower = file_name.lower()
        for pattern in TEAMS_FILENAME_PATTERNS:
            if pattern in name_lower:
                return True

        content_lower = content[:2000].lower()
        matches = sum(1 for marker in TEAMS_CONTENT_MARKERS if marker in content_lower)
        return matches >= 2

    def _move_to_processed(self, file_path: str) -> None:
        """Move a processed file to the processed folder with timestamp prefix."""
        file_name = os.path.basename(file_path)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        dest = os.path.join(self._processed_folder, f"{timestamp}_{file_name}")

        try:
            shutil.move(file_path, dest)
        except OSError:
            # Cross-device fallback: copy + delete
            try:
                shutil.copy2(file_path, dest)
                os.unlink(file_path)
            except Exception as e:
                logger.warning("Could not move file %s: %s", file_path, e)

    def get_status(self) -> dict:
        """Get current watcher status."""
        today = datetime.now(timezone.utc).date().isoformat()
        files_today = sum(
            1 for h in self._history if h.success and h.timestamp.startswith(today)
        )
        return {
            "running": self._running,
            "watch_folder": self._watch_folder,
            "processed_folder": self._processed_folder,
            "files_processed_today": files_today,
            "total_files_processed": sum(1 for h in self._history if h.success),
            "last_import_time": self._last_import_time.isoformat() if self._last_import_time else None,
            "last_import_file": self._last_import_file,
        }

    def get_history(self, limit: int = 50) -> list[dict]:
        """Get recent import history."""
        return [
            {
                "file_name": h.file_name,
                "timestamp": h.timestamp,
                "success": h.success,
                "meeting_title": h.meeting_title,
                "records_imported": h.records_imported,
                "error": h.error,
            }
            for h in self._history[:limit]
        ]

    @staticmethod
    def _resolve_folder(path: str) -> str:
        if path.startswith("~"):
            path = os.path.expanduser(path)
        return os.path.abspath(path)


class _CSVHandler(FileSystemEventHandler):
    """watchdog handler that triggers processing on new CSV files."""

    def __init__(self, watcher: AttendanceWatcher) -> None:
        self._watcher = watcher

    def on_created(self, event: FileCreatedEvent) -> None:
        if event.is_directory:
            return
        if not event.src_path.lower().endswith(".csv"):
            return
        if os.path.basename(event.src_path).startswith("."):
            return

        # Schedule async processing on the main event loop
        loop = self._watcher._loop
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self._delayed_process(event.src_path), loop
            )

    async def _delayed_process(self, file_path: str) -> None:
        """Wait for file write to stabilize before processing."""
        await asyncio.sleep(2)  # stability threshold
        await self._watcher._process_file(file_path)


# Singleton instance
attendance_watcher = AttendanceWatcher()
