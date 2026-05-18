# Gradeo Diagnostics

Use these browser-console scripts to trace a Gradeo marking-status issue from Gradeo source data through Kings Track import/reporting.

## 1. Kings Track API Report

Open `https://kings-track.onrender.com/`, ideally on the affected course page, then paste:

- [`kings-track-report.js`](./kings-track-report.js)

This shows the course mapping, recent import runs, affected report rows, duplicate exam sessions, question row counts, and whether the API response still contains the stale `awaiting_marking` contradiction.

## 2. Gradeo Source Data

Open `https://platform.gradeo.com.au/`, then paste:

- [`gradeo-source-data.js`](./gradeo-source-data.js)

Use the `marking_session_id` from the Kings Track report output. This checks Gradeo CSV rows and the related Gradeo aggregate endpoints for the same session.

## 3. Extension Import Logs

Open `chrome://extensions`, inspect the Kings Track extension service worker, then paste:

- [`extension-import-logs.js`](./extension-import-logs.js)

This shows recent Gradeo/import logs, including CSV fetch failures, skipped exams, payload build size, and backend import summaries.

## What to send back

Send the JSON copied by each script, or paste:

- Course summary and recent matching import runs from the Kings Track report.
- Affected rows for `Cycle4`.
- Gradeo source summary for one affected student.
- Any extension log rows with `csv_failed`, `exam_skipped`, `class_import_payload_built`, or `mapped_class_imported`.

