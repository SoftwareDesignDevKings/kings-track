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

export interface SyncProgress {
  sync_type: string
  started_at: string
  phase: string
  current_course_id: number | null
  current_step: string | null
  total_courses: number
  completed_courses: number
  pending_course_ids: number[]
  completed_course_ids: number[]
  total_steps: number | null
  completed_steps: number
  includes_edstem: boolean
}

export interface SyncStatus {
  is_running: boolean
  progress: SyncProgress | null
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

export interface HealthResponse {
  status: string
  canvas_configured: boolean
  edstem_configured: boolean
}

// ─── EdStem lesson matrix ─────────────────────────────────────────────────────

export type EdStemLessonStatus = 'completed' | 'viewed' | 'not_started'

export interface EdStemLesson {
  id: number
  title: string
  is_interactive: boolean
}

export interface EdStemModule {
  name: string
  lessons: EdStemLesson[]
}

export interface EdStemStudentProgress {
  status: EdStemLessonStatus
  completed_at: string | null
}

export interface EdStemStudentRow {
  id: number
  name: string
  sortable_name: string | null
  completion_rate: number | null
  progress: Record<string, EdStemStudentProgress>
}

export interface EdStemMatrix {
  mapped: boolean
  edstem_course_id?: number
  edstem_course_name?: string
  modules?: EdStemModule[]
  students?: EdStemStudentRow[]
}

// ─── EdStem admin ─────────────────────────────────────────────────────────────

export interface EdStemCourseMapping {
  canvas_course_id: number
  canvas_course_name: string
  edstem_course_id: number
  edstem_course_name: string
  created_at: string | null
}

export interface EdStemAvailableCourse {
  id: number
  name: string
  code: string
}
