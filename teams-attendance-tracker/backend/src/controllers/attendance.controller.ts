import { Request, Response, NextFunction } from 'express';
import { AttendanceRecordModel } from '../models/AttendanceRecord';
import { csvImportService } from '../services/csv-import.service';
import logger from '../config/logger';
import { z } from 'zod';
import { AttendanceStatus } from '../types';

// Validation schemas
const createAttendanceSchema = z.object({
  meeting_id: z.string().uuid(),
  student_id: z.string().uuid(),
  join_time: z.string().datetime(),
  leave_time: z.string().datetime().optional(),
  duration_minutes: z.number().int().positive().optional(),
  status: z.enum(['present', 'late', 'absent', 'partial']),
});

const attendanceReportFilterSchema = z.object({
  student_id: z.string().uuid().optional(),
  meeting_id: z.string().uuid().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  status: z.enum(['present', 'late', 'absent', 'partial']).optional(),
});

/**
 * Get all attendance records
 */
export const getAllAttendanceRecords = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const records = await AttendanceRecordModel.findAll(limit, offset);

    res.json({
      success: true,
      data: records,
      count: records.length,
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error in getAllAttendanceRecords:', error);
    next(error);
  }
};

/**
 * Get attendance record by ID
 */
export const getAttendanceRecordById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const record = await AttendanceRecordModel.findById(id);

    if (!record) {
      res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
      return;
    }

    res.json({
      success: true,
      data: record,
    });
  } catch (error) {
    logger.error('Error in getAttendanceRecordById:', error);
    next(error);
  }
};

/**
 * Create attendance record
 */
export const createAttendanceRecord = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const validatedData = createAttendanceSchema.parse(req.body);

    const record = await AttendanceRecordModel.create({
      ...validatedData,
      join_time: new Date(validatedData.join_time),
      leave_time: validatedData.leave_time ? new Date(validatedData.leave_time) : undefined,
      status: validatedData.status as AttendanceStatus,
    });

    res.status(201).json({
      success: true,
      data: record,
      message: 'Attendance record created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors,
      });
      return;
    }
    logger.error('Error in createAttendanceRecord:', error);
    next(error);
  }
};

/**
 * Update attendance record
 */
export const updateAttendanceRecord = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const validatedData = createAttendanceSchema.partial().parse(req.body);

    const updateData = {
      ...validatedData,
      join_time: validatedData.join_time ? new Date(validatedData.join_time) : undefined,
      leave_time: validatedData.leave_time ? new Date(validatedData.leave_time) : undefined,
      status: validatedData.status as AttendanceStatus | undefined,
    };

    const record = await AttendanceRecordModel.update(id, updateData);

    if (!record) {
      res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
      return;
    }

    res.json({
      success: true,
      data: record,
      message: 'Attendance record updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors,
      });
      return;
    }
    logger.error('Error in updateAttendanceRecord:', error);
    next(error);
  }
};

/**
 * Delete attendance record
 */
export const deleteAttendanceRecord = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await AttendanceRecordModel.delete(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Attendance record not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Attendance record deleted successfully',
    });
  } catch (error) {
    logger.error('Error in deleteAttendanceRecord:', error);
    next(error);
  }
};

/**
 * Get attendance report with filters
 */
export const getAttendanceReport = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const filters = attendanceReportFilterSchema.parse(req.query);

    const filterData = {
      student_id: filters.student_id,
      meeting_id: filters.meeting_id,
      start_date: filters.start_date ? new Date(filters.start_date) : undefined,
      end_date: filters.end_date ? new Date(filters.end_date) : undefined,
      status: filters.status as AttendanceStatus | undefined,
    };

    const records = await AttendanceRecordModel.getAttendanceReport(filterData);

    res.json({
      success: true,
      data: records,
      count: records.length,
      filters: filterData,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors,
      });
      return;
    }
    logger.error('Error in getAttendanceReport:', error);
    next(error);
  }
};

/**
 * Import attendance data from CSV file
 * OPTION 1 - CSV import from IT-provided files
 */
export const importAttendanceCSV = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'CSV file is required',
      });
      return;
    }

    // Read file content
    const fileContent = req.file.buffer.toString('utf-8');

    // Import CSV data
    const result = await csvImportService.importFromCSV(fileContent);

    if (result.errors.length > 0) {
      logger.warn(`CSV import completed with ${result.errors.length} errors`);
    }

    res.json({
      success: true,
      message: `Successfully imported ${result.imported} attendance records`,
      data: {
        imported: result.imported,
        skipped: result.skipped,
        meetings: result.meetings,
        students: result.students,
        attendance: result.attendance,
        errors: result.errors,
      },
    });
  } catch (error) {
    logger.error('Error in importAttendanceCSV:', error);
    next(error);
  }
};

/**
 * Export attendance report as CSV
 */
export const exportAttendanceCSV = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const filters = attendanceReportFilterSchema.parse(req.query);

    const filterData = {
      student_id: filters.student_id,
      meeting_id: filters.meeting_id,
      start_date: filters.start_date ? new Date(filters.start_date) : undefined,
      end_date: filters.end_date ? new Date(filters.end_date) : undefined,
      status: filters.status as AttendanceStatus | undefined,
    };

    const records = await AttendanceRecordModel.getAttendanceReport(filterData);

    // Create CSV content
    const headers = [
      'Student Name',
      'Student Email',
      'Meeting Title',
      'Meeting Start',
      'Join Time',
      'Leave Time',
      'Duration (minutes)',
      'Status',
    ];

    const rows = records.map((record: any) => [
      record.student_name || 'N/A',
      record.student_email || 'N/A',
      record.meeting_title || 'N/A',
      record.start_time ? new Date(record.start_time).toISOString() : 'N/A',
      new Date(record.join_time).toISOString(),
      record.leave_time ? new Date(record.leave_time).toISOString() : 'N/A',
      record.duration_minutes || 'N/A',
      record.status,
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=attendance-report.csv');
    res.send(csvContent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors,
      });
      return;
    }
    logger.error('Error in exportAttendanceCSV:', error);
    next(error);
  }
};
