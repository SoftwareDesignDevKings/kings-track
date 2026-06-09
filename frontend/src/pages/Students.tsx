import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStudents } from '../services/api'
import { downloadCsv } from '../lib/downloadCsv'
import type { StudentListItem } from '../types'

type SortKey = 'name' | 'course_count' | 'avg_completion_rate' | 'avg_on_time_rate' | 'avg_score' | 'attendance_rate'

function formatPct(value: number | null, scale: number = 1): string {
  if (value === null) return '-'
  return `${Math.round(value * scale * 100)}%`
}

function ragColor(value: number | null, threshold: [number, number] = [0.5, 0.8]): string {
  if (value === null) return 'text-slate-400'
  if (value >= threshold[1]) return 'text-emerald-600'
  if (value >= threshold[0]) return 'text-amber-600'
  return 'text-red-600'
}

function attRagColor(value: number | null): string {
  if (value === null) return 'text-slate-400'
  if (value >= 80) return 'text-emerald-600'
  if (value >= 50) return 'text-amber-600'
  return 'text-red-600'
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className = '',
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = currentKey === sortKey
  return (
    <th
      className={`py-2.5 px-3 text-left text-xs font-medium uppercase tracking-wide cursor-pointer select-none transition-colors hover:text-slate-700 ${
        active ? 'text-brand-600' : 'text-slate-400'
      } ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && (
        <span className="ml-1">{currentDir === 'asc' ? '\u2191' : '\u2193'}</span>
      )}
    </th>
  )
}

export default function Students() {
  const { data: students, isLoading, error } = useStudents()
  const [search, setSearch] = useState('')
  const [courseFilter, setCourseFilter] = useState('all')
  const [concernFilter, setConcernFilter] = useState<'all' | 'concern'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [downloading, setDownloading] = useState(false)

  const courseOptions = useMemo(() => {
    if (!students) return []
    const names = new Set<string>()
    students.forEach(s => s.courses.forEach(c => names.add(c.name)))
    return Array.from(names).sort()
  }, [students])

  const filtered = useMemo(() => {
    if (!students) return []
    const q = search.toLowerCase()
    return students
      .filter(s => {
        if (q && !s.name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q) && !(s.sis_id ?? '').toLowerCase().includes(q)) {
          return false
        }
        if (courseFilter !== 'all' && !s.courses.some(c => c.name === courseFilter)) {
          return false
        }
        if (concernFilter === 'concern' && !s.concern.is_concern) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
        const av = a[sortKey] ?? -Infinity
        const bv = b[sortKey] ?? -Infinity
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir
      })
  }, [students, search, courseFilter, concernFilter, sortKey, sortDir])

  async function handleExportCsv() {
    setDownloading(true)
    try {
      await downloadCsv('/reports/student-progress', 'student-progress-report.csv')
    } catch {
      // silent fail — user sees the button reset
    } finally {
      setDownloading(false)
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="h-full w-full overflow-auto">

      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-slate-900">Students</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {students ? `${filtered.length} of ${students.length} student${students.length !== 1 ? 's' : ''}` : 'Loading\u2026'}
          </p>
        </div>

        {/* Filters */}
        {students && students.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by name, email, or SIS ID\u2026"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 w-72"
            />
            <select
              value={courseFilter}
              onChange={e => setCourseFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All courses</option>
              {courseOptions.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setConcernFilter('all')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  concernFilter === 'all'
                    ? 'bg-brand-50 text-brand-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setConcernFilter('concern')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  concernFilter === 'concern'
                    ? 'bg-red-50 text-red-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Concerns
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-pulse">
            <div className="h-10 bg-slate-100 border-b border-slate-200" />
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-12 border-b border-slate-100 bg-white" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            Failed to load students. Make sure the backend is running and courses have been synced.
          </div>
        )}

        {/* Empty */}
        {!isLoading && !error && students && students.length === 0 && (
          <div className="text-center py-20">
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-base font-medium text-slate-600 mb-1">No students yet</h3>
            <p className="text-sm text-slate-400">
              Sync your courses first to see enrolled students here.
            </p>
          </div>
        )}

        {/* Table */}
        {!isLoading && filtered.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <SortHeader label="Name" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="min-w-[180px]" />
                    <th className="py-2.5 px-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">SIS ID</th>
                    <SortHeader label="Courses" sortKey="course_count" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Completion" sortKey="avg_completion_rate" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    <SortHeader label="On-Time" sortKey="avg_on_time_rate" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Avg Score" sortKey="avg_score" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Attendance" sortKey="attendance_rate" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                    <th className="py-2.5 px-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Status</th>
                    <th className="py-2.5 px-3 w-10">
                      <button
                        type="button"
                        onClick={handleExportCsv}
                        disabled={downloading}
                        className={`inline-flex h-8 w-8 items-center justify-center transition-colors ${
                          downloading
                            ? 'text-blue-600 animate-pulse'
                            : 'text-slate-400 hover:text-slate-700'
                        }`}
                        aria-label="Export CSV"
                        title="Export CSV"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5 5m0 0 5-5m-5 5V3" />
                        </svg>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(student => (
                    <StudentRowComponent key={student.id} student={student} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* No results from filter */}
        {!isLoading && students && students.length > 0 && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">
            No students match your filters.
          </div>
        )}
      </main>
    </div>
  )
}

function StudentRowComponent({ student }: { student: StudentListItem }) {
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="py-3 px-3">
        <Link
          to={`/students/${student.id}`}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
        >
          {student.name}
        </Link>
        <p className="text-xs text-slate-400 mt-0.5">{student.email}</p>
      </td>
      <td className="py-3 px-3 text-sm text-slate-500">{student.sis_id ?? '-'}</td>
      <td className="py-3 px-3 text-sm text-slate-700">{student.course_count}</td>
      <td className={`py-3 px-3 text-sm font-medium ${ragColor(student.avg_completion_rate)}`}>
        {formatPct(student.avg_completion_rate)}
      </td>
      <td className={`py-3 px-3 text-sm font-medium ${ragColor(student.avg_on_time_rate)}`}>
        {formatPct(student.avg_on_time_rate)}
      </td>
      <td className={`py-3 px-3 text-sm font-medium ${ragColor(student.avg_score, [50, 80])}`}>
        {student.avg_score !== null ? `${Math.round(student.avg_score)}%` : '-'}
      </td>
      <td className={`py-3 px-3 text-sm font-medium ${attRagColor(student.attendance_rate)}`}>
        {student.attendance_rate !== null ? `${student.attendance_rate}%` : '-'}
      </td>
      <td className="py-3 px-3">
        {student.concern.is_concern ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            student.concern.level === 'high'
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {student.concern.level === 'high' ? 'High' : 'Moderate'}
          </span>
        ) : (
          <span className="text-xs text-slate-300">-</span>
        )}
      </td>
      <td />
    </tr>
  )
}
