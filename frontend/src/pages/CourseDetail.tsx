import { useEffect, useMemo } from 'react'
import { useParams, Link, Navigate, useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import ActivityTable from '../components/ActivityTable'
import EdStemLessonTable from '../components/EdStemLessonTable'
import GradeoReportTable from '../components/GradeoReportTable'
import GradeoTopicBandsTable from '../components/GradeoTopicBandsTable'
import {
  buildCanvasActivityColumns,
  getCanvasDueNowCompletionRate,
  getCanvasDueNowCount,
  prepareCanvasActivityView,
} from '../components/activityTableModel'
import { useCourseMatrix, useEdStemMatrix, useGradeoReport, useGradeoTopicBands } from '../services/api'

type TabId = 'activities' | 'edstem' | 'gradeo'
type GradeoSubview = 'exam_results' | 'topic_bands'

interface Tab {
  id: TabId
  label: string
}

const TABS: Tab[] = [
  { id: 'activities', label: 'Canvas' },
  { id: 'gradeo', label: 'Gradeo' },
  { id: 'edstem', label: 'EdStem' },
]

function getTabFromSearch(value: string | null): TabId {
  if (value === 'gradeo' || value === 'edstem') return value
  return 'activities'
}

function getTabSearchValue(tab: TabId) {
  return tab === 'activities' ? 'canvas' : tab
}

function getGradeoSubviewFromSearch(value: string | null): GradeoSubview | null {
  if (value === 'topic-bands' || value === 'topic_bands') return 'topic_bands'
  if (value === 'results' || value === 'exam-results' || value === 'exam_results') return 'exam_results'
  return null
}

function getGradeoSubviewSearchValue(subview: GradeoSubview) {
  return subview === 'topic_bands' ? 'topic-bands' : 'results'
}

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const id = Number(courseId)
  const activeTab = getTabFromSearch(searchParams.get('tab'))
  const selectedGradeoSubview = getGradeoSubviewFromSearch(searchParams.get('gradeo'))

  const { data: matrix, isLoading, error } = useCourseMatrix(id)
  const { data: edStemMatrix, isLoading: edStemLoading, error: edStemError } = useEdStemMatrix(id)
  const { data: gradeoReport, isLoading: gradeoLoading, error: gradeoError } = useGradeoReport(id)
  const {
    data: gradeoTopicBands,
    isLoading: gradeoTopicBandsLoading,
    error: gradeoTopicBandsError,
  } = useGradeoTopicBands(id)

  const totalStudents = matrix?.students.length ?? 0
  const totalAssignments = matrix?.assignment_groups.reduce(
    (sum, group) => sum + group.assignments.length,
    0,
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
  const activeGradeoSubview = activeTab === 'gradeo'
    ? selectedGradeoSubview ?? 'exam_results'
    : 'exam_results'
  const gradeoMapped = Boolean(gradeoReport?.mapped || gradeoTopicBands?.mapped)
  const tabs = useMemo(() => TABS.filter(tab => {
    if (tab.id === 'gradeo') return gradeoMapped
    if (tab.id === 'edstem') return edStemMatrix?.mapped
    return true
  }), [edStemMatrix?.mapped, gradeoMapped])
  const tabAvailabilityLoaded = !edStemLoading && !gradeoLoading && !gradeoTopicBandsLoading

  function setCourseView(tab: TabId, gradeoSubview: GradeoSubview = activeGradeoSubview) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)

      if (tab === 'activities') {
        next.delete('tab')
        next.delete('gradeo')
        return next
      }

      next.set('tab', getTabSearchValue(tab))

      if (tab === 'gradeo') {
        next.set('gradeo', getGradeoSubviewSearchValue(gradeoSubview))
      } else {
        next.delete('gradeo')
      }

      return next
    }, { replace: true })
  }

  useEffect(() => {
    if (!tabAvailabilityLoaded) return

    if (!tabs.some(tab => tab.id === activeTab)) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('tab')
        next.delete('gradeo')
        return next
      }, { replace: true })
    }
  }, [activeTab, setSearchParams, tabAvailabilityLoaded, tabs])

  if (!courseId || isNaN(id)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <Header />

      <main className="mx-auto flex min-h-0 w-full max-w-screen-2xl flex-1 flex-col px-4 py-6 sm:px-6">
        <nav className="mb-5 flex shrink-0 items-center gap-2 text-sm text-slate-400">
          <Link to="/" className="hover:text-brand-600 transition-colors">Courses</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-600">
            {isLoading ? '...' : (matrix?.course_code || matrix?.course_name || 'Course')}
          </span>
        </nav>

        <div className="mb-6 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="h-7 bg-slate-200 rounded w-48 animate-pulse" />
            ) : (
              <>
                <h2 className="text-2xl font-bold text-slate-900 leading-tight">
                  {matrix?.course_name ?? 'Course'}
                </h2>
              </>
            )}
          </div>

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
                  {avgCompletion !== null ? `${Math.round(avgCompletion * 100)}%` : '-'}
                </p>
                <p className="text-xs text-slate-400">Avg completion</p>
              </div>
            </div>
          )}
        </div>

        <div className="mb-5 shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200">
          <div className="flex min-w-max items-center gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setCourseView(tab.id)}
                className={`
                  px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
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

        <section className="min-h-0 min-w-0 flex-1">
          {activeTab === 'activities' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              {isLoading && (
                <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                  <div className="h-10 bg-slate-100 border-b border-slate-200" />
                  {[1, 2, 3, 4, 5].map(i => (
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
            </div>
          )}

          {activeTab === 'edstem' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              {edStemLoading && (
                <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                  <div className="h-10 bg-slate-100 border-b border-slate-200" />
                  {[1, 2, 3, 4, 5].map(i => (
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
            </div>
          )}

          {activeTab === 'gradeo' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              {(gradeoLoading || gradeoTopicBandsLoading) && (
                <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                  <div className="h-10 bg-slate-100 border-b border-slate-200" />
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-10 border-b border-slate-100 bg-white" />
                  ))}
                </div>
              )}
              {gradeoError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                  Failed to load Gradeo data. Make sure the class has been imported from the extension.
                </div>
              )}
              {gradeoTopicBandsError && activeGradeoSubview === 'topic_bands' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                  Failed to load Gradeo topic bands. Make sure the class has been imported from the extension.
                </div>
              )}
              {!gradeoLoading && !gradeoTopicBandsLoading && gradeoMapped && (
                <>
                  <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setCourseView('gradeo', 'exam_results')}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        activeGradeoSubview === 'exam_results'
                          ? 'bg-brand-50 text-brand-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Results
                    </button>
                    <button
                      type="button"
                      onClick={() => setCourseView('gradeo', 'topic_bands')}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        activeGradeoSubview === 'topic_bands'
                          ? 'bg-brand-50 text-brand-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Topic Bands
                    </button>
                  </div>

                  {activeGradeoSubview === 'exam_results' && gradeoReport?.mapped && (
                    <GradeoReportTable report={gradeoReport} hiddenStudents={gradeoReport.hidden_students ?? []} />
                  )}
                  {activeGradeoSubview === 'exam_results' && !gradeoReport?.mapped && (
                    <div className="text-center py-16 text-slate-400 text-sm">
                      No Gradeo exams have been imported for this course yet.
                    </div>
                  )}
                  {activeGradeoSubview === 'topic_bands' && gradeoTopicBands?.mapped && (
                    <GradeoTopicBandsTable topicBands={gradeoTopicBands} />
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
