import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import CanvasOutageBanner from '../components/CanvasOutageBanner'
import { useStudents } from '../services/api'
import type { StudentListItem } from '../types'

function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  const v = value <= 1 && value > 0 ? Math.round(value * 100) : Math.round(value)
  return `${v}%`
}

function scoreStr(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toFixed(1)
}

function rateColor(rate: number | null | undefined): string {
  if (rate == null) return 'text-slate-400'
  const v = rate <= 1 ? rate * 100 : rate
  if (v >= 80) return 'text-emerald-600'
  if (v >= 60) return 'text-amber-600'
  return 'text-red-600'
}

function concernBadge(concern: StudentListItem['concern']) {
  if (!concern.is_concern) return null
  const colors = concern.level === 'high'
    ? 'bg-red-100 text-red-700 border-red-200'
    : 'bg-amber-100 text-amber-700 border-amber-200'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colors}`}>
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      {concern.level === 'high' ? 'High Concern' : 'Moderate'}
    </span>
  )
}

/** Normalise a rate to 0-100 for sorting. completion/on_time are 0-1, attendance/score are 0-100. */
function toSortable(val: number | null | undefined, isDecimal: boolean): number {
  if (val == null) return -1
  return isDecimal ? val * 100 : val
}

type SortKey = 'completion' | 'ontime' | 'score' | 'attendance'
type SortDir = 'asc' | 'desc'

const SORT_ACCESSORS: Record<SortKey, { get: (s: StudentListItem) => number; isDecimal: boolean }> = {
  completion: { get: s => toSortable(s.avg_completion_rate, true), isDecimal: true },
  ontime:     { get: s => toSortable(s.avg_on_time_rate, true), isDecimal: true },
  score:      { get: s => toSortable(s.avg_score, false), isDecimal: false },
  attendance: { get: s => toSortable(s.attendance_rate, false), isDecimal: false },
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg className={`w-3.5 h-3.5 inline-block ml-0.5 ${active ? 'text-slate-800' : 'text-slate-300'}`} viewBox="0 0 16 16" fill="currentColor">
      <path d={dir === 'asc' || !active
        ? 'M8 4l4 5H4l4-5z'   // up arrow
        : 'M8 12l4-5H4l4 5z'  // down arrow
      } />
    </svg>
  )
}

export default function Students() {
  const { data: students, isLoading } = useStudents()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'concern'>('all')
  const [classFilter, setClassFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Derive unique course list from all students for the class dropdown
  const availableCourses = useMemo(() => {
    if (!students) return []
    const map = new Map<number, string>()
    for (const s of students) {
      for (const c of s.courses) {
        if (!map.has(c.id)) map.set(c.id, c.name)
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [students])

  const filtered = useMemo(() => {
    let list = students ?? []
    if (statusFilter === 'concern') list = list.filter(s => s.concern.is_concern)
    if (classFilter !== 'all') {
      const cid = Number(classFilter)
      list = list.filter(s => s.courses.some(c => c.id === cid))
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.sis_id?.toLowerCase().includes(q)
      )
    }
    // Sort
    if (sortKey) {
      const accessor = SORT_ACCESSORS[sortKey]
      list = [...list].sort((a, b) => {
        const av = accessor.get(a)
        const bv = accessor.get(b)
        const diff = av - bv
        return sortDir === 'asc' ? diff : -diff
      })
    }
    return list
  }, [students, search, statusFilter, classFilter, sortKey, sortDir])

  const concernCount = (students ?? []).filter(s => s.concern.is_concern).length

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      // Toggle direction, or clear on third click
      if (sortDir === 'asc') {
        setSortDir('desc')
      } else {
        setSortKey(null)
        setSortDir('asc')
      }
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function thSortable(label: string, key: SortKey) {
    const active = sortKey === key
    return (
      <th
        className="text-center px-3 py-3 font-medium text-slate-600 cursor-pointer select-none hover:bg-slate-100 transition-colors"
        onClick={() => handleSort(key)}
      >
        {label}
        <SortIcon active={active} dir={active ? sortDir : 'asc'} />
      </th>
    )
  }

  const isFiltered = classFilter !== 'all' || statusFilter !== 'all' || search

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <CanvasOutageBanner />

      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Students</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {students ? `${students.length} students across all courses` : 'Loading...'}
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            type="text"
            placeholder="Search students..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] max-w-xs px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />

          {/* Status toggle */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All ({students?.length ?? 0})
            </button>
            <button
              onClick={() => setStatusFilter('concern')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === 'concern' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Concerns ({concernCount})
            </button>
          </div>

          {/* Class filter */}
          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          >
            <option value="all">All Classes</option>
            {availableCourses.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Clear all */}
          {(isFiltered || sortKey) && (
            <button
              onClick={() => { setClassFilter('all'); setStatusFilter('all'); setSearch(''); setSortKey(null); setSortDir('asc') }}
              className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              Reset all
            </button>
          )}
        </div>

        {/* Results count when filtered */}
        {isFiltered && (
          <p className="text-xs text-slate-500 mb-3">
            Showing {filtered.length} of {students?.length ?? 0} students
          </p>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <div className="animate-pulse space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-12 bg-slate-100 rounded" />
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        {!isLoading && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Student</th>
                    <th className="text-left px-3 py-3 font-medium text-slate-600">Class</th>
                    {thSortable('Completion', 'completion')}
                    {thSortable('On-Time', 'ontime')}
                    {thSortable('Avg Score', 'score')}
                    {thSortable('Attendance', 'attendance')}
                    <th className="text-center px-3 py-3 font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/students/${s.id}`} className="hover:text-brand-600 transition-colors">
                          <p className="font-medium text-slate-800">{s.name}</p>
                          <p className="text-xs text-slate-400">{s.email}</p>
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.courses.length > 0
                            ? s.courses.map(c => (
                                <span key={c.id} className="inline-block px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded">
                                  {c.name}
                                </span>
                              ))
                            : <span className="text-xs text-slate-400">—</span>
                          }
                        </div>
                      </td>
                      <td className={`text-center px-3 py-3 font-medium ${rateColor(s.avg_completion_rate)}`}>{pct(s.avg_completion_rate)}</td>
                      <td className={`text-center px-3 py-3 font-medium ${rateColor(s.avg_on_time_rate)}`}>{pct(s.avg_on_time_rate)}</td>
                      <td className="text-center px-3 py-3 text-slate-600">{scoreStr(s.avg_score)}</td>
                      <td className={`text-center px-3 py-3 font-medium ${rateColor(s.attendance_rate)}`}>{pct(s.attendance_rate)}</td>
                      <td className="text-center px-3 py-3">{concernBadge(s.concern)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-slate-400">
                        {(students?.length ?? 0) === 0 ? 'No students synced yet. Go to Settings to add courses and sync.' : 'No students match your filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
