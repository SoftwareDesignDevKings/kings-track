import { useEffect, useMemo, useState } from 'react'
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
import { useCourseMatrix, useCourseEngagement, useEdStemMatrix, useGradeoReport, useGradeoTopicBands, useTrackableAssignments } from '../services/api'
import EngagementTable from '../components/EngagementTable'
import EngagementTimelineChart from '../components/charts/EngagementTimelineChart'
import { downloadCsv } from '../lib/downloadCsv'
import AssignmentTrackingTab from '../components/AssignmentTrackingTab'

type TabId = 'activities' | 'engagement' | 'gradeo' | 'topic_bands' | 'edstem' | 'tracking'

interface Tab {
  id: TabId
  label: string
}

const TABS: Tab[] = [
  { id: 'activities', label: 'Canvas' },
  { id: 'edstem', label: 'EdStem' },
  { id: 'gradeo', label: 'Gradeo' },
  { id: 'topic_bands', label: 'Topic Bands' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'tracking', label: 'Tracking' },
]

function getTabFromSearch(value: string | null): TabId {
  if (value === 'gradeo' || value === 'edstem' || value === 'engagement' || value === 'tracking') return value
  if (value === 'topic-bands' || value === 'topic_bands') return 'topic_bands'
  return 'activities'
}

function getTabSearchValue(tab: TabId) {
  if (tab === 'activities') return 'canvas'
  if (tab === 'topic_bands') return 'topic-bands'
  return tab
}

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const id = Number(courseId)
  const activeTab = getTabFromSearch(searchParams.get('tab'))

  const { data: matrix, isLoading, error } = useCourseMatrix(id)
  const { data: engagement, isLoading: engagementLoading, error: engagementError } = useCourseEngagement(id)
  const { data: edStemMatrix, isLoading: edStemLoading, error: edStemError } = useEdStemMatrix(id)
  const { data: gradeoReport, isLoading: gradeoLoading, error: gradeoError } = useGradeoReport(id)
  const {
    data: gradeoTopicBands,
    isLoading: gradeoTopicBandsLoading,
    error: gradeoTopicBandsError,
  } = useGradeoTopicBands(id)
  const { data: trackableAssignments, isLoading: trackingLoading } = useTrackableAssignments(id)

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
  const gradeoMapped = Boolean(gradeoReport?.mapped || gradeoTopicBands?.mapped)
  const tabs = useMemo(() => TABS.filter(tab => {
    if (tab.id === 'gradeo') return gradeoMapped
    if (tab.id === 'topic_bands') return gradeoMapped
    if (tab.id === 'edstem') return edStemMatrix?.mapped
    if (tab.id === 'tracking') return (trackableAssignments?.length ?? 0) > 0
    return true
  }), [edStemMatrix?.mapped, gradeoMapped, trackableAssignments])
  const tabAvailabilityLoaded = !edStemLoading && !engagementLoading && !gradeoLoading && !gradeoTopicBandsLoading && !trackingLoading
  const [downloadingClass, setDownloadingClass] = useState(false)
  const [downloadingGradeo, setDownloadingGradeo] = useState(false)
  const [downloadingClassList, setDownloadingClassList] = useState(false)
  const [downloadingEdStem, setDownloadingEdStem] = useState(false)

  const courseCode = (matrix?.course_code ?? '').replace(/\s+/g, '-') || String(id)

  async function handleExportClassList() {
    setDownloadingClassList(true)
    try {
      await downloadCsv(`/reports/courses/${id}/class-list`, `${courseCode}-class-list.csv`)
    } catch {
      // silent fail
    } finally {
      setDownloadingClassList(false)
    }
  }

  async function handleExportClassReport() {
    setDownloadingClass(true)
    try {
      await downloadCsv(`/reports/courses/${id}/class-report`, `${courseCode}-class-report.csv`)
    } catch {
      // silent fail
    } finally {
      setDownloadingClass(false)
    }
  }

  async function handleExportGradeoReport() {
    setDownloadingGradeo(true)
    try {
      await downloadCsv(`/reports/courses/${id}/gradeo-report`, `${courseCode}-gradeo-report.csv`)
    } catch {
      // silent fail
    } finally {
      setDownloadingGradeo(false)
    }
  }

  async function handleExportEdStemReport() {
    setDownloadingEdStem(true)
    try {
      await downloadCsv(`/reports/courses/${id}/edstem-report`, `${courseCode}-edstem-report.csv`)
    } catch {
      // silent fail
    } finally {
      setDownloadingEdStem(false)
    }
  }

  function setCourseView(tab: TabId) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('gradeo')

      if (tab === 'activities') {
        next.delete('tab')
        return next
      }

      next.set('tab', getTabSearchValue(tab))
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
    } else if (searchParams.get('gradeo')) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
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
            <div className="flex shrink-0 items-center gap-5">
              <div className="grid grid-cols-3 gap-3 text-sm sm:flex sm:items-center sm:gap-5">
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
              <button
                type="button"
                onClick={handleExportClassList}
                disabled={downloadingClassList}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
                </svg>
                {downloadingClassList ? 'Downloading\u2026' : 'Class List'}
              </button>
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
              {matrix && (
                <ActivityTable matrix={matrix} onExport={handleExportClassReport} exportLoading={downloadingClass} />
              )}
            </div>
          )}

          {activeTab === 'engagement' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col gap-6 overflow-y-auto">
              {engagementLoading && (
                <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                  <div className="h-10 bg-slate-100 border-b border-slate-200" />
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-10 border-b border-slate-100 bg-white" />
                  ))}
                </div>
              )}
              {engagementError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                  Failed to load engagement data. Make sure the course has been synced.
                </div>
              )}
              {!engagementLoading && !engagementError && (!engagement || engagement.students.length === 0) && (
                <div className="text-center py-16 text-slate-400 text-sm">
                  {engagement?.synced_at
                    ? 'No students with engagement data found for this course.'
                    : 'No engagement data yet — trigger a sync to pull Canvas analytics.'}
                </div>
              )}
              {engagement && engagement.students.length > 0 && (
                <>
                  {engagement.course_activity.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <h3 className="mb-3 text-sm font-semibold text-slate-700">Course activity over time</h3>
                      <EngagementTimelineChart data={engagement.course_activity} />
                    </div>
                  )}
                  <EngagementTable students={engagement.students} />
                </>
              )}
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
              {edStemMatrix?.mapped && <EdStemLessonTable matrix={edStemMatrix} onExport={handleExportEdStemReport} exportLoading={downloadingEdStem} />}
            </div>
          )}

          {activeTab === 'gradeo' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              {gradeoLoading && (
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
              {!gradeoLoading && gradeoReport?.mapped && (
                <GradeoReportTable report={gradeoReport} hiddenStudents={gradeoReport.hidden_students ?? []} />
              )}
              {!gradeoLoading && !gradeoError && !gradeoReport?.mapped && (
                <div className="text-center py-16 text-slate-400 text-sm">
                  No Gradeo exams have been imported for this course yet.
                </div>
              )}
            </div>
          )}

          {activeTab === 'topic_bands' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              {gradeoTopicBandsLoading && (
                <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
                  <div className="h-10 bg-slate-100 border-b border-slate-200" />
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="h-10 border-b border-slate-100 bg-white" />
                  ))}
                </div>
              )}
              {gradeoTopicBandsError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                  Failed to load Gradeo topic bands. Make sure the class has been imported from the extension.
                </div>
              )}
              {!gradeoTopicBandsLoading && gradeoTopicBands?.mapped && (
                <GradeoTopicBandsTable topicBands={gradeoTopicBands} onExport={handleExportGradeoReport} exportLoading={downloadingGradeo} />
              )}
              {!gradeoTopicBandsLoading && !gradeoTopicBandsError && !gradeoTopicBands?.mapped && (
                <div className="text-center py-16 text-slate-400 text-sm">
                  No Gradeo topic bands have been imported for this course yet.
                </div>
              )}
            </div>
          )}

          {activeTab === 'tracking' && (
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              <AssignmentTrackingTab courseId={id} />
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
