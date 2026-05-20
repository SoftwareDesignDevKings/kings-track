/**
 * Core type definitions for the frontend
 */

export interface Student {
  id: string;
  email: string;
  name: string;
  student_id?: string;
  azure_ad_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  teams_meeting_id: string;
  title?: string;
  start_time: string;
  end_time: string;
  organizer_email?: string;
  meeting_url?: string;
  class_code?: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  meeting_id: string;
  student_id: string;
  join_time: string;
  leave_time?: string;
  duration_minutes?: number;
  status: 'present' | 'late' | 'absent' | 'partial';
  created_at: string;
  student_name?: string;
  student_email?: string;
  meeting_title?: string;
  start_time?: string;
  end_time?: string;
}

export interface AttendanceStats {
  total_meetings: number;
  present: number;
  late: number;
  absent: number;
  attendance_rate: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  count?: number;
}

export interface ApiError {
  success: false;
  message: string;
  errors?: any[];
}

export interface MeetingAttendanceSummary {
  meeting: Meeting;
  total_attendees: number;
  present: number;
  late: number;
  partial: number;
  records: AttendanceRecord[];
}

export interface StudentAttendanceSummary {
  student: Student;
  stats: AttendanceStats;
  recent_records: AttendanceRecord[];
}

export interface SyncRequest {
  user_id: string;
  days_back?: number;
}
