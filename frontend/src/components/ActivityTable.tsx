import { useLayoutEffect, useRef } from 'react'

import StatusBadge from './StatusBadge'
import type { CourseMatrix } from '../types'
import {
  buildCanvasActivityColumns,
  getCanvasDueNowCompletionRate,
  getCanvasDueNowCount,
  prepareCanvasActivityView,
  type CanvasActivityColumn,
  type CanvasActivityViewMode,
} from './activityTableModel'

interface Props {
  matrix: CourseMatrix
  viewMode?: CanvasActivityViewMode
}

const MIN_ZONE_LABEL_VISIBLE_WIDTH = 88

function CompletionBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-300 text-xs">—</span>
  const pct = Math.round(value * 100)
  const barColor = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 tabular-nums">{pct}%</span>
    </div>
  )
}

function formatDueDate(dueAt: string | null): string | null {
  if (!dueAt) return null
  const parsed = new Date(dueAt)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString()
}

function getColumnDividerClass(
  columnIndex: number,
  firstFutureIndex: number | null,
): string {
  const isFutureBoundaryEnd = firstFutureIndex !== null && firstFutureIndex > 0 && columnIndex === firstFutureIndex - 1
  if (firstFutureIndex !== null && firstFutureIndex > 0 && columnIndex === firstFutureIndex) {
    return 'timeline-divider-primary-start'
  }
  if (isFutureBoundaryEnd) {
    return 'timeline-divider-primary-end'
  }
  return ''
}

function getZoneDividerClass(
  zoneKey: 'due_now' | 'future' | 'undated',
  firstFutureIndex: number | null,
): string {
  if (zoneKey === 'due_now' && firstFutureIndex !== null && firstFutureIndex > 0) {
    return 'timeline-divider-primary-end'
  }
  if (zoneKey === 'future' && firstFutureIndex !== null && firstFutureIndex > 0) {
    return 'timeline-divider-primary-start'
  }
  return ''
}

function buildAssignmentTitle(column: CanvasActivityColumn): string {
  const dueLabel = formatDueDate(column.due_at)
  const parts = [
    column.name,
    `Group: ${column.source_group_name}`,
    dueLabel ? `Due ${dueLabel}` : 'No due date',
    column.points_possible != null ? `${column.points_possible} pts` : null,
  ]

  return parts.filter(Boolean).join('\n')
}

export default function ActivityTable({ matrix, viewMode = 'due' }: Props) {
  const { assignment_groups, students } = matrix

  const activityColumns = buildCanvasActivityColumns(assignment_groups)
  const activityView = prepareCanvasActivityView(activityColumns, { mode: viewMode })
  const { columns, zones, firstFutureIndex } = activityView
  const dueNowCount = getCanvasDueNowCount(activityView)
  const zoneLayoutKey = zones.map(zone => `${zone.key}:${zone.count}:${zone.label}`).join('|')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickyBoundaryRef = useRef<HTMLTableCellElement | null>(null)
  const zoneHeaderRefs = useRef<Array<HTMLTableCellElement | null>>([])
  const zoneWindowRefs = useRef<Array<HTMLDivElement | null>>([])

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl || zones.length === 0) {
      return
    }

    let frameId = 0
    let viewportLeft = 0
    let zoneBounds: Array<{ left: number; right: number }> = []

    const applyLayouts = () => {
      const viewportRight = scrollEl.clientWidth

      zoneBounds.forEach((bounds, index) => {
        const zoneWindow = zoneWindowRefs.current[index]
        if (!zoneWindow || viewportRight <= viewportLeft) {
          return
        }

        const visibleLeft = Math.max(bounds.left - scrollEl.scrollLeft, viewportLeft)
        const visibleRight = Math.min(bounds.right - scrollEl.scrollLeft, viewportRight)
        const visibleWidth = Math.max(0, visibleRight - visibleLeft)
        const roundedLeft = Math.round(visibleLeft)
        const roundedWidth = Math.round(visibleWidth)
        const isVisible = roundedWidth >= MIN_ZONE_LABEL_VISIBLE_WIDTH

        zoneWindow.style.transform = `translate3d(${roundedLeft}px, 0, 0)`
        zoneWindow.style.width = `${roundedWidth}px`
        zoneWindow.classList.toggle('activity-table-zone-window-visible', isVisible)
        zoneWindow.classList.toggle('activity-table-zone-window-hidden', !isVisible)
      })
    }

    const measureBounds = () => {
      const containerRect = scrollEl.getBoundingClientRect()
      const stickyBoundaryRect = stickyBoundaryRef.current?.getBoundingClientRect()
      viewportLeft = stickyBoundaryRect
        ? Math.max(0, stickyBoundaryRect.right - containerRect.left)
        : 0
      zoneBounds = zones.map((zone, index) => {
        const zoneCell = zoneHeaderRefs.current[index]
        const zoneRect = zoneCell?.getBoundingClientRect()

        if (!zoneRect || zoneRect.width === 0) {
          return { left: viewportLeft, right: viewportLeft }
        }

        return {
          left: zoneRect.left - containerRect.left + scrollEl.scrollLeft,
          right: zoneRect.right - containerRect.left + scrollEl.scrollLeft,
        }
      })
    }

    const scheduleLayout = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(applyLayouts)
    }

    const scheduleMeasure = () => {
      measureBounds()
      scheduleLayout()
    }

    scheduleMeasure()
    scrollEl.addEventListener('scroll', scheduleLayout, { passive: true })
    window.addEventListener('resize', scheduleMeasure)

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null

    resizeObserver?.observe(scrollEl)
    stickyBoundaryRef.current && resizeObserver?.observe(stickyBoundaryRef.current)
    zoneHeaderRefs.current.forEach(zoneHeader => {
      zoneHeader && resizeObserver?.observe(zoneHeader)
    })

    return () => {
      cancelAnimationFrame(frameId)
      scrollEl.removeEventListener('scroll', scheduleLayout)
      window.removeEventListener('resize', scheduleMeasure)
      resizeObserver?.disconnect()
    }
  }, [zoneLayoutKey])

  if (students.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No students found. Trigger a sync to load data.
      </div>
    )
  }

  if (columns.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No published assignments found in this course.
      </div>
    )
  }

  return (
    <div className="activity-table-wrapper border border-slate-200 rounded-xl overflow-hidden">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
        <span className="font-medium">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-emerald-200 inline-block" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-400 ring-2 ring-amber-200 inline-block" />
          In progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-slate-200 ring-2 ring-slate-100 inline-block" />
          Not started
        </span>
      </div>

      <div className="activity-table-scroll-frame">
        <div className="activity-table-zone-overlay" aria-hidden="true">
          {zones.map((zone, index) => (
            <div
              key={zone.key}
              data-zone-key={zone.key}
              ref={element => {
                zoneWindowRefs.current[index] = element
              }}
              className="activity-table-zone-window activity-table-zone-window-hidden"
            >
              <div className="activity-table-zone-label">
                {zone.label}
              </div>
            </div>
          ))}
        </div>
        <div ref={scrollRef} className="activity-table-scroll">
        <table className="activity-table w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th
                className="sticky-col-header-1 px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[220px]"
                rowSpan={2}
              >
                Student
              </th>
              <th
                ref={stickyBoundaryRef}
                className="sticky-col-header-2 px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[130px]"
                rowSpan={2}
              >
                Completion
              </th>
              {zones.map((zone, index) => (
                <th
                  key={zone.key}
                  colSpan={zone.count}
                  ref={element => {
                    zoneHeaderRefs.current[index] = element
                  }}
                  aria-label={zone.label}
                  className={`px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 border-r border-slate-200 bg-slate-50 last:border-r-0 ${getZoneDividerClass(zone.key, firstFutureIndex)}`}
                >
                  <span className="block truncate max-w-xs opacity-0 select-none">
                    {zone.label}
                  </span>
                </th>
              ))}
            </tr>

            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((column, columnIndex) => (
                <th
                  key={column.id}
                  className={`px-2 py-2 text-center text-xs font-medium text-slate-500 border-r border-slate-100 last:border-r-slate-200 max-w-[52px] ${getColumnDividerClass(columnIndex, firstFutureIndex)}`}
                  title={buildAssignmentTitle(column)}
                  data-group-name={column.source_group_name}
                >
                  <span className="block w-10 overflow-hidden text-ellipsis mx-auto text-center leading-tight">
                    {column.name.match(/^\d+\.\d+/) ? column.name.match(/^(\d+\.\d+)/)?.[1] : column.name.slice(0, 4)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {students.map((student, i) => {
              const dueNowCompletionRate = getCanvasDueNowCompletionRate(student, columns, dueNowCount)

              return (
                <tr
                  key={student.id}
                  className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-brand-50/40 transition-colors`}
                >
                  {/* Student name — sticky */}
                  <td className={`sticky-col-1 px-4 py-2.5 border-r border-slate-200 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <span className="font-medium text-slate-800 text-sm">{student.name}</span>
                  </td>

                  {/* Completion bar */}
                  <td className={`sticky-col-2 px-3 py-2.5 border-r border-slate-200 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <CompletionBar value={dueNowCompletionRate} />
                  </td>

                  {columns.map((column, columnIndex) => {
                    const sub = student.submissions[String(column.id)]
                    return (
                      <td
                        key={column.id}
                        className={`px-2 py-2.5 text-center border-r border-slate-100 last:border-r-0 ${getColumnDividerClass(columnIndex, firstFutureIndex)}`}
                      >
                        {sub ? (
                          <StatusBadge
                            status={sub.status}
                            score={sub.score}
                            pointsPossible={column.points_possible}
                            late={sub.late}
                            missing={sub.missing}
                          />
                        ) : (
                          <div className="w-5 h-5 mx-auto rounded-full bg-slate-100" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
