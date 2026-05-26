import { useState, useMemo } from 'react'
import type { CourseEngagementStudent } from '../types'

interface Props {
  students: CourseEngagementStudent[]
}

type SortKey =
  | 'name'
  | 'page_views'
  | 'participations'
  | 'tardiness_on_time'
  | 'tardiness_late'
  | 'tardiness_missing'
  | 'last_page_view_at'
  | 'last_participation_at'
type SortDir = 'asc' | 'desc'

function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return `${Math.floor(diffDays / 30)}mo ago`
}

function isInactive(student: CourseEngagementStudent): boolean {
  if ((student.page_views ?? 0) === 0) return true
  const lastActive = student.last_page_view_at ?? student.last_participation_at
  if (!lastActive) return true
  const diffDays = Math.floor((Date.now() - new Date(lastActive).getTime()) / 86_400_000)
  return diffDays > 14
}

function sortStudents(students: CourseEngagementStudent[], key: SortKey, dir: SortDir): CourseEngagementStudent[] {
  return [...students].sort((a, b) => {
    let av: number | string | null, bv: number | string | null
    if (key === 'name') {
      av = a.sortable_name ?? a.name
      bv = b.sortable_name ?? b.name
    } else if (key === 'last_page_view_at' || key === 'last_participation_at') {
      av = a[key] ? new Date(a[key]!).getTime() : -Infinity
      bv = b[key] ? new Date(b[key]!).getTime() : -Infinity
    } else {
      av = a[key] ?? -Infinity
      bv = b[key] ?? -Infinity
    }
    if (av === bv) return 0
    const less = av < bv ? -1 : 1
    return dir === 'asc' ? less : -less
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="ml-1 text-slate-300">↕</span>
  return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
}

function RelativeBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  let color = 'bg-emerald-400'
  if (pct < 25) color = 'bg-red-400'
  else if (pct < 50) color = 'bg-amber-400'
  return (
    <div className="ml-2 inline-flex items-center w-16" title={`${Math.round(pct)}% of class max (${max})`}>
      <div className="h-1.5 w-full rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function EngagementTable({ students }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('page_views')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const courseMaxPageViews = useMemo(
    () => Math.max(...students.map(s => s.page_views ?? 0), 1),
    [students],
  )

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = sortStudents(students, sortKey, sortDir)
  const inactiveCount = students.filter(isInactive).length

  function th(key: SortKey, label: string, align: 'left' | 'right' = 'right') {
    return (
      <th
        key={key}
        className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleSort(key)}
      >
        {label}
        <SortIcon active={sortKey === key} dir={sortDir} />
      </th>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {inactiveCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400 shrink-0" />
          <span>
            <strong>{inactiveCount}</strong> student{inactiveCount !== 1 ? 's' : ''} with no activity or inactive for &gt;14 days
          </span>
        </div>
      )}

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50">
            <tr>
              {th('name', 'Student', 'left')}
              {th('page_views', 'Page views')}
              {th('participations', 'Participations')}
              {th('tardiness_on_time', 'On time')}
              {th('tardiness_late', 'Late')}
              {th('tardiness_missing', 'Missing')}
              {th('last_page_view_at', 'Last page view')}
              {th('last_participation_at', 'Last participation')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(student => {
              const inactive = isInactive(student)
              const pageViews = student.page_views ?? 0

              return (
                <tr
                  key={student.id}
                  className={`transition-colors ${inactive ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                    {student.name}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    <span>{pageViews}</span>
                    <RelativeBar value={pageViews} max={courseMaxPageViews} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {student.participations ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">
                    {student.tardiness_on_time ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-600">
                    {student.tardiness_late ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-500">
                    {student.tardiness_missing ?? '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right whitespace-nowrap ${inactive && !student.last_page_view_at ? 'text-red-500 font-medium' : 'text-slate-600'}`}>
                    {formatRelativeDate(student.last_page_view_at)}
                  </td>
                  <td className={`px-4 py-2.5 text-right whitespace-nowrap ${inactive && !student.last_participation_at ? 'text-red-500 font-medium' : 'text-slate-600'}`}>
                    {formatRelativeDate(student.last_participation_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
