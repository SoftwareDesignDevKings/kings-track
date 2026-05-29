import { useState } from 'react'
import Header from '../components/Header'
import { useCourses } from '../services/api'
import { downloadCsv } from '../lib/downloadCsv'

interface ReportCardProps {
  title: string
  description: string
  onDownload: () => void
  downloading: boolean
  disabled?: boolean
  disabledReason?: string
}

function ReportCard({ title, description, onDownload, downloading, disabled, disabledReason }: ReportCardProps) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 flex flex-col ${disabled ? 'opacity-50' : ''}`}>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 mt-1 flex-1">{description}</p>
      {disabled ? (
        <p className="text-xs text-slate-400 mt-3 italic">{disabledReason}</p>
      ) : (
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="mt-3 inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
          </svg>
          {downloading ? 'Downloading\u2026' : 'Download CSV'}
        </button>
      )}
    </div>
  )
}

export default function Reports() {
  const { data: courses } = useCourses()
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null)

  // Platform report download states
  const [dlStudentProgress, setDlStudentProgress] = useState(false)
  const [dlAtRisk, setDlAtRisk] = useState(false)
  const [dlAttSummary, setDlAttSummary] = useState(false)

  // Course report download states
  const [dlClassList, setDlClassList] = useState(false)
  const [dlClassReport, setDlClassReport] = useState(false)
  const [dlGradeo, setDlGradeo] = useState(false)
  const [dlCourseAtt, setDlCourseAtt] = useState(false)
  const [dlEdStem, setDlEdStem] = useState(false)

  const selectedCourse = courses?.find(c => c.id === selectedCourseId)
  const courseCode = selectedCourse
    ? (selectedCourse.course_code ?? '').replace(/\s+/g, '-') || String(selectedCourse.id)
    : ''

  async function download(
    path: string,
    fallback: string,
    setLoading: (v: boolean) => void,
  ) {
    setLoading(true)
    try {
      await downloadCsv(path, fallback)
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Reports</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Download reports for your courses and students.
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
              description="All students with academic metrics, attendance, and concern flags."
              onDownload={() => download('/reports/student-progress', 'student-progress-report.csv', setDlStudentProgress)}
              downloading={dlStudentProgress}
            />
            <ReportCard
              title="At-Risk Students"
              description="Students flagged as moderate or high concern, sorted by severity."
              onDownload={() => download('/reports/at-risk-students', 'at-risk-students.csv', setDlAtRisk)}
              downloading={dlAtRisk}
            />
            <ReportCard
              title="Attendance Summary"
              description="Per-student attendance rates across all meetings."
              onDownload={() => download('/reports/attendance-summary', 'attendance-summary.csv', setDlAttSummary)}
              downloading={dlAttSummary}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <ReportCard
                title="Class List"
                description="Student roster with first name, last name, and email."
                onDownload={() => download(`/reports/courses/${selectedCourseId}/class-list`, `${courseCode}-class-list.csv`, setDlClassList)}
                downloading={dlClassList}
              />
              <ReportCard
                title="Class Report"
                description="Assignment completion matrix with scores and submission status."
                onDownload={() => download(`/reports/courses/${selectedCourseId}/class-report`, `${courseCode}-class-report.csv`, setDlClassReport)}
                downloading={dlClassReport}
              />
              <ReportCard
                title="Course Attendance"
                description="Per-student attendance status for each meeting."
                onDownload={() => download(`/reports/courses/${selectedCourseId}/attendance-report`, `${courseCode}-attendance.csv`, setDlCourseAtt)}
                downloading={dlCourseAtt}
              />
              <ReportCard
                title="Gradeo Topic Bands"
                description="Per-topic predicted bands and scores from Gradeo assessments."
                onDownload={() => download(`/reports/courses/${selectedCourseId}/gradeo-report`, `${courseCode}-gradeo-report.csv`, setDlGradeo)}
                downloading={dlGradeo}
              />
              <ReportCard
                title="EdStem Progress"
                description="Lesson completion status per student across all modules."
                onDownload={() => download(`/reports/courses/${selectedCourseId}/edstem-report`, `${courseCode}-edstem-report.csv`, setDlEdStem)}
                downloading={dlEdStem}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">
              Select a course to see available course reports.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
