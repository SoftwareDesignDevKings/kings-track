import { Router } from 'express';
import {
  getCanvasCourses,
  syncCourseRoster,
  syncAllRosters,
  getClassRoster,
  getMeetingAttendanceWithAbsences,
  getCanvasStatus,
} from '../controllers/canvas.controller';

const router = Router();

/**
 * @route   GET /api/canvas/status
 * @desc    Get Canvas integration status
 */
router.get('/status', getCanvasStatus);

/**
 * @route   GET /api/canvas/courses
 * @desc    Get available Canvas courses (online/external only)
 */
router.get('/courses', getCanvasCourses);

/**
 * @route   POST /api/canvas/sync
 * @desc    Sync a specific course roster from Canvas
 */
router.post('/sync', syncCourseRoster);

/**
 * @route   POST /api/canvas/sync-all
 * @desc    Sync ALL online course rosters from Canvas
 */
router.post('/sync-all', syncAllRosters);

/**
 * @route   GET /api/canvas/roster/:classCode
 * @desc    Get synced roster for a class
 */
router.get('/roster/:classCode', getClassRoster);

/**
 * @route   GET /api/canvas/attendance/:meetingId
 * @desc    Get meeting attendance with absence detection from Canvas roster
 */
router.get('/attendance/:meetingId', getMeetingAttendanceWithAbsences);

export default router;
