import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import Header from '../components/Header'
import ActivityTable from '../components/ActivityTable'
import EdStemLessonTable from '../components/EdStemLessonTable'
import GradeoReportTable from '../components/GradeoReportTable'
import {
  buildCanvasActivityColumns,
  getCanvasDueNowCompletionRate,
  getCanvasDueNowCount,
  prepareCanvasActivityView,
} from '../components/activityTableModel'
import { useCourseMatrix, useEdStemMatrix, useGradeoReport } from '../services/api'

type TabId = 'activities' | 'edstem' | 'gradeo'

interface Tab {
  id: TabId
  label: string
}

const TABS: Tab[] = [
  { id: 'activities', label: 'Canvas' },
  { id: 'gradeo', label: 'Gradeo' },
  { id: 'edstem', label: 'EdStem' },
]

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>()
  const id = Number(courseId)
  const [activeTab, setActiveTab] = useState<TabId>('activities')

  const { data: matrix, isLoading, error } = useCourseMatrix(id)
  const { data: edStemMatrix, isLoading: edStemLoading, error: edStemError } = useEdStemMatrix(id)
  const { data: gradeoReport, isLoading: gradeoLoading, error: gradeoError } = useGradeoReport(id)
  const tabs = useMemo(() => TABS.filter(tab => {
    if (tab.id === 'gradeo') return gradeoReport?.mapped
    if (tab.id === 'edstem') return edStemMatrix?.mapped
    return true
  }), [edStemMatrix?.mapped, gradeoReport?.mapped])

  useEffect(() => {
    if (!tabs.some(tab => tab.id === activeTab)) {
      setActiveTab('activities')
    }
  }, [activeTab, tabs])

  if (!courseId || isNaN(id)) {
    return <Navigate to="/" replace />
  }

  // Summary stats derived from matrix
  const totalStudents = matrix?.students.length ?? 0
  const totalAssignments = matrix?.assignment_groups.reduce(
    (sum, g) => sum + g.assignments.length, 0
  ) ?? 0
  const activityView = matrix
    ? prepareCanvasActivityView(buildCanvasActivityColumns(matrix.assignment_groups))
    : null
  const dueNowCount = activityView ? getCanvasDueNowCount(activityView) : 0
  const avgCompletion = matrix && activityView && totalStudents > 0 && dueNowCount > 0
    ? matrix.students.reduce(
      (sum, student) => sum + (getCanvasDueNowCompletionRate(student, activityView.columns, dueNowCount) ?? 0),
      0,
    ) / totalStudents
    : null

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-slate-400 mb-5">
          <Link to="/" className="hover:text-brand-600 transition-colors">Courses</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-600">
            {isLoading ? '…' : (matrix?.course_code || matrix?.course_name || 'Course')}
          </span>
        </nav>

        {/* Course header */}
        <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="h-7 bg-slate-200 rounded w-48 animate-pulse" />
            ) : (
              <>
                <h2 className="text-2xl font-bold text-slate-900 leading-tight">
                  {matrix?.course_name ?? 'Course'}
                </h2>
                {matrix?.course_code && (
                  <p className="text-sm text-slate-500 mt-0.5">{matrix.course_code}</p>
                )}
              </>
            )}
          </div>

          {/* Summary stats */}
          {matrix && (
            <div className="grid grid-cols-3 gap-3 text-sm shrink-0 sm:flex sm:items-center sm:gap-5">
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">{totalStudents}</p>
                <p className="text-xs text-slate-400">Students</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">{totalAssignments}</p>
                <p className="text-xs text-slate-400">Activities</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">
                  {avgCompletion !== null ? `${Math.round(avgCompletion * 100)}%` : '—'}
                </p>
                <p className="text-xs text-slate-400">Avg completion</p>
              </div>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="mb-5 overflow-x-auto border-b border-slate-200">
          <div className="flex min-w-max items-center gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
                ${activeTab === tab.id
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === 'activities' && (
          <>
            {isLoading && (
              <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                <div className="h-10 bg-slate-100 border-b border-slate-200" />
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-10 border-b border-slate-100 bg-white" />
                ))}
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                Failed to load activity data. Make sure the course has been synced.
              </div>
            )}
            {matrix && <ActivityTable matrix={matrix} />}
          </>
        )}

        {activeTab === 'edstem' && (
          <>
            {edStemLoading && (
              <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                <div className="h-10 bg-slate-100 border-b border-slate-200" />
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-10 border-b border-slate-100 bg-white" />
                ))}
              </div>
            )}
            {edStemError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                Failed to load EdStem data. Make sure the course has been synced.
              </div>
            )}
            {edStemMatrix?.mapped && <EdStemLessonTable matrix={edStemMatrix} />}
          </>
        )}

        {activeTab === 'gradeo' && (
          <>
            {gradeoLoading && (
              <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                <div className="h-10 bg-slate-100 border-b border-slate-200" />
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-10 border-b border-slate-100 bg-white" />
                ))}
              </div>
            )}
            {gradeoError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                Failed to load Gradeo data. Make sure the class has been imported from the extension.
              </div>
            )}
            {gradeoReport?.mapped && (
              <GradeoReportTable report={gradeoReport} hiddenStudents={gradeoReport.hidden_students ?? []} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
