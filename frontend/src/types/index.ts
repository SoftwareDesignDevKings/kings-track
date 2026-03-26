// ─── Submission status ───────────────────────────────────────────────────────

export type SubmissionStatus = 'completed' | 'in_progress' | 'not_started' | 'excused'

// ─── Course overview ─────────────────────────────────────────────────────────

export interface Course {
  id: number
  name: string
  course_code: string | null
  workflow_state: string | null
  last_synced: string | null
  student_count: number
  avg_completion_rate: number | null
  avg_on_time_rate: number | null
  avg_current_score: number | null
}

// ─── Activity matrix ─────────────────────────────────────────────────────────

export interface MatrixAssignment {
  id: number
  name: string
  points_possible: number | null
  due_at: string | null
}

export interface AssignmentGroup {
  name: string
  assignments: MatrixAssignment[]
}

export interface StudentSubmission {
  status: SubmissionStatus
  score: number | null
  late: boolean
  missing: boolean
}

export interface StudentMetrics {
  completion_rate: number | null
  on_time_rate: number | null
  current_score: number | null
}

export interface StudentRow {
  id: number
  name: string
  sortable_name: string | null
  submissions: Record<string, StudentSubmission>
  metrics: StudentMetrics
}

export interface CourseMatrix {
  course_id: number
  course_name: string
  course_code: string | null
  assignment_groups: AssignmentGroup[]
  students: StudentRow[]
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface SyncLogEntry {
  entity_type: string
  course_id: number | null
  status: string
  records_synced: number
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export interface SyncStatus {
  is_running: boolean
  logs: SyncLogEntry[]
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AppUser {
  id: number
  email: string
  role: 'admin' | 'teacher'
  created_at: string | null
}

export interface WhitelistedCourse {
  course_id: number
  name: string
  course_code: string | null
  added_at: string | null
}

export interface AvailableCourse {
  id: number
  name: string
  course_code: string | null
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface IntegrationStatus {
  name: string
  enabled: boolean
  status: string
}

export interface HealthResponse {
  status: string
  canvas_configured: boolean
  integrations: IntegrationStatus[]
}
