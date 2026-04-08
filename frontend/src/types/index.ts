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
  auth_source?: 'local' | 'supabase' | 'extension_api_key' | null
  auth_mode?: string
  local_auth?: boolean
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

export interface ExtensionApiKeyStatus {
  has_key: boolean
  key_hint: string | null
  created_at: string | null
  last_used_at: string | null
}

export interface ExtensionApiKeyResponse extends ExtensionApiKeyStatus {
  api_key: string
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

// ─── Gradeo admin ─────────────────────────────────────────────────────────────

export interface GradeoStudentDirectoryStatus {
  last_synced_at: string | null
  matched_students: number
  stale: boolean
}

export interface GradeoCourseCandidate {
  course_id: number
  name: string
  course_code: string | null
}

export interface GradeoDiscoveredClass {
  gradeo_class_id: string
  name: string
  discovered_at: string | null
  last_seen_at: string | null
  canvas_course_id: number | null
  canvas_course_name: string | null
  canvas_course_code: string | null
  last_imported_at: string | null
  suggested_course: GradeoCourseCandidate | null
  candidate_courses: GradeoCourseCandidate[]
}

export interface GradeoClassMapping {
  canvas_course_id: number
  canvas_course_name: string
  canvas_course_code: string | null
  gradeo_class_id: string
  gradeo_class_name: string
  created_at: string | null
}

export interface GradeoImportRun {
  id: number
  run_type: string
  status: string
  canvas_course_id: number | null
  gradeo_class_id: string | null
  gradeo_class_name: string | null
  triggered_by: string | null
  source_type: string | null
  extension_version: string | null
  processed_students: number
  matched_students: number
  imported_exams: number
  imported_question_results: number
  unmatched_students: number
  skipped_students: number
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

// ─── Gradeo course report ─────────────────────────────────────────────────────

export type GradeoResultStatus = 'not_submitted' | 'awaiting_marking' | 'scored'

export interface GradeoExam {
  id: string
  name: string
  class_average: number | null
  syllabus_title: string | null
  syllabus_grade: string | null
  bands: string[]
  outcomes: string[]
  topics: string[]
}

export interface GradeoQuestionResult {
  gradeo_question_part_id: string
  question: string | null
  question_part: string | null
  mark: number | null
  marks_available: number | null
  answer_submitted: boolean
  feedback: string | null
  marker_name: string | null
  question_link: string | null
  marking_session_link: string | null
}

export interface GradeoStudentExamResult {
  status: GradeoResultStatus
  exam_mark: number | null
  marks_available: number | null
  class_average: number | null
  questions: GradeoQuestionResult[]
}

export interface GradeoStudentRow {
  id: number
  name: string
  sortable_name: string | null
  completion_rate: number | null
  results: Record<string, GradeoStudentExamResult | null>
}

export interface GradeoCourseReport {
  mapped: boolean
  gradeo_class_id?: string
  gradeo_class_name?: string
  last_imported_at?: string | null
  unmatched_students_count?: number
  exams?: GradeoExam[]
  students?: GradeoStudentRow[]
}
