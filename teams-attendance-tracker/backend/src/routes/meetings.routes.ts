import { Router } from 'express';
import {
  getAllMeetings,
  getMeetingById,
  getUpcomingMeetings,
  getRecentMeetings,
  getMeetingsByDateRange,
  getClassCodes,
  createMeeting,
  getMeetingAttendance,
  syncMeetingAttendance,
  deleteMeeting,
} from '../controllers/meetings.controller';

const router = Router();

/**
 * @route   GET /api/meetings
 * @desc    Get all meetings
 * @access  Private
 */
router.get('/', getAllMeetings);

/**
 * @route   GET /api/meetings/upcoming
 * @desc    Get upcoming meetings
 * @access  Private
 */
router.get('/upcoming', getUpcomingMeetings);

/**
 * @route   GET /api/meetings/recent
 * @desc    Get recent meetings
 * @access  Private
 */
router.get('/recent', getRecentMeetings);

/**
 * @route   GET /api/meetings/classes
 * @desc    Get distinct class codes
 */
router.get('/classes', getClassCodes);

/**
 * @route   GET /api/meetings/date-range
 * @desc    Get meetings by date range
 * @access  Private
 */
router.get('/date-range', getMeetingsByDateRange);

/**
 * @route   GET /api/meetings/:id
 * @desc    Get meeting by ID
 * @access  Private
 */
router.get('/:id', getMeetingById);

/**
 * @route   GET /api/meetings/:id/attendance
 * @desc    Get meeting attendance summary
 * @access  Private
 */
router.get('/:id/attendance', getMeetingAttendance);

/**
 * @route   POST /api/meetings
 * @desc    Create new meeting
 * @access  Private
 */
router.post('/', createMeeting);

/**
 * @route   POST /api/meetings/:id/sync
 * @desc    Sync meeting attendance from Teams
 * @access  Private
 */
router.post('/:id/sync', syncMeetingAttendance);

/**
 * @route   DELETE /api/meetings/:id
 * @desc    Delete meeting
 * @access  Private
 */
router.delete('/:id', deleteMeeting);

export default router;
