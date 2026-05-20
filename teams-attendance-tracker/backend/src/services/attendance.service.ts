import { graphService } from './graph.service';
import { StudentModel } from '../models/Student';
import { MeetingModel } from '../models/Meeting';
import { AttendanceRecordModel } from '../models/AttendanceRecord';
import logger from '../config/logger';
import { AttendanceStatus, CreateAttendanceRecordDTO } from '../types';

/**
 * Attendance Service
 * Business logic for syncing and managing attendance data
 */
export class AttendanceService {
  /**
   * Sync attendance data from Microsoft Teams for a specific meeting
   */
  async syncMeetingAttendance(userId: string, teamsMeetingId: string): Promise<void> {
    try {
      logger.info(`Starting attendance sync for meeting ${teamsMeetingId}`);

      // Get or create meeting record
      let meeting = await MeetingModel.findByTeamsMeetingId(teamsMeetingId);

      if (!meeting) {
        // Fetch meeting details from Graph API
        const graphMeeting = await graphService.getOnlineMeeting(userId, teamsMeetingId);

        meeting = await MeetingModel.create({
          teams_meeting_id: graphMeeting.id,
          title: graphMeeting.subject,
          start_time: new Date(graphMeeting.startDateTime),
          end_time: new Date(graphMeeting.endDateTime),
          organizer_email: graphMeeting.participants?.organizer?.identity?.user?.email,
          meeting_url: graphMeeting.joinUrl,
        });

        logger.info(`Created new meeting record: ${meeting.id}`);
      }

      // Get attendance reports from Graph API
      const attendanceReports = await graphService.getMeetingAttendanceReports(
        userId,
        teamsMeetingId
      );

      if (!attendanceReports || attendanceReports.length === 0) {
        logger.warn(`No attendance reports found for meeting ${teamsMeetingId}`);
        return;
      }

      // Process each attendance report
      for (const report of attendanceReports) {
        const attendanceRecords = await graphService.getAttendanceRecords(
          userId,
          teamsMeetingId,
          report.id
        );

        await this.processAttendanceRecords(meeting.id, attendanceRecords, meeting.start_time);
      }

      logger.info(`Completed attendance sync for meeting ${teamsMeetingId}`);
    } catch (error) {
      logger.error(`Failed to sync attendance for meeting ${teamsMeetingId}`, error);
      throw error;
    }
  }

  /**
   * Process and store attendance records from Graph API
   */
  private async processAttendanceRecords(
    meetingId: string,
    graphRecords: any[],
    meetingStartTime: Date
  ): Promise<void> {
    const recordsToCreate: CreateAttendanceRecordDTO[] = [];

    for (const graphRecord of graphRecords) {
      try {
        // Find or create student
        let student = await StudentModel.findByEmail(graphRecord.emailAddress);

        if (!student) {
          student = await StudentModel.create({
            email: graphRecord.emailAddress,
            name: graphRecord.identity?.displayName || graphRecord.emailAddress,
            azure_ad_id: graphRecord.identity?.id,
          });

          logger.info(`Created new student record: ${student.email}`);
        }

        // Process attendance intervals
        if (graphRecord.attendanceIntervals && graphRecord.attendanceIntervals.length > 0) {
          for (const interval of graphRecord.attendanceIntervals) {
            const joinTime = new Date(interval.joinDateTime);
            const leaveTime = interval.leaveDateTime ? new Date(interval.leaveDateTime) : undefined;
            const durationMinutes = interval.durationInSeconds
              ? Math.floor(interval.durationInSeconds / 60)
              : undefined;

            // Determine attendance status
            const status = this.determineAttendanceStatus(
              joinTime,
              meetingStartTime,
              durationMinutes
            );

            recordsToCreate.push({
              meeting_id: meetingId,
              student_id: student.id,
              join_time: joinTime,
              leave_time: leaveTime,
              duration_minutes: durationMinutes,
              status,
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to process attendance record for ${graphRecord.emailAddress}`, error);
        // Continue processing other records
      }
    }

    // Bulk insert attendance records
    if (recordsToCreate.length > 0) {
      const created = await AttendanceRecordModel.bulkCreate(recordsToCreate);
      logger.info(`Created ${created.length} attendance records`);
    }
  }

  /**
   * Determine attendance status based on join time and duration
   */
  private determineAttendanceStatus(
    joinTime: Date,
    meetingStartTime: Date,
    durationMinutes?: number
  ): AttendanceStatus {
    const latencyMinutes = (joinTime.getTime() - meetingStartTime.getTime()) / (1000 * 60);

    // Joined more than 15 minutes late
    if (latencyMinutes > 15) {
      return AttendanceStatus.LATE;
    }

    // Attended for less than 5 minutes
    if (durationMinutes && durationMinutes < 5) {
      return AttendanceStatus.PARTIAL;
    }

    return AttendanceStatus.PRESENT;
  }

  /**
   * Sync all recent meetings (last 7 days by default)
   */
  async syncRecentMeetings(userId: string, daysBack = 7): Promise<void> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      logger.info(`Syncing meetings from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      const graphMeetings = await graphService.getUserMeetings(userId, startDate, endDate);

      logger.info(`Found ${graphMeetings.length} meetings to sync`);

      for (const graphMeeting of graphMeetings) {
        try {
          if (graphMeeting.onlineMeeting?.joinUrl) {
            await this.syncMeetingAttendance(userId, graphMeeting.id);
          }
        } catch (error) {
          logger.error(`Failed to sync meeting ${graphMeeting.id}`, error);
          // Continue with next meeting
        }
      }

      logger.info('Completed syncing recent meetings');
    } catch (error) {
      logger.error('Failed to sync recent meetings', error);
      throw error;
    }
  }

  /**
   * Get attendance summary for a student
   */
  async getStudentAttendanceSummary(studentId: string) {
    try {
      const stats = await AttendanceRecordModel.getAttendanceStats(studentId);
      const records = await AttendanceRecordModel.findByStudent(studentId);

      return {
        stats,
        recent_records: records.slice(0, 10),
      };
    } catch (error) {
      logger.error(`Failed to get attendance summary for student ${studentId}`, error);
      throw error;
    }
  }

  /**
   * Get attendance summary for a meeting
   */
  async getMeetingAttendanceSummary(meetingId: string) {
    try {
      const meeting = await MeetingModel.findById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      const records = await AttendanceRecordModel.findByMeeting(meetingId);

      const summary = {
        meeting,
        total_attendees: records.length,
        present: records.filter((r) => r.status === AttendanceStatus.PRESENT).length,
        late: records.filter((r) => r.status === AttendanceStatus.LATE).length,
        partial: records.filter((r) => r.status === AttendanceStatus.PARTIAL).length,
        records,
      };

      return summary;
    } catch (error) {
      logger.error(`Failed to get meeting attendance summary for ${meetingId}`, error);
      throw error;
    }
  }
}

// Export singleton instance
export const attendanceService = new AttendanceService();
