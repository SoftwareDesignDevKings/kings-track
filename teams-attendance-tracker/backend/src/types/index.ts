/**
 * Core type definitions for the application
 */

export interface Student {
  id: string;
  email: string;
  name: string;
  student_id?: string;
  azure_ad_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Meeting {
  id: string;
  teams_meeting_id: string;
  title?: string;
  start_time: Date;
  end_time: Date;
  organizer_email?: string;
  meeting_url?: string;
  class_code?: string;
  created_at: Date;
}

export interface AttendanceRecord {
  id: string;
  meeting_id: string;
  student_id: string;
  join_time: Date;
  leave_time?: Date;
  duration_minutes?: number;
  status: AttendanceStatus;
  created_at: Date;
}

export enum AttendanceStatus {
  PRESENT = 'present',
  LATE = 'late',
  ABSENT = 'absent',
  PARTIAL = 'partial'
}

export interface CreateStudentDTO {
  email: string;
  name: string;
  student_id?: string;
  azure_ad_id?: string;
}

export interface CreateMeetingDTO {
  teams_meeting_id: string;
  title?: string;
  start_time: Date;
  end_time: Date;
  organizer_email?: string;
  meeting_url?: string;
  class_code?: string;
}

export interface CreateAttendanceRecordDTO {
  meeting_id: string;
  student_id: string;
  join_time: Date;
  leave_time?: Date;
  duration_minutes?: number;
  status: AttendanceStatus;
}

export interface AttendanceReportFilter {
  student_id?: string;
  meeting_id?: string;
  start_date?: Date;
  end_date?: Date;
  status?: AttendanceStatus;
}

export interface GraphTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface GraphAttendanceRecord {
  emailAddress: string;
  totalAttendanceInSeconds: number;
  role: string;
  identity: {
    id: string;
    displayName: string;
    tenantId: string;
  };
  attendanceIntervals: Array<{
    joinDateTime: string;
    leaveDateTime: string;
    durationInSeconds: number;
  }>;
}

export interface GraphMeeting {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  onlineMeeting: {
    joinUrl: string;
  };
  organizer: {
    emailAddress: {
      address: string;
      name: string;
    };
  };
}
