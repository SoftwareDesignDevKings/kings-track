import { useEffect, useMemo } from 'react'
import { useParams, Link, Navigate, useSearchParams, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import MatrixTable from '../components/MatrixTable'
import { buildCourseGroupMatrixTableModel } from '../components/matrixTableAdapters'
import EngagementTable from '../components/EngagementTable'
import EngagementTimelineChart from '../components/charts/EngagementTimelineChart'
import EdStemLessonTable from '../components/EdStemLessonTable'
import GradeoReportTable from '../components/GradeoReportTable'
import GradeoTopicBandsTable from '../components/GradeoTopicBandsTable'
import AssignmentTrackingTab from '../components/AssignmentTrackingTab'
import {
  useCourseGroups,
  useCourseGroupMatrix,
  useCourseGroupEngagement,
  useCourseGroupEdStem,
  useCourseGroupGradeo,
  useCourseGroupTopicBands,
  useCourseGroupTrackableAssignments,
} from '../services/api'
import type { CourseGroupClass } from '../types'

type GroupTab = 'canvas' | 'engagement' | 'edstem' | 'gradeo' | 'topic_bands' | 'tracking' | 'classes'

interface Tab {
  id: GroupTab
  label: string
}

const ALL_TABS: Tab[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'edstem', label: 'EdStem' },
  { id: 'gradeo', label: 'Gradeo' },
  { id: 'topic_bands', label: 'Topic Bands' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'classes', label: 'Classes' },
]

function getTabFromSearch(value: string | null): GroupTab {
  if (value === 'engagement' || value === 'edstem' || value === 'gradeo' || value === 'tracking' || value === 'classes') return value
  if (value === 'topic-bands' || value === 'topic_bands') return 'topic_bands'
  return 'canvas'
}

function getTabSearchValue(tab: GroupTab) {
  if (tab === 'canvas') return null
  if (tab === 'topic_bands') return 'topic-bands'
  return tab
}

// ── Class card components for the Classes tab ────────────────────────────────

function CompletionRing({ value }: { value: number | null }) {
  if (value === null)
    return (
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">
        —
      </div>
    )
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'text-emerald-500' : pct >= 50 ? 'text-amber-500' : 'text-red-500'
  const strokeColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
  const r = 18
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className="relative w-12 h-12">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={strokeColor} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${color}`}>
        {pct}%
      </span>
    </div>
  )
}

function ragColor(rate: number | null): string {
  if (rate === null) return 'bg-slate-200'
  const pct = rate * 100
  if (pct >= 80) return 'bg-emerald-400'
  if (pct >= 50) return 'bg-amber-400'
  return 'bg-red-400'
}

function formatSync(iso: string | null) {
  if (!iso) return 'Not synced'
  const d = new Date(iso)
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffH = Math.floor(diffMins / 60)
  if (diffH < 24) return `${diffH}h ago`
  return d.toLocaleDateString()
}

function ClassCard({ cls }: { cls: CourseGroupClass }) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(`/courses/${cls.id}`)}
      className="
        group text-left bg-white rounded-xl border border-slate-200
        p-5 flex flex-col gap-4
        hover:border-brand-500 hover:shadow-md
        transition-all duration-150
        focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2
      "
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`shrink-0 w-2 h-2 rounded-full ${ragColor(cls.avg_completion_rate)}`} />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">
              {cls.course_code?.replace(/_\d{4}$/, '') || 'Class'}
            </span>
          </div>
          <h2 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-brand-600">
            {cls.name}
          </h2>
        </div>
        <CompletionRing value={cls.avg_completion_rate} />
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Students</p>
          <p className="text-sm font-semibold text-slate-800">{cls.student_count}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">On-time</p>
          <p className="text-sm font-semibold text-slate-800">
            {cls.avg_on_time_rate !== null ? `${Math.round(cls.avg_on_time_rate * 100)}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Avg score</p>
          <p className="text-sm font-semibold text-slate-800">
            {cls.avg_current_score !== null ? `${cls.avg_current_score}%` : '—'}
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-400">Synced {formatSync(cls.last_synced)}</p>
    </button>
  )
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function TabLoadingSkeleton() {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden animate-pulse">
      <div className="h-10 bg-slate-100 border-b border-slate-200" />
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-10 border-b border-slate-100 bg-white" />
      ))}
    </div>
  )
}

function TabError({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
      {message}
    </div>
  )
}

// ── Main page component ──────────────────────────────────────────────────────

export default function CourseGroupDetail() {
  const { groupCode } = useParams<{ groupCode: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: groups, isLoading: groupsLoading, error: groupsError } = useCourseGroups()

  const group = groups?.find(g => g.group_code === groupCode)
  const isMultiClass = group && group.class_count > 1

  // Single-class group: redirect directly to class detail
  if (group && group.class_count === 1) {
    return <Navigate to={`/courses/${group.classes[0].id}`} replace />
  }

  const activeTab = getTabFromSearch(searchParams.get('tab'))

  // ── Data fetching (all in parallel) ──────────────────────────────────────
  const enableGroupHooks = isMultiClass ? groupCode : undefined

  const { data: groupMatrix, isLoading: matrixLoading, error: matrixError } =
    useCourseGroupMatrix(enableGroupHooks)
  const { data: engagement, isLoading: engagementLoading, error: engagementError } =
    useCourseGroupEngagement(enableGroupHooks)
  const { data: edStemMatrix, isLoading: edStemLoading, error: edStemError } =
    useCourseGroupEdStem(enableGroupHooks)
  const { data: gradeoReport, isLoading: gradeoLoading, error: gradeoError } =
    useCourseGroupGradeo(enableGroupHooks)
  const { data: gradeoTopicBands, isLoading: topicBandsLoading, error: topicBandsError } =
    useCourseGroupTopicBands(enableGroupHooks)
  const { data: trackableAssignments, isLoading: trackingLoading } =
    useCourseGroupTrackableAssignments(enableGroupHooks)

  // ── Tab filtering ────────────────────────────────────────────────────────
  const gradeoMapped = Boolean(gradeoReport?.mapped || gradeoTopicBands?.mapped)
  const tabs = useMemo(() => ALL_TABS.filter(tab => {
    if (tab.id === 'gradeo') return gradeoMapped
    if (tab.id === 'topic_bands') return gradeoMapped
    if (tab.id === 'edstem') return edStemMatrix?.mapped
    if (tab.id === 'tracking') return (trackableAssignments?.length ?? 0) > 0
    return true
  }), [edStemMatrix?.mapped, gradeoMapped, trackableAssignments])

  const tabAvailabilityLoaded = !edStemLoading && !engagementLoading && !gradeoLoading && !topicBandsLoading && !trackingLoading

  // Auto-redirect if active tab is no longer available
  useEffect(() => {
    if (!tabAvailabilityLoaded) return
    if (!tabs.some(tab => tab.id === activeTab)) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('tab')
        return next
      }, { replace: true })
    }
  }, [activeTab, setSearchParams, tabAvailabilityLoaded, tabs])

  function setTab(tab: GroupTab) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      const value = getTabSearchValue(tab)
      if (value === null) {
        next.delete('tab')
      } else {
        next.set('tab', value)
      }
      return next
    }, { replace: true })
  }

  // Build group matrix table model with class code subtitles
  const groupMatrixModel = groupMatrix ? buildCourseGroupMatrixTableModel(groupMatrix) : null

  // First course ID for tracking tab (tracking works per-course)
  const firstCourseId = group?.classes[0]?.id ?? 0

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <Header />

      <main className="mx-auto flex min-h-0 w-full max-w-screen-2xl flex-1 flex-col px-4 py-6 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-5 flex shrink-0 items-center gap-2 text-sm text-slate-400">
          <Link to="/" className="hover:text-brand-600 transition-colors">Courses</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-600">
            {groupsLoading ? '...' : (group?.group_code || groupCode || 'Course')}
          </span>
        </nav>

        {/* Header */}
        <div className="mb-4 shrink-0">
          {groupsLoading ? (
            <div className="h-7 bg-slate-200 rounded w-48 animate-pulse" />
          ) : group ? (
            <>
              <h2 className="text-xl font-semibold text-slate-900">{group.display_name}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {group.class_count} class{group.class_count !== 1 ? 'es' : ''} · {group.total_students} student{group.total_students !== 1 ? 's' : ''}
              </p>
            </>
          ) : !groupsError ? (
            <h2 className="text-xl font-semibold text-slate-900">Course not found</h2>
          ) : null}
        </div>

        {/* Error */}
        {groupsError && (
          <TabError message="Failed to load course data." />
        )}

        {/* Not found */}
        {!groupsLoading && !groupsError && !group && (
          <div className="text-center py-20">
            <h3 className="text-base font-medium text-slate-600 mb-1">Course group not found</h3>
            <p className="text-sm text-slate-400">
              No course group matches &quot;{groupCode}&quot;.
            </p>
          </div>
        )}

        {/* Tab bar + content */}
        {group && (
          <>
            <div className="mb-4 shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200">
              <div className="flex min-w-max items-center gap-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTab(tab.id)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-brand-500 text-brand-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <section className="min-h-0 min-w-0 flex-1 flex flex-col">

              {/* Canvas tab */}
              {activeTab === 'canvas' && (
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                  {matrixLoading && <TabLoadingSkeleton />}
                  {matrixError && <TabError message="Failed to load activity data." />}
                  {groupMatrixModel && <MatrixTable model={groupMatrixModel} />}
                </div>
              )}

              {/* Engagement tab */}
              {activeTab === 'engagement' && (
                <div className="flex h-full min-h-0 min-w-0 flex-col gap-6 overflow-y-auto">
                  {engagementLoading && <TabLoadingSkeleton />}
                  {engagementError && <TabError message="Failed to load engagement data." />}
                  {!engagementLoading && !engagementError && (!engagement || engagement.students.length === 0) && (
                    <div className="text-center py-16 text-slate-400 text-sm">
                      {engagement?.synced_at
                        ? 'No students with engagement data found.'
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

              {/* EdStem tab */}
              {activeTab === 'edstem' && (
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                  {edStemLoading && <TabLoadingSkeleton />}
                  {edStemError && <TabError message="Failed to load EdStem data." />}
                  {edStemMatrix?.mapped && <EdStemLessonTable matrix={edStemMatrix} />}
                </div>
              )}

              {/* Gradeo tab */}
              {activeTab === 'gradeo' && (
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                  {gradeoLoading && <TabLoadingSkeleton />}
                  {gradeoError && <TabError message="Failed to load Gradeo data." />}
                  {!gradeoLoading && gradeoReport?.mapped && (
                    <GradeoReportTable report={gradeoReport} hiddenStudents={gradeoReport.hidden_students ?? []} />
                  )}
                  {!gradeoLoading && !gradeoError && !gradeoReport?.mapped && (
                    <div className="text-center py-16 text-slate-400 text-sm">
                      No Gradeo exams have been imported yet.
                    </div>
                  )}
                </div>
              )}

              {/* Topic Bands tab */}
              {activeTab === 'topic_bands' && (
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                  {topicBandsLoading && <TabLoadingSkeleton />}
                  {topicBandsError && <TabError message="Failed to load Gradeo topic bands." />}
                  {!topicBandsLoading && gradeoTopicBands?.mapped && (
                    <GradeoTopicBandsTable topicBands={gradeoTopicBands} />
                  )}
                  {!topicBandsLoading && !topicBandsError && !gradeoTopicBands?.mapped && (
                    <div className="text-center py-16 text-slate-400 text-sm">
                      No Gradeo topic bands have been imported yet.
                    </div>
                  )}
                </div>
              )}

              {/* Tracking tab */}
              {activeTab === 'tracking' && firstCourseId > 0 && (
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                  <AssignmentTrackingTab courseId={firstCourseId} />
                </div>
              )}

              {/* Classes tab */}
              {activeTab === 'classes' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {group.classes.map(cls => (
                    <ClassCard key={cls.id} cls={cls} />
                  ))}
                </div>
              )}

            </section>
          </>
        )}
      </main>
    </div>
  )
}
