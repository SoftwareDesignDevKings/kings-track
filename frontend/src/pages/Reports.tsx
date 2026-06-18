import { useState } from 'react'
import Header from '../components/Header'
import { useCourses, useStudents } from '../services/api'
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

/** Extract the detail message from a backend error response. */
function extractApiDetail(e: Error): string {
  // FastAPI errors are JSON: {"detail":"..."} — try to extract
  const match = e.message.match(/"detail"\s*:\s*"([^"]+)"/)
  if (match) return match[1]
  // Fallback: strip the prefix ("Download failed (404): ...")
  const stripped = e.message.replace(/^(?:Download|Preview) failed \(\d+\):\s*/, '')
  return stripped.slice(0, 150) || 'An unexpected error occurred.'
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
      if (e instanceof Error) setError(extractApiDetail(e))
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
      if (e instanceof Error) setError(extractApiDetail(e))
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
          {hasPdf && (
            <button type="button" onClick={handlePreview} disabled={!!busy} className={btnClass}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {busy === 'preview' ? 'Opening\u2026' : 'Preview'}
            </button>
          )}
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

const CONCERN_TABS = ['overall', 'canvas', 'gradeo'] as const
type ConcernTab = typeof CONCERN_TABS[number]

const TAB_DESCRIPTIONS: Record<ConcernTab, string> = {
  overall: 'All students with any missing work compounding to today, plus concern flags based on attendance, completion, and missing thresholds.',
  canvas: 'All missing or not-submitted Canvas assignments due before today (compounding, all-time).',
  gradeo: 'Students with flagged Gradeo results (not submitted, awaiting marking, or low scores).',
}

function ConcernReportCard({ courseId, courseCode }: { courseId: number; courseCode: string }) {
  const [tab, setTab] = useState<ConcernTab>('overall')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tabs = [...CONCERN_TABS]

  const path = `/reports/courses/${courseId}/concern-report?tab=${tab}`
  const fallbackName = `${courseCode}-concern-${tab}`

  async function handleDownload(fmt: 'csv' | 'pdf') {
    setBusy(fmt)
    setError(null)
    try {
      await downloadFile(`${path}&format=${fmt}`, `${fallbackName}.${fmt}`)
    } catch (e) {
      if (e instanceof Error) setError(extractApiDetail(e))
    } finally {
      setBusy(null)
    }
  }

  async function handlePreview() {
    setBusy('preview')
    setError(null)
    try {
      await previewPdf(path, `Students of Concern — ${tab.charAt(0).toUpperCase() + tab.slice(1)}`)
    } catch (e) {
      if (e instanceof Error) setError(extractApiDetail(e))
    } finally {
      setBusy(null)
    }
  }

  const btnClass = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col">
      <h3 className="text-sm font-semibold text-slate-800">Students of Concern</h3>
      {/* Tab bar */}
      <div className="mt-2 flex gap-1 flex-wrap">
        {tabs.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setError(null) }}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              tab === t
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2 flex-1">{TAB_DESCRIPTIONS[tab]}</p>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={handlePreview} disabled={!!busy} className={btnClass}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {busy === 'preview' ? 'Opening\u2026' : 'Preview'}
        </button>
        <button type="button" onClick={() => handleDownload('csv')} disabled={!!busy} className={btnClass}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
          </svg>
          {busy === 'csv' ? 'Downloading\u2026' : 'CSV'}
        </button>
        <button type="button" onClick={() => handleDownload('pdf')} disabled={!!busy} className={btnClass}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
          </svg>
          {busy === 'pdf' ? 'Downloading\u2026' : 'PDF'}
        </button>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  )
}

export default function Reports() {
  const { data: courses } = useCourses()
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null)

  // Student report state
  const { data: students } = useStudents()
  const [pdfCourseId, setPdfCourseId] = useState<number | null>(null)
  const [pdfStudentId, setPdfStudentId] = useState<number | null>(null)
  const [studentSearch, setStudentSearch] = useState('')

  // Filter students by selected course enrollment, then by search text
  const courseStudents = pdfCourseId
    ? students?.filter(s => s.courses.some(c => c.id === pdfCourseId))
    : students
  const filteredStudents = studentSearch
    ? courseStudents?.filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()))
    : courseStudents

  const selectedCourse = courses?.find(c => c.id === selectedCourseId)
  const courseCode = selectedCourse
    ? (selectedCourse.course_code ?? '').replace(/\s+/g, '-') || String(selectedCourse.id)
    : ''
  function handlePdfCourseChange(id: number | null) {
    setPdfCourseId(id)
    setPdfStudentId(null)
    setStudentSearch('')
  }

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
                description="Assignment completion matrix. One row per student, one column per assignment showing score or submission status (submitted, graded, missing)."
                path={`/reports/courses/${selectedCourseId}/class-report`}
                fallbackName={`${courseCode}-class-report`}
                formats={['csv']}
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
              <ReportCard
                title="Whole-Class Full Report"
                description="One page per student showing all assignments due to date with statuses and scores, Gradeo results, and EdStem completion."
                path={`/reports/courses/${selectedCourseId}/class-cycle-pdf`}
                fallbackName={`${courseCode}-class-full-report`}
                formats={['pdf']}
              />
              <ConcernReportCard
                courseId={selectedCourseId}
                courseCode={courseCode}
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
              <label className="block text-xs font-medium text-slate-500 mb-1">Course</label>
              <select
                value={pdfCourseId ?? ''}
                onChange={e => handlePdfCourseChange(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-xs"
              >
                <option value="">Select a course</option>
                {courses?.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.course_code ? `${c.course_code} — ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Student</label>
              <input
                type="text"
                placeholder="Search students…"
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-xs mb-1"
              />
              <select
                value={pdfStudentId ?? ''}
                onChange={e => setPdfStudentId(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-full max-w-xs"
              >
                <option value="">{pdfCourseId && filteredStudents?.length === 0 ? 'No students found' : 'Select a student'}</option>
                {filteredStudents?.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {pdfStudentId ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ReportCard
                title="Full Report"
                description="All assignments due to date with statuses and scores, Gradeo results, and EdStem completion. Suitable for sharing with parents."
                path={`/reports/students/${pdfStudentId}/cycle-update-pdf?course_id=${pdfCourseId}`}
                fallbackName="full-report"
                disabled={!pdfCourseId}
                disabledReason="Select a course above"
                formats={['pdf']}
              />
              <ReportCard
                title="Missing Work Report"
                description={pdfCourseId
                  ? "All-time missing/incomplete work for this student in the selected course. Includes missing Canvas assignments, flagged Gradeo assessments, and incomplete EdStem lessons."
                  : "All-time missing/incomplete work for this student across every enrolled course. Select a course above to filter."
                }
                path={pdfCourseId
                  ? `/reports/students/${pdfStudentId}/missing-report-pdf?course_id=${pdfCourseId}`
                  : `/reports/students/${pdfStudentId}/missing-report-pdf`
                }
                fallbackName="missing-report"
                formats={['pdf']}
              />
              <ReportCard
                title="2-Week Snapshot"
                description={pdfCourseId
                  ? "Overview of all Canvas assignment statuses from the last 14 days for the selected course, plus Gradeo results and incomplete EdStem lessons."
                  : "Overview of all Canvas assignment statuses from the last 14 days across every enrolled course, plus Gradeo results and incomplete EdStem lessons."
                }
                path={pdfCourseId
                  ? `/reports/students/${pdfStudentId}/snapshot-report-pdf?course_id=${pdfCourseId}`
                  : `/reports/students/${pdfStudentId}/snapshot-report-pdf`
                }
                fallbackName="snapshot-report"
                formats={['pdf']}
              />
              <ReportCard
                title="Complete Student Report"
                description="Full progress report for this student in the selected course. Includes all assignment scores, assessment tracking, Gradeo results, and attendance records."
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
              Select a course and student above to see available reports.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
