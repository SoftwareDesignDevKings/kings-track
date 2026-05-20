import { MeetingModel } from '../models/Meeting';
import { StudentModel } from '../models/Student';
import { AttendanceRecordModel } from '../models/AttendanceRecord';
import logger from '../config/logger';
import { AttendanceStatus } from '../types';

/**
 * Parsed meeting info from Teams CSV Summary section
 */
interface ParsedMeetingInfo {
  meetingId: string;
  title: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Parsed participant row from Teams CSV Participants section
 */
interface ParsedParticipant {
  fullName: string;
  firstJoin: Date;
  lastLeave: Date;
  durationMinutes: number;
  email: string;
  role: string;
}

/**
 * Result of a Teams CSV import
 */
export interface TeamsCSVImportResult {
  success: boolean;
  meetingTitle: string;
  meetingsCreated: number;
  studentsCreated: number;
  attendanceRecordsCreated: number;
  skipped: number;
  errors: string[];
  fileName: string;
}

/**
 * Teams CSV Parser Service
 *
 * Parses the native Microsoft Teams attendance report CSV format.
 * Teams exports attendance as a tab-separated file with sections:
 *   1. Summary (meeting metadata)
 *   2. Participants (attendance data)
 *   3. In-Meeting Activities (optional, ignored)
 *
 * Also handles a simpler flat CSV format as a fallback.
 */
export class TeamsCSVParserService {
  /**
   * Parse and import a Teams attendance CSV file
   */
  async parseAndImport(fileContent: string, fileName: string): Promise<TeamsCSVImportResult> {
    const result: TeamsCSVImportResult = {
      success: false,
      meetingTitle: '',
      meetingsCreated: 0,
      studentsCreated: 0,
      attendanceRecordsCreated: 0,
      skipped: 0,
      errors: [],
      fileName,
    };

    try {
      // Detect format: multi-section (Teams native) or flat CSV
      const isTeamsFormat = this.isTeamsNativeFormat(fileContent);

      let meetingInfo: ParsedMeetingInfo;
      let participants: ParsedParticipant[];

      if (isTeamsFormat) {
        logger.info(`Parsing Teams native format: ${fileName}`);
        meetingInfo = this.parseSummarySection(fileContent, fileName);
        participants = this.parseParticipantsSection(fileContent);
      } else {
        logger.info(`Parsing flat CSV format: ${fileName}`);
        const parsed = this.parseFlatCSV(fileContent, fileName);
        meetingInfo = parsed.meeting;
        participants = parsed.participants;
      }

      result.meetingTitle = meetingInfo.title;

      if (participants.length === 0) {
        result.errors.push('No participant data found in file');
        return result;
      }

      // Extract class code from meeting title
      const classCode = this.extractClassCode(meetingInfo.title);
      if (classCode) {
        logger.info(`Extracted class code "${classCode}" from meeting title "${meetingInfo.title}"`);
      }

      // Create or find meeting
      let meeting = await MeetingModel.findByTeamsMeetingId(meetingInfo.meetingId);
      if (!meeting) {
        meeting = await MeetingModel.create({
          teams_meeting_id: meetingInfo.meetingId,
          title: meetingInfo.title,
          start_time: meetingInfo.startTime,
          end_time: meetingInfo.endTime,
          class_code: classCode || undefined,
        });
        result.meetingsCreated = 1;
        logger.info(`Created meeting: ${meetingInfo.title}`);
      } else if (classCode && !meeting.class_code) {
        // Backfill class_code if meeting exists but doesn't have one yet
        await MeetingModel.update(meeting.id, { class_code: classCode });
        meeting.class_code = classCode;
      }

      // Process each participant
      for (const participant of participants) {
        try {
          // Skip participants without email (e.g., phone dial-in users)
          if (!participant.email || participant.email.trim() === '') {
            result.skipped++;
            continue;
          }

          // Create or find student
          let student = await StudentModel.findByEmail(participant.email);
          if (!student) {
            student = await StudentModel.create({
              name: participant.fullName,
              email: participant.email,
            });
            result.studentsCreated++;
          }

          // Determine attendance status
          const status = this.determineStatus(
            participant.firstJoin,
            meetingInfo.startTime,
            participant.durationMinutes
          );

          // Create attendance record using bulkCreate for ON CONFLICT handling
          const records = await AttendanceRecordModel.bulkCreate([{
            meeting_id: meeting.id,
            student_id: student.id,
            join_time: participant.firstJoin,
            leave_time: participant.lastLeave,
            duration_minutes: participant.durationMinutes,
            status,
          }]);

          if (records.length > 0) {
            result.attendanceRecordsCreated++;
          } else {
            result.skipped++;
          }
        } catch (error: any) {
          result.errors.push(`Error processing ${participant.fullName}: ${error.message}`);
          logger.error(`Error processing participant ${participant.fullName}:`, error);
        }
      }

      result.success = true;
      logger.info(
        `Teams CSV import complete for "${meetingInfo.title}": ` +
        `${result.attendanceRecordsCreated} records, ${result.skipped} skipped`
      );
    } catch (error: any) {
      result.errors.push(`Parse error: ${error.message}`);
      logger.error(`Failed to parse Teams CSV ${fileName}:`, error);
    }

    return result;
  }

  /**
   * Check if the file content is in Teams native multi-section format
   */
  isTeamsNativeFormat(content: string): boolean {
    // Teams native format has numbered section headers
    return (
      content.includes('1. Summary') ||
      content.includes('2. Participants') ||
      // Alternative: some versions use "Meeting Summary" header
      content.includes('Meeting Title\t')
    );
  }

  /**
   * Parse the Summary section of a Teams native CSV
   */
  private parseSummarySection(content: string, fileName: string): ParsedMeetingInfo {
    const lines = content.split(/\r?\n/);

    let title = '';
    let startTime = '';
    let endTime = '';
    let meetingId = '';

    // Find summary section and extract key-value pairs
    let inSummary = false;
    for (const line of lines) {
      if (line.match(/^1\.\s*Summary/i) || line.match(/^Summary/i)) {
        inSummary = true;
        continue;
      }
      if (line.match(/^2\.\s*Participants/i) || line.match(/^Participants/i)) {
        break;
      }

      if (inSummary && line.trim()) {
        const parts = line.split('\t');
        const key = parts[0]?.trim().toLowerCase();
        const value = parts[1]?.trim() || '';

        if (key === 'meeting title' || key === 'title') {
          title = value;
        } else if (key === 'start time') {
          startTime = value;
        } else if (key === 'end time') {
          endTime = value;
        } else if (key === 'meeting id' || key === 'id') {
          meetingId = value;
        }
      }
    }

    // Generate meeting ID from title + start time if not explicitly provided
    if (!meetingId) {
      meetingId = `teams_${title}_${startTime}`.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
    }

    // If we couldn't find a title, use filename
    if (!title) {
      title = fileName.replace(/\.csv$/i, '').replace(/meetingAttendanceReport/i, '').trim() || 'Unknown Meeting';
    }

    // Parse dates - handle multiple locale formats
    const parsedStart = this.parseTeamsDateTime(startTime);
    const parsedEnd = this.parseTeamsDateTime(endTime);

    if (!parsedStart || !parsedEnd) {
      throw new Error(`Could not parse meeting times: start="${startTime}", end="${endTime}"`);
    }

    return {
      meetingId,
      title,
      startTime: parsedStart,
      endTime: parsedEnd,
    };
  }

  /**
   * Parse the Participants section of a Teams native CSV
   */
  private parseParticipantsSection(content: string): ParsedParticipant[] {
    const lines = content.split(/\r?\n/);
    const participants: ParsedParticipant[] = [];

    let inParticipants = false;
    let headerParsed = false;
    let columnMap: Record<string, number> = {};

    for (const line of lines) {
      // Detect start of participants section
      if (line.match(/^2\.\s*Participants/i) || line.match(/^Participants/i)) {
        inParticipants = true;
        continue;
      }

      // Detect end of participants section (any subsequent numbered section)
      if (inParticipants && line.match(/^\d+\.\s+/)) {
        break;
      }

      if (!inParticipants || !line.trim()) continue;

      const columns = line.split('\t');

      // Parse header row
      if (!headerParsed) {
        columnMap = this.buildColumnMap(columns);
        headerParsed = true;
        continue;
      }

      // Parse data row
      const participant = this.parseParticipantRow(columns, columnMap);
      if (participant) {
        participants.push(participant);
      }
    }

    return participants;
  }

  /**
   * Build a column index map from header row
   */
  private buildColumnMap(headers: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    headers.forEach((header, index) => {
      const normalized = header.trim().toLowerCase();
      if (normalized.includes('full name') || normalized === 'name' || normalized.includes('participant')) {
        map['name'] = index;
      } else if (normalized.includes('first join') || normalized.includes('join time')) {
        map['firstJoin'] = index;
      } else if (normalized.includes('last leave') || normalized.includes('leave time')) {
        map['lastLeave'] = index;
      } else if (normalized.includes('duration') || normalized.includes('in-meeting duration')) {
        map['duration'] = index;
      } else if (normalized.includes('email') || normalized.includes('upn')) {
        map['email'] = index;
      } else if (normalized.includes('role')) {
        map['role'] = index;
      } else if (normalized.includes('participant id')) {
        // Sometimes the email is in "Participant ID (UPN)" column
        if (!map['email']) {
          map['email'] = index;
        }
      }
    });
    return map;
  }

  /**
   * Parse a single participant data row
   */
  private parseParticipantRow(columns: string[], columnMap: Record<string, number>): ParsedParticipant | null {
    try {
      const name = columns[columnMap['name']]?.trim();
      const firstJoinStr = columns[columnMap['firstJoin']]?.trim();
      const lastLeaveStr = columns[columnMap['lastLeave']]?.trim();
      const durationStr = columns[columnMap['duration']]?.trim();
      const email = columns[columnMap['email']]?.trim() || '';
      const role = columns[columnMap['role']]?.trim() || 'Attendee';

      if (!name || !firstJoinStr) return null;

      const firstJoin = this.parseTeamsDateTime(firstJoinStr);
      const lastLeave = this.parseTeamsDateTime(lastLeaveStr || firstJoinStr);
      const durationMinutes = this.parseDuration(durationStr || '');

      if (!firstJoin || !lastLeave) return null;

      return {
        fullName: name,
        firstJoin,
        lastLeave,
        durationMinutes,
        email,
        role,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse a flat CSV format (simple comma-separated with headers)
   * Fallback for non-Teams-native CSVs
   */
  private parseFlatCSV(content: string, fileName: string): { meeting: ParsedMeetingInfo; participants: ParsedParticipant[] } {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    // Detect separator (comma or tab)
    const separator = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(separator).map(h => h.trim().toLowerCase());

    // Build column map from headers
    const colMap: Record<string, number> = {};
    headers.forEach((h, i) => {
      if (h.includes('name') || h.includes('participant')) colMap['name'] = i;
      if (h.includes('join') && !h.includes('leave')) colMap['firstJoin'] = i;
      if (h.includes('leave')) colMap['lastLeave'] = i;
      if (h.includes('duration')) colMap['duration'] = i;
      if (h.includes('email') || h.includes('upn')) colMap['email'] = i;
      if (h.includes('role')) colMap['role'] = i;
      if (h.includes('meeting') && h.includes('title')) colMap['meetingTitle'] = i;
      if (h.includes('meeting') && h.includes('start')) colMap['meetingStart'] = i;
      if (h.includes('meeting') && h.includes('end')) colMap['meetingEnd'] = i;
      if (h.includes('meeting') && h.includes('id')) colMap['meetingId'] = i;
    });

    const participants: ParsedParticipant[] = [];
    let meetingTitle = fileName.replace(/\.csv$/i, '');
    let meetingStart: Date | null = null;
    let meetingEnd: Date | null = null;
    let meetingId = '';

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(separator).map(c => c.trim());
      if (cols.length < 2) continue;

      // Extract meeting info from first data row if available
      if (i === 1) {
        if (colMap['meetingTitle'] !== undefined) meetingTitle = cols[colMap['meetingTitle']] || meetingTitle;
        if (colMap['meetingStart'] !== undefined) meetingStart = this.parseTeamsDateTime(cols[colMap['meetingStart']]);
        if (colMap['meetingEnd'] !== undefined) meetingEnd = this.parseTeamsDateTime(cols[colMap['meetingEnd']]);
        if (colMap['meetingId'] !== undefined) meetingId = cols[colMap['meetingId']] || '';
      }

      const name = cols[colMap['name']]?.trim();
      const joinStr = cols[colMap['firstJoin']]?.trim();
      if (!name || !joinStr) continue;

      const firstJoin = this.parseTeamsDateTime(joinStr);
      const lastLeave = colMap['lastLeave'] !== undefined
        ? this.parseTeamsDateTime(cols[colMap['lastLeave']]?.trim() || joinStr)
        : firstJoin;
      const durationStr = colMap['duration'] !== undefined ? cols[colMap['duration']]?.trim() : '';
      const email = colMap['email'] !== undefined ? cols[colMap['email']]?.trim() || '' : '';
      const role = colMap['role'] !== undefined ? cols[colMap['role']]?.trim() || 'Attendee' : 'Attendee';

      if (!firstJoin || !lastLeave) continue;

      const durationMinutes = durationStr ? this.parseDuration(durationStr) : Math.round((lastLeave.getTime() - firstJoin.getTime()) / 60000);

      participants.push({ fullName: name, firstJoin, lastLeave, durationMinutes, email, role });
    }

    // Use first/last participant times as meeting times if not found
    if (!meetingStart && participants.length > 0) {
      meetingStart = new Date(Math.min(...participants.map(p => p.firstJoin.getTime())));
    }
    if (!meetingEnd && participants.length > 0) {
      meetingEnd = new Date(Math.max(...participants.map(p => p.lastLeave.getTime())));
    }

    if (!meetingId) {
      meetingId = `teams_${meetingTitle}_${meetingStart?.toISOString() || ''}`.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
    }

    return {
      meeting: {
        meetingId,
        title: meetingTitle,
        startTime: meetingStart || new Date(),
        endTime: meetingEnd || new Date(),
      },
      participants,
    };
  }

  /**
   * Parse Teams datetime strings (locale-dependent)
   * Handles formats like:
   *   "5/04/26, 4:21:32 PM"  (D/MM/YY - Australian)
   *   "1/15/2024, 9:00:00 AM" (M/D/YYYY - US)
   *   "15/01/2024 09:00:00"   (D/M/YYYY - European)
   *   "2024-01-15T09:00:00Z"  (ISO)
   */
  parseTeamsDateTime(dateStr: string): Date | null {
    if (!dateStr || !dateStr.trim()) return null;

    const trimmed = dateStr.trim();

    // Try ISO format first
    if (trimmed.includes('T')) {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d;
    }

    // Match: D/MM/YY, H:MM:SS AM/PM  or  M/DD/YY, H:MM:SS AM/PM  or  D/MM/YYYY, H:MM:SS AM/PM
    const slashFormat = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
    );
    if (slashFormat) {
      let [, part1, part2, yearStr, hours, minutes, seconds, ampm] = slashFormat;

      let year = parseInt(yearStr);
      // Handle 2-digit year
      if (year < 100) {
        year += 2000;
      }

      // Determine if D/M/Y (Australian/European) or M/D/Y (US)
      // Heuristic: if part2 > 12, it must be a day (so part1 is month - US format)
      // If part1 > 12, it must be a day (so part2 is month - EU/AU format)
      // If both <= 12, assume D/M/Y (Australian) since that's the user's locale
      let day: number, month: number;
      const p1 = parseInt(part1);
      const p2 = parseInt(part2);

      if (p2 > 12) {
        // part2 must be day, part1 is month (US: M/D/Y)
        month = p1;
        day = p2;
      } else if (p1 > 12) {
        // part1 must be day, part2 is month (EU/AU: D/M/Y)
        day = p1;
        month = p2;
      } else {
        // Ambiguous - default to D/M/Y (Australian format)
        day = p1;
        month = p2;
      }

      let h = parseInt(hours);
      if (ampm?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;

      return new Date(year, month - 1, day, h, parseInt(minutes), parseInt(seconds || '0'));
    }

    // Try native Date parsing as last resort
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;

    return null;
  }

  /**
   * Parse Teams duration strings
   * Handles: "0h 48m 0s", "48m", "1h 30m", "45", "2700" (seconds as string)
   */
  parseDuration(durationStr: string): number {
    if (!durationStr) return 0;

    const trimmed = durationStr.trim();

    // Format: "Xh Ym Zs"
    const hmsMatch = trimmed.match(/(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/);
    if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
      const hours = parseInt(hmsMatch[1] || '0');
      const minutes = parseInt(hmsMatch[2] || '0');
      const seconds = parseInt(hmsMatch[3] || '0');
      return hours * 60 + minutes + Math.round(seconds / 60);
    }

    // Pure number - could be minutes or seconds
    const numericValue = parseInt(trimmed);
    if (!isNaN(numericValue)) {
      // If > 300, assume seconds; otherwise assume minutes
      return numericValue > 300 ? Math.round(numericValue / 60) : numericValue;
    }

    return 0;
  }

  /**
   * Extract class code from a meeting title.
   * Looks for patterns like "11SENX", "12SENX2", "7MATX3" - digits followed by uppercase letters,
   * optionally ending with a class number.
   * Pattern: [YearLevel][SubjectCode][ClassNumber?] e.g. 11SEN, 12SENX2, 7MAT3, 10ENG
   */
  extractClassCode(title: string): string | null {
    if (!title) return null;
    // Match 1-2 digits followed by 2+ uppercase letters, optionally ending with a digit
    const match = title.match(/\b(\d{1,2}[A-Z]{2,}\d?)\b/);
    return match ? match[1] : null;
  }

  /**
   * Determine attendance status based on join time relative to meeting start
   * Mirrors logic from csv-import.service.ts
   */
  private determineStatus(joinTime: Date, meetingStart: Date, durationMinutes?: number): AttendanceStatus {
    const lateThresholdMs = 10 * 60 * 1000; // 10 minutes
    const timeDiff = joinTime.getTime() - meetingStart.getTime();

    if (timeDiff > lateThresholdMs) {
      return AttendanceStatus.LATE;
    }

    if (durationMinutes && durationMinutes < 30) {
      return AttendanceStatus.PARTIAL;
    }

    return AttendanceStatus.PRESENT;
  }
}

export const teamsCSVParserService = new TeamsCSVParserService();
