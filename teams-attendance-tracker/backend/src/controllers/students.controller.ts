import { Request, Response, NextFunction } from 'express';
import { StudentModel } from '../models/Student';
import { attendanceService } from '../services/attendance.service';
import { query as dbQuery } from '../config/database';
import logger from '../config/logger';
import { z } from 'zod';

// Validation schemas
const createStudentSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  student_id: z.string().optional(),
  azure_ad_id: z.string().optional(),
});

const updateStudentSchema = createStudentSchema.partial();

/**
 * Get all students, optionally filtered by canvas class_code (exact match)
 */
export const getAllStudents = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { class_code } = req.query;

    if (class_code && typeof class_code === 'string') {
      // Filter by exact canvas enrollment class code
      const result = await dbQuery(
        `SELECT DISTINCT s.*
         FROM students s
         JOIN canvas_enrollments ce ON ce.student_id = s.id
         WHERE ce.class_code = $1
         ORDER BY s.name`,
        [class_code]
      );
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length,
      });
    } else {
      const students = await StudentModel.findAll();
      res.json({
        success: true,
        data: students,
        count: students.length,
      });
    }
  } catch (error) {
    logger.error('Error in getAllStudents:', error);
    next(error);
  }
};

/**
 * Get individual canvas class codes (not amalgamated)
 */
export const getCanvasClassCodes = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await dbQuery(
      `SELECT class_code, COUNT(*) as student_count
       FROM canvas_enrollments
       GROUP BY class_code
       ORDER BY class_code`
    );
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Error in getCanvasClassCodes:', error);
    next(error);
  }
};

/**
 * Get student by ID
 */
export const getStudentById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const student = await StudentModel.findById(id);

    if (!student) {
      res.status(404).json({
        success: false,
        message: 'Student not found',
      });
      return;
    }

    res.json({
      success: true,
      data: student,
    });
  } catch (error) {
    logger.error('Error in getStudentById:', error);
    next(error);
  }
};

/**
 * Create new student
 */
export const createStudent = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const validatedData = createStudentSchema.parse(req.body);

    // Check if student already exists
    const existingStudent = await StudentModel.findByEmail(validatedData.email);
    if (existingStudent) {
      res.status(409).json({
        success: false,
        message: 'Student with this email already exists',
      });
      return;
    }

    const student = await StudentModel.create(validatedData);

    res.status(201).json({
      success: true,
      data: student,
      message: 'Student created successfully',
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
    logger.error('Error in createStudent:', error);
    next(error);
  }
};

/**
 * Update student
 */
export const updateStudent = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const validatedData = updateStudentSchema.parse(req.body);

    const student = await StudentModel.update(id, validatedData);

    if (!student) {
      res.status(404).json({
        success: false,
        message: 'Student not found',
      });
      return;
    }

    res.json({
      success: true,
      data: student,
      message: 'Student updated successfully',
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
    logger.error('Error in updateStudent:', error);
    next(error);
  }
};

/**
 * Delete student
 */
export const deleteStudent = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await StudentModel.delete(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Student not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Student deleted successfully',
    });
  } catch (error) {
    logger.error('Error in deleteStudent:', error);
    next(error);
  }
};

/**
 * Search students
 */
export const searchStudents = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
      return;
    }

    const students = await StudentModel.search(q);

    res.json({
      success: true,
      data: students,
      count: students.length,
    });
  } catch (error) {
    logger.error('Error in searchStudents:', error);
    next(error);
  }
};

/**
 * Get student attendance summary
 */
export const getStudentAttendance = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const student = await StudentModel.findById(id);
    if (!student) {
      res.status(404).json({
        success: false,
        message: 'Student not found',
      });
      return;
    }

    const summary = await attendanceService.getStudentAttendanceSummary(id);

    res.json({
      success: true,
      data: {
        student,
        ...summary,
      },
    });
  } catch (error) {
    logger.error('Error in getStudentAttendance:', error);
    next(error);
  }
};
