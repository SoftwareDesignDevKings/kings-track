import { useState } from 'react'
import type { CourseEngagementStudent } from '../types'

interface Props {
  students: CourseEngagementStudent[]
}

type SortKey = 'name' | 'page_views' | 'participations' | 'total_activity_time_seconds' | 'last_activity_at'
type SortDir = 'asc' | 'desc'

// page_views_level 0–3 → Tailwind classes (matches Canvas's own RAG scale)
const LEVEL_DOT: Record<number, string> = {
  0: 'bg-red-400',
  1: 'bg-amber-400',
  2: 'bg-emerald-400',
  3: 'bg-emerald-500',
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds === 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'Never'
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
  if (!student.last_activity_at) return true
  const diffDays = Math.floor((Date.now() - new Date(student.last_activity_at).getTime()) / 86_400_000)
  return diffDays > 14
}

function sortStudents(students: CourseEngagementStudent[], key: SortKey, dir: SortDir): CourseEngagementStudent[] {
  return [...students].sort((a, b) => {
    let av: number | string | null, bv: number | string | null
    if (key === 'name') {
      av = a.sortable_name ?? a.name
      bv = b.sortable_name ?? b.name
    } else if (key === 'last_activity_at') {
      av = a.last_activity_at ? new Date(a.last_activity_at).getTime() : -Infinity
      bv = b.last_activity_at ? new Date(b.last_activity_at).getTime() : -Infinity
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

export default function EngagementTable({ students }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('page_views')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 text-center whitespace-nowrap">
                Engagement
              </th>
              {th('page_views', 'Page views')}
              {th('participations', 'Participations')}
              {th('total_activity_time_seconds', 'Time on Canvas')}
              {th('last_activity_at', 'Last seen')}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(student => {
              const level = student.page_views_level ?? 0
              const dotClass = LEVEL_DOT[Math.min(level, 3)] ?? LEVEL_DOT[0]
              const inactive = isInactive(student)

              return (
                <tr
                  key={student.id}
                  className={`transition-colors ${inactive ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                    {student.name}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`}
                      title={`Level ${level} — ${['No activity', 'Low', 'Medium', 'High'][Math.min(level, 3)]}`}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {student.page_views ?? '—'}
                    {student.max_page_views != null && student.page_views != null && (
                      <span className="ml-1 text-xs text-slate-400">
                        / {student.max_page_views}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {student.participations ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {formatDuration(student.total_activity_time_seconds)}
                  </td>
                  <td className={`px-4 py-2.5 text-right whitespace-nowrap ${inactive ? 'text-red-500 font-medium' : 'text-slate-600'}`}>
                    {formatLastSeen(student.last_activity_at)}
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
