import CourseOverviewRadarChart from './charts/CourseOverviewRadarChart'
import SubmissionStatusChart from './charts/SubmissionStatusChart'
import StudentDistributionChart from './charts/StudentDistributionChart'
import EngagementTimelineChart from './charts/EngagementTimelineChart'
import type { CourseActivityDay } from '../types'

export interface CourseOverviewProps {
  totalStudents: number
  totalAssignments: number
  avgCompletionRate: number | null
  avgOnTimeRate: number | null
  avgScore: number | null
  studentCompletionRates: (number | null)[]
  submissionCounts: {
    completed: number
    in_progress: number
    not_started: number
    excused: number
  }
  courseActivity?: CourseActivityDay[]
  isLoading: boolean
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{label}</p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="h-8 bg-slate-200 rounded w-16 mx-auto mb-2" />
            <div className="h-3 bg-slate-100 rounded w-20 mx-auto" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 h-80" />
        <div className="bg-white rounded-xl border border-slate-200 p-5 h-80" />
      </div>
    </div>
  )
}

function formatPct(value: number | null): string {
  if (value === null) return '-'
  return `${Math.round(value * 100)}%`
}

function formatScore(value: number | null): string {
  if (value === null) return '-'
  return `${Math.round(value)}%`
}

export default function CourseOverviewTab({
  totalStudents,
  totalAssignments,
  avgCompletionRate,
  avgOnTimeRate,
  avgScore,
  studentCompletionRates,
  submissionCounts,
  courseActivity,
  isLoading,
}: CourseOverviewProps) {
  if (isLoading) return <LoadingSkeleton />

  return (
    <div className="space-y-6 overflow-y-auto">
      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Students" value={String(totalStudents)} />
        <MetricCard label="Avg Completion" value={formatPct(avgCompletionRate)} />
        <MetricCard label="Avg On-Time" value={formatPct(avgOnTimeRate)} />
        <MetricCard label="Avg Score" value={formatScore(avgScore)} />
      </div>

      {/* Radar chart + Submission status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Course Performance</h3>
          <CourseOverviewRadarChart
            avgCompletionRate={avgCompletionRate}
            avgOnTimeRate={avgOnTimeRate}
            avgScore={avgScore}
          />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Submission Status</h3>
          <SubmissionStatusChart
            completed={submissionCounts.completed}
            inProgress={submissionCounts.in_progress}
            notStarted={submissionCounts.not_started}
            excused={submissionCounts.excused}
          />
        </div>
      </div>

      {/* Student completion distribution */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Student Completion Distribution</h3>
        <StudentDistributionChart completionRates={studentCompletionRates} />
      </div>

      {/* Course activity timeline */}
      {courseActivity && courseActivity.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Course Activity Over Time</h3>
          <EngagementTimelineChart data={courseActivity} />
        </div>
      )}
    </div>
  )
}
