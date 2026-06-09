import { useState } from 'react'
import Header from '../components/Header'
import { useCourses, useStudents, useCourseCycles } from '../services/api'
import { downloadCsv, previewPdf } from '../lib/downloadCsv'

interface ReportCardProps {
  title: string
  description: string
  onDownload: () => void
  downloading: boolean
  disabled?: boolean
  disabledReason?: string
  format?: 'csv' | 'pdf'
  onPreview?: () => void
  previewing?: boolean
}

function ReportCard({ title, description, onDownload, downloading, disabled, disabledReason, format = 'csv', onPreview, previewing }: ReportCardProps) {
  const label = format === 'pdf' ? 'Download PDF' : 'Download CSV'
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 flex flex-col ${disabled ? 'opacity-50' : ''}`}>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 mt-1 flex-1">{description}</p>
      {disabled ? (
        <p className="text-xs text-slate-400 mt-3 italic">{disabledReason}</p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
            </svg>
            {downloading ? 'Downloading\u2026' : label}
          </button>
          {onPreview && (
            <button
              type="button"
              onClick={onPreview}
              disabled={previewing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {previewing ? 'Opening\u2026' : 'Preview'}
            </button>
          )}
        </div>
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

  // Course PDF states
  const [dlClassCyclePdf, setDlClassCyclePdf] = useState(false)
  const [pvClassCyclePdf, setPvClassCyclePdf] = useState(false)

  // Student report state
  const { data: students } = useStudents()
  const [pdfStudentId, setPdfStudentId] = useState<number | null>(null)
  const [pdfCourseId, setPdfCourseId] = useState<number | null>(null)
  const [pdfCycleNum, setPdfCycleNum] = useState<number | null>(null)
  const { data: cycles, isLoading: cyclesLoading } = useCourseCycles(pdfCourseId)
  const [dlCyclePdf, setDlCyclePdf] = useState(false)
  const [dlMissingPdf, setDlMissingPdf] = useState(false)
  const [dlStudentCsv, setDlStudentCsv] = useState(false)

  // Preview states
  const [pvCyclePdf, setPvCyclePdf] = useState(false)
  const [pvMissingPdf, setPvMissingPdf] = useState(false)

  // Filter courses by student enrollment
  const selectedStudent = students?.find(s => s.id === pdfStudentId)
  const studentCourses = selectedStudent
    ? courses?.filter(c => selectedStudent.courses.some(sc => sc.id === c.id))
    : courses

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

  async function preview(
    path: string,
    setLoading: (v: boolean) => void,
  ) {
    setLoading(true)
    try {
      await previewPdf(path)
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }

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
              <ReportCard
                title="Whole-Class Cycle Update"
                description="Combined PDF of cycle update reports for every student in this course."
                onDownload={() => download(`/reports/courses/${selectedCourseId}/class-cycle-pdf`, `${courseCode}-class-cycle-update.pdf`, setDlClassCyclePdf)}
                downloading={dlClassCyclePdf}
                onPreview={() => preview(`/reports/courses/${selectedCourseId}/class-cycle-pdf`, setPvClassCyclePdf)}
                previewing={pvClassCyclePdf}
                format="pdf"
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
              <label className="block text-xs font-medium text-slate-500 mb-1">Course (for Cycle Update)</label>
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
                description="Progress in the scope-and-sequence cycle with Gradeo quiz results."
                onDownload={() => {
                  const cyclePart = pdfCycleNum ? `&cycle_num=${pdfCycleNum}` : ''
                  download(
                    `/reports/students/${pdfStudentId}/cycle-update-pdf?course_id=${pdfCourseId}${cyclePart}`,
                    'cycle-update.pdf',
                    setDlCyclePdf,
                  )
                }}
                downloading={dlCyclePdf}
                onPreview={() => {
                  const cyclePart = pdfCycleNum ? `&cycle_num=${pdfCycleNum}` : ''
                  preview(
                    `/reports/students/${pdfStudentId}/cycle-update-pdf?course_id=${pdfCourseId}${cyclePart}`,
                    setPvCyclePdf,
                  )
                }}
                previewing={pvCyclePdf}
                disabled={!pdfCourseId}
                disabledReason="Select a course above"
                format="pdf"
              />
              <ReportCard
                title="Missing Work Report"
                description="All missing and incomplete work across Canvas, EdStem, and Gradeo."
                onDownload={() => download(
                  `/reports/students/${pdfStudentId}/missing-report-pdf`,
                  'missing-report.pdf',
                  setDlMissingPdf,
                )}
                downloading={dlMissingPdf}
                onPreview={() => preview(
                  `/reports/students/${pdfStudentId}/missing-report-pdf`,
                  setPvMissingPdf,
                )}
                previewing={pvMissingPdf}
                format="pdf"
              />
              <ReportCard
                title="Full Student Report"
                description="Comprehensive CSV with metrics, submissions, attendance, and concern status."
                onDownload={() => download(
                  `/reports/students/${pdfStudentId}/report`,
                  'student-report.csv',
                  setDlStudentCsv,
                )}
                downloading={dlStudentCsv}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">
              Select a student to see available PDF reports.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
