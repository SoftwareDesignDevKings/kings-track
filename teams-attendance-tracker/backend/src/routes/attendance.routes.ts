import { Router } from 'express';
import multer from 'multer';
import {
  getAllAttendanceRecords,
  getAttendanceRecordById,
  createAttendanceRecord,
  updateAttendanceRecord,
  deleteAttendanceRecord,
  getAttendanceReport,
  importAttendanceCSV,
  exportAttendanceCSV,
} from '../controllers/attendance.controller';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

const router = Router();

/**
 * @route   GET /api/attendance
 * @desc    Get all attendance records
 * @access  Private
 */
router.get('/', getAllAttendanceRecords);

/**
 * @route   GET /api/attendance/report
 * @desc    Get attendance report with filters
 * @access  Private
 */
router.get('/report', getAttendanceReport);

/**
 * @route   GET /api/attendance/export
 * @desc    Export attendance report as CSV
 * @access  Private
 */
router.get('/export', exportAttendanceCSV);

/**
 * @route   GET /api/attendance/:id
 * @desc    Get attendance record by ID
 * @access  Private
 */
router.get('/:id', getAttendanceRecordById);

/**
 * @route   POST /api/attendance
 * @desc    Create attendance record
 * @access  Private
 */
router.post('/', createAttendanceRecord);

/**
 * @route   POST /api/attendance/import
 * @desc    Import attendance data from CSV file
 * @access  Private
 */
router.post('/import', upload.single('file'), importAttendanceCSV);

/**
 * @route   PUT /api/attendance/:id
 * @desc    Update attendance record
 * @access  Private
 */
router.put('/:id', updateAttendanceRecord);

/**
 * @route   DELETE /api/attendance/:id
 * @desc    Delete attendance record
 * @access  Private
 */
router.delete('/:id', deleteAttendanceRecord);

export default router;
