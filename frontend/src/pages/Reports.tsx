import { useState } from 'react'
import Header from '../components/Header'
import { useCourses, useStudents, useCourseCycles } from '../services/api'
import { downloadFile, previewPdf } from '../lib/downloadCsv'

interface ReportCardProps {
  title: string
  description: string
  path: string
  fallbackName: string
  disabled?: boolean
  disabledReason?: string
  formats?: ('csv' | 'pdf')[]
}

function ReportCard({ title, description, path, fallbackName, disabled, disabledReason, formats = ['csv', 'pdf'] }: ReportCardProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasCsv = formats.includes('csv')
  const hasPdf = formats.includes('pdf')

  async function handleDownload(fmt: 'csv' | 'pdf') {
    setBusy(fmt)
    setError(null)
    try {
      const sep = path.includes('?') ? '&' : '?'
      await downloadFile(`${path}${sep}format=${fmt}`, `${fallbackName}.${fmt}`)
    } catch (e) {
      if (e instanceof Error) {
        if (e.message.includes('422')) {
          setError('Too many columns for PDF. Use CSV instead.')
        } else if (e.message.includes('404')) {
          setError('No data available for this report.')
        } else {
          setError(`Download failed: ${e.message.slice(0, 120)}`)
        }
      }
    } finally {
      setBusy(null)
    }
  }

  async function handlePreview() {
    setBusy('preview')
    setError(null)
    try {
      await previewPdf(path, title)
    } catch (e) {
      if (e instanceof Error) {
        if (e.message.includes('422')) {
          setError('Too many columns for PDF preview. Use CSV instead.')
        } else if (e.message.includes('404')) {
          setError('No data available for this report.')
        } else {
          setError(`Preview failed: ${e.message.slice(0, 120)}`)
        }
      }
    } finally {
      setBusy(null)
    }
  }

  const btnClass = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 flex flex-col ${disabled ? 'opacity-50' : ''}`}>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 mt-1 flex-1">{description}</p>
      {disabled ? (
        <p className="text-xs text-slate-400 mt-3 italic">{disabledReason}</p>
      ) : (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={handlePreview} disabled={!!busy} className={btnClass}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {busy === 'preview' ? 'Opening\u2026' : 'Preview'}
          </button>
          {hasCsv && (
            <button type="button" onClick={() => handleDownload('csv')} disabled={!!busy} className={btnClass}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
              </svg>
              {busy === 'csv' ? 'Downloading\u2026' : 'CSV'}
            </button>
          )}
          {hasPdf && (
            <button type="button" onClick={() => handleDownload('pdf')} disabled={!!busy} className={btnClass}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
              </svg>
              {busy === 'pdf' ? 'Downloading\u2026' : 'PDF'}
            </button>
          )}
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}

export default function Reports() {
  const { data: courses } = useCourses()
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null)

  // Student report state
  const { data: students } = useStudents()
  const [pdfStudentId, setPdfStudentId] = useState<number | null>(null)
  const [pdfCourseId, setPdfCourseId] = useState<number | null>(null)
  const [pdfCycleNum, setPdfCycleNum] = useState<number | null>(null)
  const { data: cycles, isLoading: cyclesLoading } = useCourseCycles(pdfCourseId)

  // Filter courses by student enrollment
  const selectedStudent = students?.find(s => s.id === pdfStudentId)
  const studentCourses = selectedStudent
    ? courses?.filter(c => selectedStudent.courses.some(sc => sc.id === c.id))
    : courses

  const selectedCourse = courses?.find(c => c.id === selectedCourseId)
  const courseCode = selectedCourse
    ? (selectedCourse.course_code ?? '').replace(/\s+/g, '-') || String(selectedCourse.id)
    : ''
  const isEncCourse = selectedCourse?.course_code
    ? /ENC/i.test(selectedCourse.course_code)
    : false

  function handleStudentChange(id: number | null) {
    setPdfStudentId(id)
    if (id && pdfCourseId) {
      const student = students?.find(s => s.id === id)
      if (student && !student.courses.some(c => c.id === pdfCourseId)) {
        setPdfCourseId(null)
        setPdfCycleNum(null)
      }
    }
  }

  const cyclePart = pdfCycleNum ? `&cycle_num=${pdfCycleNum}` : ''

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Reports</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Preview, download as CSV or PDF.
          </p>
        </div>

        {/* Platform Reports */}
        <section className="mb-8">
          <h3 className="text-base font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-200">
            Platform Reports
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ReportCard
              title="Student Progress Report"
              description="Every student across all courses. Includes name, email, SIS ID, course count, average completion rate, on-time rate, score, attendance rate, concern level, and concern reasons."
              path="/reports/student-progress"
              fallbackName="student-progress-report"
            />
            <ReportCard
              title="At-Risk Students"
              description="Only students flagged as moderate or high concern, sorted by severity. Same columns as Student Progress: completion, on-time, score, attendance, and the specific concern reasons."
              path="/reports/at-risk-students"
              fallbackName="at-risk-students"
            />
            <ReportCard
              title="Attendance Summary"
              description="Per-student attendance breakdown across all meetings. Columns: name, email, SIS ID, total meetings, present, late, partial, absent, and overall attendance rate."
              path="/reports/attendance-summary"
              fallbackName="attendance-summary"
            />
          </div>
        </section>

        {/* Course Reports */}
        <section>
          <h3 className="text-base font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-200">
            Course Reports
          </h3>

          <div className="mb-5">
            <select
              value={selectedCourseId ?? ''}
              onChange={e => {
                const val = e.target.value
                setSelectedCourseId(val ? Number(val) : null)
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-md"
            >
              <option value="">Select a course</option>
              {courses?.map(c => (
                <option key={c.id} value={c.id}>
                  {c.course_code ? `${c.course_code} — ${c.name}` : c.name}
                </option>
              ))}
            </select>
          </div>

          {selectedCourseId ? (
            <div key={selectedCourseId} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ReportCard
                title="Class List"
                description="Enrolled student roster for this course. Columns: first name, last name, and email address."
                path={`/reports/courses/${selectedCourseId}/class-list`}
                fallbackName={`${courseCode}-class-list`}
              />
              <ReportCard
                title="Class Report"
                description="Assignment completion matrix. One row per student, one column per assignment showing score or submission status (submitted, graded, missing). Best exported as CSV for courses with many assignments."
                path={`/reports/courses/${selectedCourseId}/class-report`}
                fallbackName={`${courseCode}-class-report`}
              />
              <ReportCard
                title="Course Attendance"
                description="Attendance record for every meeting in this course. One row per student with their attendance rate and status (present, late, partial, absent) for each meeting date."
                path={`/reports/courses/${selectedCourseId}/attendance-report`}
                fallbackName={`${courseCode}-attendance`}
              />
              <ReportCard
                title="Gradeo Topic Bands"
                description="Gradeo assessment results by topic. One row per student showing predicted band and score percentage for each assessed topic."
                path={`/reports/courses/${selectedCourseId}/gradeo-report`}
                fallbackName={`${courseCode}-gradeo-report`}
              />
              {!isEncCourse && (
                <ReportCard
                  title="EdStem Progress"
                  description="EdStem lesson completion for each student. One column per lesson showing status (completed, in_progress, not_started) with student name, email, and SIS ID."
                  path={`/reports/courses/${selectedCourseId}/edstem-report`}
                  fallbackName={`${courseCode}-edstem-report`}
                />
              )}
              <ReportCard
                title="Whole-Class Cycle Update"
                description="One PDF per student in this course, combined into a single document with page breaks. Each page shows the student's current cycle progress, scores, missing work, Gradeo results, and EdStem completion."
                path={`/reports/courses/${selectedCourseId}/class-cycle-pdf`}
                fallbackName={`${courseCode}-class-cycle-update`}
                formats={['pdf']}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">
              Select a course to see available course reports.
            </p>
          )}
        </section>

        {/* Student Reports */}
        <section className="mt-8">
          <h3 className="text-base font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-200">
            Student Reports
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Generate reports for individual students. PDF reports can be shared with parents.
          </p>

          <div className="flex flex-wrap items-end gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Student</label>
              <select
                value={pdfStudentId ?? ''}
                onChange={e => handleStudentChange(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-xs"
              >
                <option value="">Select a student</option>
                {students?.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Course</label>
              <select
                value={pdfCourseId ?? ''}
                onChange={e => {
                  setPdfCourseId(e.target.value ? Number(e.target.value) : null)
                  setPdfCycleNum(null)
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-xs"
              >
                <option value="">{pdfStudentId && studentCourses?.length === 0 ? 'No courses for this student' : 'Select a course'}</option>
                {studentCourses?.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.course_code ? `${c.course_code} — ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Cycle (optional)</label>
              <select
                value={pdfCycleNum ?? ''}
                onChange={e => setPdfCycleNum(e.target.value ? Number(e.target.value) : null)}
                disabled={!pdfCourseId || cyclesLoading}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-xs disabled:opacity-50"
              >
                <option value="">Auto-detect (current)</option>
                {cycles?.map(c => (
                  <option key={c.cycle_num} value={c.cycle_num}>
                    Cycle {c.cycle_num} — {c.topic}
                    {c.start_week && c.end_week ? ` (T${c.term}: W${c.start_week}-${c.end_week})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {pdfStudentId ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ReportCard
                title={pdfCycleNum ? `Cycle ${pdfCycleNum} Update` : 'Current Cycle Update'}
                description="PDF for the selected teaching cycle. Shows completion metrics (completed, missing, avg score), assignment table with due dates, scores, and late flags, Gradeo quiz results, EdStem lesson completion, and other units overview. Suitable for sharing with parents."
                path={`/reports/students/${pdfStudentId}/cycle-update-pdf?course_id=${pdfCourseId}${cyclePart}`}
                fallbackName="cycle-update"
                disabled={!pdfCourseId}
                disabledReason="Select a course above"
                formats={['pdf']}
              />
              <ReportCard
                title="Missing Work Report"
                description={pdfCourseId
                  ? "PDF listing outstanding work for this student in the selected course. Includes missing Canvas assignments, incomplete EdStem lessons, flagged Gradeo assessments, and assessment tracking."
                  : "PDF listing all outstanding work for this student across every enrolled course. Select a course above to filter to a single course."
                }
                path={pdfCourseId
                  ? `/reports/students/${pdfStudentId}/missing-report-pdf?course_id=${pdfCourseId}`
                  : `/reports/students/${pdfStudentId}/missing-report-pdf`
                }
                fallbackName="missing-report"
                formats={['pdf']}
              />
              <ReportCard
                title="Complete Student Report"
                description="Full progress report for this student in the selected course. Includes all assignment scores, assessment tracking with rubric criteria, Gradeo results, EdStem progress, and attendance records."
                path={`/reports/students/${pdfStudentId}/student-report-pdf?course_id=${pdfCourseId}`}
                fallbackName="student-report"
                disabled={!pdfCourseId}
                disabledReason="Select a course above"
                formats={['pdf']}
              />
              <ReportCard
                title="Full Student Report"
                description="Multi-section CSV with everything for one student: personal info, overview metrics, per-course completion/on-time/score, submission counts (total, submitted, graded, late, missing), attendance breakdown, recent attendance log, and concern status."
                path={`/reports/students/${pdfStudentId}/report`}
                fallbackName="student-report"
                formats={['csv']}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">
              Select a student to see available reports.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
