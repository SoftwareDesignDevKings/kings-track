import { useState } from 'react'
import type {
  StrugglingArea,
  CanvasCourseBreakdown,
  EdStemCourseBreakdown,
  GradeoCourseBreakdown,
} from '../types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function barColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-400'
  if (pct >= 50) return 'bg-amber-400'
  return 'bg-red-400'
}

function textColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-600'
  if (pct >= 50) return 'text-amber-600'
  return 'text-red-600'
}

function Placeholder({ text }: { text: string }) {
  return <p className="text-sm text-slate-400 text-center py-6">{text}</p>
}

const SOURCE_BADGE: Record<string, { label: string; dot: string }> = {
  canvas: { label: 'Canvas', dot: 'bg-blue-500' },
  edstem: { label: 'EdStem', dot: 'bg-purple-500' },
  gradeo: { label: 'Gradeo', dot: 'bg-orange-500' },
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ─── Section wrapper ────────────────────────────────────────────────────────

function SectionCard({ title, icon, children, badge }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100">
        {icon}
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {badge}
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  )
}

// ─── Collapsible course row ─────────────────────────────────────────────────

function CourseAccordion({ name, code, defaultOpen, children }: {
  name: string
  code: string | null
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-slate-700 truncate">{name}</span>
          {code && <span className="text-xs text-slate-400 font-mono shrink-0">{code}</span>}
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-slate-50">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Struggling Areas ──────────────────────────────────────────────────────

const INITIAL_SHOW = 8

interface StrugglingAreasProps {
  areas: StrugglingArea[]
}

export function StrugglingAreas({ areas }: StrugglingAreasProps) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? areas : areas.slice(0, INITIAL_SHOW)
  const hasMore = areas.length > INITIAL_SHOW

  return (
    <SectionCard
      title="Areas of Concern"
      icon={
        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      }
      badge={areas.length > 0 ? (
        <span className="ml-auto text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
          {areas.length} {areas.length === 1 ? 'issue' : 'issues'}
        </span>
      ) : undefined}
    >
      {areas.length === 0 ? (
        <Placeholder text="No areas of concern identified" />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-3 py-2 font-medium text-slate-500 text-xs">Source</th>
                  <th className="px-3 py-2 font-medium text-slate-500 text-xs">Area</th>
                  <th className="px-3 py-2 font-medium text-slate-500 text-xs">Course</th>
                  <th className="px-3 py-2 font-medium text-slate-500 text-xs text-right">Detail</th>
                  <th className="px-3 py-2 font-medium text-slate-500 text-xs w-28">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {shown.map((a, i) => {
                  const badge = SOURCE_BADGE[a.source]
                  return (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-800 font-medium max-w-[200px] truncate">{a.area}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs max-w-[180px] truncate">{a.course_name}</td>
                      <td className="px-3 py-2 text-xs text-slate-400 text-right whitespace-nowrap">{a.detail}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor(a.score_pct)}`} style={{ width: `${Math.min(a.score_pct, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-semibold w-8 text-right ${textColor(a.score_pct)}`}>{a.score_pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-3 w-full text-center text-xs font-medium text-brand-600 hover:text-brand-700 py-1.5 rounded-lg hover:bg-brand-50 transition-colors"
            >
              {expanded ? 'Show less' : `Show all ${areas.length} areas`}
            </button>
          )}
        </>
      )}
    </SectionCard>
  )
}

// ─── Canvas Breakdown ──────────────────────────────────────────────────────

interface CanvasBreakdownProps {
  data: Record<string, CanvasCourseBreakdown>
}

export function CanvasBreakdown({ data }: CanvasBreakdownProps) {
  const entries = Object.entries(data)

  return (
    <SectionCard
      title="Canvas — Assignment Groups"
      icon={<span className="w-4 h-4 rounded bg-blue-500 flex items-center justify-center text-white text-[9px] font-bold">C</span>}
      badge={entries.length > 0 ? (
        <span className="ml-auto text-xs text-slate-400">{entries.length} {entries.length === 1 ? 'course' : 'courses'}</span>
      ) : undefined}
    >
      {entries.length === 0 ? (
        <Placeholder text="No Canvas assignment data" />
      ) : (
        <div className="space-y-2">
          {entries.map(([courseId, course], idx) => (
            <CourseAccordion key={courseId} name={course.course_name} code={course.course_code} defaultOpen={idx === 0}>
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-3 py-2 font-medium text-slate-500">Group</th>
                      <th className="px-3 py-2 font-medium text-slate-500 text-center w-14">Total</th>
                      <th className="px-3 py-2 font-medium text-slate-500 w-40">Progress</th>
                      <th className="px-3 py-2 font-medium text-slate-500 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {course.groups.map((g, i) => {
                      const total = g.total || 1
                      const submittedPct = (g.submitted / total) * 100
                      const gradedPct = (g.graded / total) * 100
                      const latePct = (g.late / total) * 100
                      const missingPct = (g.missing / total) * 100
                      return (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2.5 text-slate-700 font-medium max-w-[180px] truncate">{g.group_name}</td>
                          <td className="px-3 py-2.5 text-center text-slate-500">{g.total}</td>
                          <td className="px-3 py-2.5">
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                              {g.submitted > 0 && <div className="bg-emerald-400 h-full" style={{ width: `${submittedPct}%` }} title={`${g.submitted} submitted`} />}
                              {g.graded > 0 && <div className="bg-blue-400 h-full" style={{ width: `${gradedPct}%` }} title={`${g.graded} graded`} />}
                              {g.late > 0 && <div className="bg-amber-400 h-full" style={{ width: `${latePct}%` }} title={`${g.late} late`} />}
                              {g.missing > 0 && <div className="bg-red-400 h-full" style={{ width: `${missingPct}%` }} title={`${g.missing} missing`} />}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {g.submitted > 0 && <span className="text-emerald-600">{g.submitted} sub</span>}
                              {g.graded > 0 && <span className="text-blue-600">{g.graded} grd</span>}
                              {g.late > 0 && <span className="text-amber-600">{g.late} late</span>}
                              {g.missing > 0 && <span className="text-red-600">{g.missing} miss</span>}
                              {g.submitted === 0 && g.graded === 0 && g.late === 0 && g.missing === 0 && (
                                <span className="text-slate-400">none</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-4 mt-2.5 text-xs text-slate-400 px-1">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Submitted</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Graded</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Late</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Missing</span>
              </div>
            </CourseAccordion>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─── EdStem Breakdown ──────────────────────────────────────────────────────

interface EdStemBreakdownProps {
  data: Record<string, EdStemCourseBreakdown>
}

export function EdStemBreakdown({ data }: EdStemBreakdownProps) {
  const entries = Object.entries(data)

  return (
    <SectionCard
      title="EdStem — Module Progress"
      icon={<span className="w-4 h-4 rounded bg-purple-500 flex items-center justify-center text-white text-[9px] font-bold">E</span>}
      badge={entries.length > 0 ? (
        <span className="ml-auto text-xs text-slate-400">{entries.length} {entries.length === 1 ? 'course' : 'courses'}</span>
      ) : undefined}
    >
      {entries.length === 0 ? (
        <Placeholder text="No EdStem lesson data" />
      ) : (
        <div className="space-y-2">
          {entries.map(([courseId, course], idx) => {
            const totalAll = course.modules.reduce((s, m) => s + m.total_lessons, 0)
            const completedAll = course.modules.reduce((s, m) => s + m.completed, 0)
            const overallPct = totalAll > 0 ? Math.round((completedAll / totalAll) * 100) : 0
            return (
              <CourseAccordion key={courseId} name={course.course_name} code={course.course_code} defaultOpen={idx === 0}>
                <div className="mt-3">
                  {/* Overall course progress */}
                  <div className="flex items-center gap-3 mb-3 px-1">
                    <span className="text-xs text-slate-500">Overall:</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="bg-emerald-400 h-full rounded-full" style={{ width: `${overallPct}%` }} />
                    </div>
                    <span className={`text-xs font-semibold ${textColor(overallPct)}`}>{overallPct}%</span>
                  </div>
                  {/* Per-module table */}
                  <div className="overflow-hidden rounded-lg border border-slate-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          <th className="px-3 py-2 font-medium text-slate-500">Module</th>
                          <th className="px-3 py-2 font-medium text-slate-500 w-40">Progress</th>
                          <th className="px-3 py-2 font-medium text-slate-500 text-right w-24">Completion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {course.modules.map((m, i) => {
                          const total = m.total_lessons || 1
                          const pct = Math.round((m.completed / total) * 100)
                          return (
                            <tr key={i} className="hover:bg-slate-50/50">
                              <td className="px-3 py-2.5 text-slate-700 font-medium max-w-[220px] truncate">{m.module_name}</td>
                              <td className="px-3 py-2.5">
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                                  {m.completed > 0 && <div className="bg-emerald-400 h-full" style={{ width: `${(m.completed / total) * 100}%` }} />}
                                  {m.viewed > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(m.viewed / total) * 100}%` }} />}
                                  {m.not_started > 0 && <div className="bg-slate-300 h-full" style={{ width: `${(m.not_started / total) * 100}%` }} />}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={`font-semibold ${textColor(pct)}`}>{m.completed}/{m.total_lessons}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-4 mt-2.5 text-xs text-slate-400 px-1">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Completed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Viewed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> Not started</span>
                  </div>
                </div>
              </CourseAccordion>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// ─── Gradeo Breakdown ──────────────────────────────────────────────────────

interface GradeoBreakdownProps {
  data: Record<string, GradeoCourseBreakdown>
}

export function GradeoBreakdown({ data }: GradeoBreakdownProps) {
  const entries = Object.entries(data)

  return (
    <SectionCard
      title="Gradeo — Exam Results"
      icon={<span className="w-4 h-4 rounded bg-orange-500 flex items-center justify-center text-white text-[9px] font-bold">G</span>}
      badge={entries.length > 0 ? (
        <span className="ml-auto text-xs text-slate-400">{entries.length} {entries.length === 1 ? 'course' : 'courses'}</span>
      ) : undefined}
    >
      {entries.length === 0 ? (
        <Placeholder text="No Gradeo exam data" />
      ) : (
        <div className="space-y-2">
          {entries.map(([courseId, course], idx) => (
            <CourseAccordion key={courseId} name={course.course_name} code={course.course_code} defaultOpen={idx === 0}>
              <div className="mt-3 space-y-2">
                {course.exams.map((e, i) => {
                  const pct = e.exam_mark != null && e.marks_available && e.marks_available > 0
                    ? Math.round((e.exam_mark / e.marks_available) * 100)
                    : null
                  const classAvgPct = e.class_average != null && e.marks_available && e.marks_available > 0
                    ? Math.round((e.class_average / e.marks_available) * 100)
                    : null
                  const vsAvg = pct != null && classAvgPct != null ? pct - classAvgPct : null

                  return (
                    <div key={i} className="border border-slate-100 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{e.exam_name}</p>
                          {e.syllabus_title && (
                            <p className="text-xs text-slate-400 mt-0.5">{e.syllabus_title}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right ml-3">
                          {pct != null ? (
                            <>
                              <span className={`text-sm font-bold ${textColor(pct)}`}>{pct}%</span>
                              <span className="text-xs text-slate-400 block">
                                {e.exam_mark}/{e.marks_available}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">{e.status === 'not_submitted' ? 'Not submitted' : e.status === 'awaiting_marking' ? 'Awaiting marking' : '—'}</span>
                          )}
                        </div>
                      </div>

                      {pct != null && (
                        <div className="mb-2">
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          {vsAvg != null && (
                            <div className="flex items-center gap-1 mt-1">
                              {vsAvg >= 0 ? (
                                <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" /></svg>
                              ) : (
                                <svg className="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" /></svg>
                              )}
                              <span className={`text-xs ${vsAvg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {vsAvg >= 0 ? '+' : ''}{vsAvg}% vs class avg ({classAvgPct}%)
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {e.topics.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {e.topics.map((t, j) => (
                            <span key={j} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </CourseAccordion>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
