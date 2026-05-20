import { parse } from 'csv-parse/sync';
import { MeetingModel } from '../models/Meeting';
import { StudentModel } from '../models/Student';
import { AttendanceRecordModel } from '../models/AttendanceRecord';
import logger from '../config/logger';
import { AttendanceStatus } from '../types';

/**
 * CSV Import Service for Option 1
 * Imports attendance data from CSV files provided by IT department
 */

interface CSVRow {
  meeting_id: string;
  meeting_title: string;
  meeting_start: string;
  meeting_end: string;
  student_email: string;
  student_name: string;
  join_time: string;
  leave_time: string;
  duration_minutes: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  meetings: number;
  students: number;
  attendance: number;
}

export class CSVImportService {
  /**
   * Import attendance data from CSV file content
   */
  async importFromCSV(fileContent: string): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      meetings: 0,
      students: 0,
      attendance: 0,
    };

    try {
      // Parse CSV
      const records: CSVRow[] = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      logger.info(`Parsing ${records.length} records from CSV`);

      // Track created items to avoid duplicates
      const createdMeetings = new Set<string>();
      const createdStudents = new Set<string>();

      for (const record of records) {
        try {
          // Validate required fields
          if (!this.validateRecord(record)) {
            result.errors.push(`Invalid record: ${JSON.stringify(record)}`);
            result.skipped++;
            continue;
          }

          // 1. Create or update meeting
          let meeting = await MeetingModel.findByTeamsMeetingId(record.meeting_id);
          if (!meeting) {
            meeting = await MeetingModel.create({
              teams_meeting_id: record.meeting_id,
              title: record.meeting_title,
              start_time: new Date(record.meeting_start),
              end_time: new Date(record.meeting_end),
              organizer_email: 'imported@csv.com', // Placeholder
            });
            createdMeetings.add(record.meeting_id);
            result.meetings++;
            logger.info(`Created meeting: ${record.meeting_title}`);
          }

          // 2. Create or update student
          let student = await StudentModel.findByEmail(record.student_email);
          if (!student) {
            student = await StudentModel.create({
              name: record.student_name,
              email: record.student_email,
            });
            createdStudents.add(record.student_email);
            result.students++;
            logger.info(`Created student: ${record.student_name}`);
          }

          // 3. Calculate duration and status
          const joinTime = new Date(record.join_time);
          const leaveTime = record.leave_time ? new Date(record.leave_time) : undefined;
          const durationMinutes = parseInt(record.duration_minutes) || undefined;

          // Determine status
          const status = this.determineStatus(
            joinTime,
            new Date(record.meeting_start),
            durationMinutes
          );

          // 4. Create attendance record
          const existingRecord = await this.findExistingAttendance(
            meeting.id,
            student.id,
            joinTime
          );

          if (!existingRecord) {
            await AttendanceRecordModel.create({
              meeting_id: meeting.id,
              student_id: student.id,
              join_time: joinTime,
              leave_time: leaveTime,
              duration_minutes: durationMinutes,
              status,
            });
            result.attendance++;
            result.imported++;
          } else {
            result.skipped++;
            logger.debug(`Skipping duplicate attendance record for ${record.student_email}`);
          }
        } catch (error: any) {
          result.errors.push(`Error processing record: ${error.message}`);
          logger.error('Error processing CSV record:', error);
        }
      }

      logger.info(
        `CSV import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors`
      );
    } catch (error: any) {
      logger.error('Failed to parse CSV:', error);
      throw new Error(`CSV parsing failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate a CSV record has all required fields
   */
  private validateRecord(record: CSVRow): boolean {
    const required = [
      'meeting_id',
      'meeting_title',
      'meeting_start',
      'meeting_end',
      'student_email',
      'student_name',
      'join_time',
    ];

    for (const field of required) {
      if (!record[field as keyof CSVRow] || record[field as keyof CSVRow].trim() === '') {
        return false;
      }
    }

    return true;
  }

  /**
   * Determine attendance status based on join time and duration
   */
  private determineStatus(
    joinTime: Date,
    meetingStart: Date,
    durationMinutes?: number
  ): AttendanceStatus {
    // If they joined more than 10 minutes late
    const lateThresholdMs = 10 * 60 * 1000;
    const timeDiff = joinTime.getTime() - meetingStart.getTime();

    if (timeDiff > lateThresholdMs) {
      return AttendanceStatus.LATE;
    }

    // If duration is less than 50% of expected, mark as partial
    if (durationMinutes && durationMinutes < 30) {
      return AttendanceStatus.PARTIAL;
    }

    return AttendanceStatus.PRESENT;
  }

  /**
   * Check if an attendance record already exists
   */
  private async findExistingAttendance(
    meetingId: string,
    studentId: string,
    joinTime: Date
  ): Promise<any> {
    try {
      // Look for existing record with same meeting, student, and similar join time (within 1 minute)
      const records = await AttendanceRecordModel.getAttendanceReport({
        meeting_id: meetingId,
        student_id: studentId,
      });

      // Check if any record has a join time within 1 minute
      return records.find((record: any) => {
        const existingJoinTime = new Date(record.join_time);
        const timeDiff = Math.abs(existingJoinTime.getTime() - joinTime.getTime());
        return timeDiff < 60000; // Within 1 minute
      });
    } catch (error) {
      return null;
    }
  }
}

export const csvImportService = new CSVImportService();
