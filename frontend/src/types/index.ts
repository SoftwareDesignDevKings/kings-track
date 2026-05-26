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

// ─── Engagement ──────────────────────────────────────────────────────────────

export interface CourseEngagementStudent {
  id: number
  name: string
  sortable_name: string | null
  page_views: number | null
  page_views_level: number | null   // 0–3 Canvas bucket
  max_page_views: number | null
  participations: number | null
  participations_level: number | null
  max_participations: number | null
  tardiness_on_time: number | null
  tardiness_late: number | null
  tardiness_missing: number | null
  total_activity_time_seconds: number | null
  last_activity_at: string | null
}

export interface CourseActivityDay {
  date: string
  views: number | null
  participations: number | null
}

export interface CourseEngagement {
  course_id: number
  course_name: string
  synced_at: string | null
  students: CourseEngagementStudent[]
  course_activity: CourseActivityDay[]
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
  auth_source?: 'local' | 'supabase' | null
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

// ─── Health ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string
  canvas_configured: boolean
  edstem_configured: boolean
}

export interface CanvasHealthResponse {
  up: boolean
  configured: boolean
  status: number | null
  reason: string
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
  gradeo_classes?: Array<{ gradeo_class_id: string; gradeo_class_name: string }>
  last_imported_at?: string | null
  unmatched_students_count?: number
  exams?: GradeoExam[]
  students?: GradeoStudentRow[]
  hidden_students?: Array<{ id: number; name: string }>
}

// ─── Gradeo topic bands ──────────────────────────────────────────────────────

export type GradeoTopicBandConfidence = 'low' | 'medium' | 'high'

export interface GradeoTopicSummary {
  name: string
  student_count: number
  average_score_pct: number
}

export interface GradeoTopicBandCell {
  score_pct: number
  predicted_band: number
  confidence: GradeoTopicBandConfidence
  earned_marks: number
  available_marks: number
  exam_count: number
  part_count: number
}

export interface GradeoTopicBandStudent {
  id: number
  name: string
  sortable_name: string | null
  topics: Record<string, GradeoTopicBandCell>
}

export interface GradeoTopicBands {
  mapped: boolean
  gradeo_class_id?: string
  gradeo_class_name?: string
  topics?: GradeoTopicSummary[]
  students?: GradeoTopicBandStudent[]
}

// ─── Student listing ──────────────────────────────────────────────────────────

export interface StudentConcern {
  is_concern: boolean
  level: 'none' | 'moderate' | 'high'
  reasons: string[]
}

export interface StudentListItem {
  id: number
  name: string
  email: string
  sis_id: string | null
  course_count: number
  courses: Array<{ id: number; name: string }>
  avg_completion_rate: number | null
  avg_on_time_rate: number | null
  avg_score: number | null
  attendance_rate: number | null
  concern: StudentConcern
}

// ─── Student profile ──────────────────────────────────────────────────────────

export interface StudentInfo {
  id: number
  name: string
  email: string
  sis_id: string | null
  sortable_name: string | null
}

export interface StudentOverview {
  avg_completion_rate: number | null
  avg_on_time_rate: number | null
  avg_score: number | null
  attendance_rate: number | null
  total_courses: number
}

export interface StudentCourseMetrics {
  course_id: number
  course_name: string
  course_code: string | null
  completion_rate: number | null
  on_time_rate: number | null
  current_score: number | null
  last_activity_at: string | null
}

export interface StudentSubmissionStats {
  total: number
  submitted: number
  graded: number
  late: number
  missing: number
}

export interface AttendanceSummary {
  total_meetings: number
  present: number
  late: number
  partial: number
  absent: number
  attendance_rate: number | null
}

export interface AttendanceByClass {
  class_code: string
  total: number
  present: number
  late: number
  partial: number
  rate: number | null
}

export interface RecentAttendanceRecord {
  meeting_id: number
  meeting_title: string
  date: string | null
  class_code: string | null
  join_time: string | null
  leave_time: string | null
  duration_minutes: number | null
  status: string
}

export interface StudentProfileData {
  student: StudentInfo
  overview: StudentOverview
  concern: StudentConcern
  courses: StudentCourseMetrics[]
  submission_stats: Record<string, StudentSubmissionStats>
  attendance_summary: AttendanceSummary
  attendance_by_class: AttendanceByClass[]
  recent_attendance: RecentAttendanceRecord[]
}

// ─── Student learning overview ────────────────────────────────────────────────

export interface CanvasGroupBreakdown {
  group_name: string
  total: number
  submitted: number
  graded: number
  late: number
  missing: number
  avg_score: number | null
  avg_points_possible: number | null
}

export interface CanvasCourseBreakdown {
  course_name: string
  course_code: string | null
  groups: CanvasGroupBreakdown[]
}

export interface EdStemModuleBreakdown {
  module_name: string
  total_lessons: number
  completed: number
  viewed: number
  not_started: number
}

export interface EdStemCourseBreakdown {
  course_name: string
  course_code: string | null
  modules: EdStemModuleBreakdown[]
}

export interface GradeoExamBreakdown {
  exam_name: string
  syllabus_title: string | null
  topics: string[]
  status: string
  exam_mark: number | null
  marks_available: number | null
  class_average: number | null
}

export interface GradeoCourseBreakdown {
  course_name: string
  course_code: string | null
  exams: GradeoExamBreakdown[]
}

export interface StrugglingArea {
  area: string
  source: 'canvas' | 'edstem' | 'gradeo'
  course_name: string
  detail: string
  score_pct: number
}

export interface StudentLearningOverview {
  canvas: Record<string, CanvasCourseBreakdown>
  edstem: Record<string, EdStemCourseBreakdown>
  gradeo: Record<string, GradeoCourseBreakdown>
  struggling_areas: StrugglingArea[]
}
