import { Request, Response, NextFunction } from 'express';
import { MeetingModel } from '../models/Meeting';
import { attendanceService } from '../services/attendance.service';
import logger from '../config/logger';
import { z } from 'zod';

// Validation schemas
const createMeetingSchema = z.object({
  teams_meeting_id: z.string().min(1),
  title: z.string().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  organizer_email: z.string().email().optional(),
  meeting_url: z.string().url().optional(),
});

const dateRangeSchema = z.object({
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

/**
 * Get all meetings (optionally filtered by class_code)
 */
export const getAllMeetings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const classCode = req.query.class_code as string | undefined;

    let meetings;
    if (classCode) {
      meetings = await MeetingModel.findByClassCode(classCode);
    } else {
      meetings = await MeetingModel.findAll(limit, offset);
    }

    res.json({
      success: true,
      data: meetings,
      count: meetings.length,
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error in getAllMeetings:', error);
    next(error);
  }
};

/**
 * Get distinct class codes
 */
export const getClassCodes = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const classCodes = await MeetingModel.getDistinctClassCodes();
    res.json({
      success: true,
      data: classCodes,
    });
  } catch (error) {
    logger.error('Error in getClassCodes:', error);
    next(error);
  }
};

/**
 * Get meeting by ID
 */
export const getMeetingById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const meeting = await MeetingModel.findById(id);

    if (!meeting) {
      res.status(404).json({
        success: false,
        message: 'Meeting not found',
      });
      return;
    }

    res.json({
      success: true,
      data: meeting,
    });
  } catch (error) {
    logger.error('Error in getMeetingById:', error);
    next(error);
  }
};

/**
 * Get upcoming meetings
 */
export const getUpcomingMeetings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const meetings = await MeetingModel.getUpcoming(limit);

    res.json({
      success: true,
      data: meetings,
      count: meetings.length,
    });
  } catch (error) {
    logger.error('Error in getUpcomingMeetings:', error);
    next(error);
  }
};

/**
 * Get recent meetings
 */
export const getRecentMeetings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const meetings = await MeetingModel.getRecent(limit);

    res.json({
      success: true,
      data: meetings,
      count: meetings.length,
    });
  } catch (error) {
    logger.error('Error in getRecentMeetings:', error);
    next(error);
  }
};

/**
 * Get meetings by date range
 */
export const getMeetingsByDateRange = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { start_date, end_date } = dateRangeSchema.parse(req.query);

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        message: 'Both start_date and end_date are required',
      });
      return;
    }

    const meetings = await MeetingModel.findByDateRange(
      new Date(start_date),
      new Date(end_date)
    );

    res.json({
      success: true,
      data: meetings,
      count: meetings.length,
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
    logger.error('Error in getMeetingsByDateRange:', error);
    next(error);
  }
};

/**
 * Create new meeting
 */
export const createMeeting = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const validatedData = createMeetingSchema.parse(req.body);

    // Check if meeting already exists
    const existingMeeting = await MeetingModel.findByTeamsMeetingId(
      validatedData.teams_meeting_id
    );

    if (existingMeeting) {
      res.status(409).json({
        success: false,
        message: 'Meeting already exists',
        data: existingMeeting,
      });
      return;
    }

    const meeting = await MeetingModel.create({
      ...validatedData,
      start_time: new Date(validatedData.start_time),
      end_time: new Date(validatedData.end_time),
    });

    res.status(201).json({
      success: true,
      data: meeting,
      message: 'Meeting created successfully',
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
    logger.error('Error in createMeeting:', error);
    next(error);
  }
};

/**
 * Get meeting attendance summary
 */
export const getMeetingAttendance = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const meeting = await MeetingModel.findById(id);
    if (!meeting) {
      res.status(404).json({
        success: false,
        message: 'Meeting not found',
      });
      return;
    }

    const summary = await attendanceService.getMeetingAttendanceSummary(id);

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error('Error in getMeetingAttendance:', error);
    next(error);
  }
};

/**
 * Sync meeting attendance from Teams
 */
export const syncMeetingAttendance = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      res.status(400).json({
        success: false,
        message: 'user_id is required',
      });
      return;
    }

    const meeting = await MeetingModel.findById(id);
    if (!meeting) {
      res.status(404).json({
        success: false,
        message: 'Meeting not found',
      });
      return;
    }

    await attendanceService.syncMeetingAttendance(user_id, meeting.teams_meeting_id);

    res.json({
      success: true,
      message: 'Meeting attendance synced successfully',
    });
  } catch (error) {
    logger.error('Error in syncMeetingAttendance:', error);
    next(error);
  }
};

/**
 * Delete meeting
 */
export const deleteMeeting = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const deleted = await MeetingModel.delete(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        message: 'Meeting not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Meeting deleted successfully',
    });
  } catch (error) {
    logger.error('Error in deleteMeeting:', error);
    next(error);
  }
};
