import { Request, Response, NextFunction } from 'express';
import { canvasService } from '../services/canvas.service';
import { query } from '../config/database';
import logger from '../config/logger';

/**
 * Get available Canvas courses (online/external only)
 */
export const getCanvasCourses = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!canvasService.isConfigured()) {
      res.status(400).json({ success: false, message: 'Canvas is not configured' });
      return;
    }

    const courses = await canvasService.getCourses();
    res.json({ success: true, data: courses });
  } catch (error: any) {
    logger.error('Error fetching Canvas courses:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch Canvas courses',
    });
  }
};

/**
 * Sync student roster from Canvas for a specific course
 */
export const syncCourseRoster = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId, classCode } = req.body;

    if (!courseId || !classCode) {
      res.status(400).json({
        success: false,
        message: 'courseId and classCode are required',
      });
      return;
    }

    const result = await canvasService.syncCourseRoster(courseId, classCode);

    res.json({
      success: true,
      message: `Synced ${result.studentsFound} students for ${classCode}`,
      data: result,
    });
  } catch (error: any) {
    logger.error('Error syncing Canvas roster:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to sync Canvas roster',
    });
  }
};

/**
 * Sync ALL online/external course rosters from Canvas
 */
export const syncAllRosters = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!canvasService.isConfigured()) {
      res.status(400).json({ success: false, message: 'Canvas is not configured' });
      return;
    }

    const courses = await canvasService.getCourses();
    const results: Array<{ classCode: string; studentsFound: number; studentsCreated: number }> = [];

    for (const course of courses) {
      const result = await canvasService.syncCourseRoster(course.id, course.class_code);
      results.push({
        classCode: course.class_code,
        studentsFound: result.studentsFound,
        studentsCreated: result.studentsCreated,
      });
    }

    const totalStudents = results.reduce((sum, r) => sum + r.studentsFound, 0);
    const totalCreated = results.reduce((sum, r) => sum + r.studentsCreated, 0);

    res.json({
      success: true,
      message: `Synced ${courses.length} courses, ${totalStudents} total students (${totalCreated} new)`,
      data: { courses: results },
    });
  } catch (error: any) {
    logger.error('Error syncing all Canvas rosters:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to sync Canvas rosters',
    });
  }
};

/**
 * Get class roster (students enrolled via Canvas) for a class code
 */
export const getClassRoster = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { classCode } = req.params;
    const roster = await canvasService.getClassRoster(classCode);

    res.json({
      success: true,
      data: roster,
      count: roster.length,
    });
  } catch (error: any) {
    logger.error('Error getting class roster:', error);
    next(error);
  }
};

/**
 * Get attendance with absence detection for a specific meeting
 * Cross-references Canvas roster with actual attendance
 */
export const getMeetingAttendanceWithAbsences = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { meetingId } = req.params;

    // Get the meeting to find its class code
    const meetingResult = await query(
      'SELECT * FROM meetings WHERE id = $1',
      [meetingId]
    );

    if (meetingResult.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Meeting not found' });
      return;
    }

    const meeting = meetingResult.rows[0];
    const classCode = meeting.class_code;

    // Get actual attendance records for this meeting
    const attendanceResult = await query(
      `SELECT ar.*, s.name as student_name, s.email as student_email
       FROM attendance_records ar
       JOIN students s ON s.id = ar.student_id
       WHERE ar.meeting_id = $1
       ORDER BY s.name`,
      [meetingId]
    );

    const attendedStudentIds = new Set(
      attendanceResult.rows.map((r: any) => r.student_id)
    );

    // Get roster for this class (if class code exists and roster is synced)
    let absentStudents: Array<{ student_id: string; name: string; email: string }> = [];

    if (classCode) {
      const roster = await canvasService.getClassRoster(classCode);
      absentStudents = roster.filter(s => !attendedStudentIds.has(s.student_id));
    }

    res.json({
      success: true,
      data: {
        meeting,
        attendance: attendanceResult.rows,
        absent: absentStudents,
        summary: {
          total_enrolled: classCode ? (attendanceResult.rows.length + absentStudents.length) : attendanceResult.rows.length,
          present: attendanceResult.rows.filter((r: any) => r.status === 'present').length,
          late: attendanceResult.rows.filter((r: any) => r.status === 'late').length,
          partial: attendanceResult.rows.filter((r: any) => r.status === 'partial').length,
          absent: absentStudents.length,
        },
      },
    });
  } catch (error: any) {
    logger.error('Error getting meeting attendance with absences:', error);
    next(error);
  }
};

/**
 * Get Canvas sync status
 * Groups related classes (e.g., 11SENX + 11SENX2) into amalgamated groups
 */
export const getCanvasStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const configured = canvasService.isConfigured();

    // Get enrollment counts per class
    const enrollmentCounts = await query(
      `SELECT class_code, COUNT(*) as student_count, MAX(updated_at) as last_synced
       FROM canvas_enrollments
       GROUP BY class_code
       ORDER BY class_code`
    );

    // Build amalgamated groups for the Classes page
    const groupMap = new Map<string, { class_codes: string[]; student_count: number; last_synced: string }>();
    for (const row of enrollmentCounts.rows) {
      const baseCode = canvasService.getBaseClassCode(row.class_code);
      if (!groupMap.has(baseCode)) {
        groupMap.set(baseCode, { class_codes: [], student_count: 0, last_synced: row.last_synced });
      }
      const group = groupMap.get(baseCode)!;
      group.class_codes.push(row.class_code);
      group.student_count += parseInt(row.student_count, 10);
      if (row.last_synced > group.last_synced) {
        group.last_synced = row.last_synced;
      }
    }

    // Get deduplicated student count per group (students may be in multiple related classes)
    const amalgamated_classes = [];
    for (const [baseCode, group] of groupMap) {
      const deduped = await query(
        `SELECT COUNT(DISTINCT ce.student_id) as student_count
         FROM canvas_enrollments ce
         WHERE ce.class_code LIKE $1`,
        [baseCode + '%']
      );
      amalgamated_classes.push({
        class_code: baseCode,
        sub_classes: group.class_codes,
        student_count: deduped.rows[0].student_count,
        last_synced: group.last_synced,
      });
    }

    res.json({
      success: true,
      data: {
        configured,
        canvas_url: process.env.CANVAS_API_URL || null,
        synced_classes: amalgamated_classes,
      },
    });
  } catch (error: any) {
    logger.error('Error getting Canvas status:', error);
    next(error);
  }
};
