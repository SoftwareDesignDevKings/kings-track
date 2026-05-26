import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'

import type {
  MatrixCell,
  MatrixCellFlags,
  MatrixCellStatus,
  MatrixDisplayMode,
  MatrixTableModel,
  MatrixTableRow,
} from './matrixTableTypes'

interface Props {
  model: MatrixTableModel
}

const MIN_GROUP_LABEL_VISIBLE_WIDTH = 88
const MIN_SCROLLBAR_THUMB_SIZE = 32
const SCROLLBAR_OVERLAY_SIZE = 4
const SCROLLBAR_IDLE_HIDE_DELAY_MS = 800
const SCROLLBAR_PROXIMITY_THRESHOLD = 20

type ScrollbarAxis = 'horizontal' | 'vertical'

interface ActiveScrollbarState {
  horizontal: boolean
  vertical: boolean
}

interface MatrixScrollbarState {
  showHorizontal: boolean
  showVertical: boolean
  horizontalThumbWidth: number
  horizontalThumbLeft: number
  verticalThumbHeight: number
  verticalThumbTop: number
}

const hiddenScrollbarState: MatrixScrollbarState = {
  showHorizontal: false,
  showVertical: false,
  horizontalThumbWidth: 0,
  horizontalThumbLeft: 0,
  verticalThumbHeight: 0,
  verticalThumbTop: 0,
}

const inactiveScrollbars: ActiveScrollbarState = {
  horizontal: false,
  vertical: false,
}

const statusConfig: Record<MatrixCellStatus, { dot: string; ring: string; label: string; icon?: 'check' | 'ellipsis' }> = {
  completed: { dot: 'bg-emerald-400', ring: 'ring-emerald-200', label: 'Completed', icon: 'check' },
  scored: { dot: 'bg-emerald-400', ring: 'ring-emerald-200', label: 'Scored', icon: 'check' },
  viewed: { dot: 'bg-amber-400', ring: 'ring-amber-200', label: 'Viewed' },
  in_progress: { dot: 'bg-amber-400', ring: 'ring-amber-200', label: 'In progress', icon: 'ellipsis' },
  awaiting_marking: { dot: 'bg-amber-400', ring: 'ring-amber-200', label: 'Awaiting marking' },
  not_started: { dot: 'bg-slate-200', ring: 'ring-slate-100', label: 'Not started' },
  not_submitted: { dot: 'bg-slate-200', ring: 'ring-slate-100', label: 'Not submitted' },
  excused: { dot: 'bg-slate-300', ring: 'ring-slate-200', label: 'Excused' },
  unassigned: { dot: 'bg-transparent', ring: 'ring-transparent', label: 'Not assigned' },
  evidence: { dot: 'bg-brand-100', ring: 'ring-brand-200', label: 'Evidence' },
}

const columnHelper = createColumnHelper<MatrixTableRow>()

function formatPercent(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function formatNumber(value: number | null | undefined) {
  if (value == null) return '—'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)))
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null
  const m = mean(values) as number
  let sq = 0
  for (const v of values) sq += (v - m) ** 2
  return Math.sqrt(sq / values.length)
}

function cellMarkValue(cell: MatrixCell | undefined): number | null {
  const marks = cell?.marks
  if (!marks) return null
  const { earned, available } = marks
  if (typeof earned !== 'number' || !Number.isFinite(earned)) return null
  if (typeof available !== 'number' || !Number.isFinite(available) || available <= 0) return null
  return earned
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function calculateScrollbarState(scrollEl: HTMLDivElement): MatrixScrollbarState {
  const {
    clientHeight,
    clientWidth,
    scrollHeight,
    scrollLeft,
    scrollTop,
    scrollWidth,
  } = scrollEl
  const showHorizontal = scrollWidth > clientWidth + 1
  const showVertical = scrollHeight > clientHeight + 1

  if (!showHorizontal && !showVertical) {
    return hiddenScrollbarState
  }

  const horizontalTrackWidth = Math.max(0, clientWidth - (showVertical ? SCROLLBAR_OVERLAY_SIZE : 0))
  const verticalTrackHeight = Math.max(0, clientHeight - (showHorizontal ? SCROLLBAR_OVERLAY_SIZE : 0))
  const horizontalThumbWidth = showHorizontal && horizontalTrackWidth > 0
    ? Math.min(horizontalTrackWidth, Math.max(MIN_SCROLLBAR_THUMB_SIZE, (clientWidth / scrollWidth) * horizontalTrackWidth))
    : 0
  const verticalThumbHeight = showVertical && verticalTrackHeight > 0
    ? Math.min(verticalTrackHeight, Math.max(MIN_SCROLLBAR_THUMB_SIZE, (clientHeight / scrollHeight) * verticalTrackHeight))
    : 0
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  const maxHorizontalThumbLeft = Math.max(0, horizontalTrackWidth - horizontalThumbWidth)
  const maxVerticalThumbTop = Math.max(0, verticalTrackHeight - verticalThumbHeight)

  return {
    showHorizontal,
    showVertical,
    horizontalThumbWidth,
    horizontalThumbLeft: maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * maxHorizontalThumbLeft : 0,
    verticalThumbHeight,
    verticalThumbTop: maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxVerticalThumbTop : 0,
  }
}

function CheckIcon({ className = 'h-2.5 w-2.5', toneClass = 'text-white' }: { className?: string; toneClass?: string }) {
  return (
    <svg className={`${className} ${toneClass}`} fill="none" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EllipsisIcon() {
  return (
    <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="2.2" cy="5" r="0.85" />
      <circle cx="5" cy="5" r="0.85" />
      <circle cx="7.8" cy="5" r="0.85" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m21 21-4.35-4.35m1.6-5.4a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
    </svg>
  )
}

function SortIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 4v16m0 0-3-3m3 3 3-3m8-13v16m0-16-3 3m3-3 3 3" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5 5m0 0 5-5m-5 5V3" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.5 9a2.7 2.7 0 0 1 5.2.95c0 2.05-2.7 2.35-2.7 4.05m0 3h.01" />
      <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
    </svg>
  )
}

function CheckMenuIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 13 4 4L19 7" />
    </svg>
  )
}

function FlagSymbol({ kind }: { kind: 'late' | 'missing' }) {
  return (
    <span
      className={`text-[13px] font-black leading-none drop-shadow-[0_1px_0_rgba(255,255,255,0.95)] ${
        kind === 'late' ? 'text-amber-600' : 'text-rose-600'
      }`}
      aria-hidden="true"
    >
      !
    </span>
  )
}

function FlagMarkers({ flags }: { flags?: MatrixCellFlags }) {
  if (!flags?.missing) return null

  return (
    <span className="pointer-events-none absolute -right-1.5 -top-2 flex items-center gap-0.5">
      {flags.missing && <FlagSymbol kind="missing" />}
    </span>
  )
}

function StatusDot({ status, flags, className = 'h-5 w-5' }: {
  status: MatrixCellStatus
  flags?: MatrixCellFlags
  className?: string
}) {
  const cfg = statusConfig[status]
  const isLate = flags?.late === true

  if (status === 'unassigned') {
    return <span className="text-[11px] font-semibold text-slate-300">-</span>
  }

  return (
    <span
      className={`relative inline-flex ${className} items-center justify-center rounded-full ${
        isLate
          ? 'border border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100 shadow-[0_0_0_2px_rgba(16,185,129,0.14),inset_0_1px_2px_rgba(16,185,129,0.22)]'
          : `${cfg.dot} ${cfg.ring}`
      } ring-2 ${
        flags?.missing ? 'outline outline-1 outline-rose-300' : ''
      }`}
    >
      {isLate ? <CheckIcon toneClass="text-emerald-700" /> : cfg.icon === 'check' ? <CheckIcon /> : null}
      {!isLate && cfg.icon === 'ellipsis' && <EllipsisIcon />}
      <FlagMarkers flags={flags} />
    </span>
  )
}

function CompletionBar({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-slate-300">—</span>
  const pct = Math.round(value * 100)
  const barColor = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
    </div>
  )
}

function buildCellTitle(cell: MatrixCell, mode: MatrixDisplayMode) {
  const parts = [cell.tooltip]
  if (mode === 'marks' && cell.marks) {
    parts.push(`Marks ${formatNumber(cell.marks.earned)}/${formatNumber(cell.marks.available)}${cell.marks.unit ? ` ${cell.marks.unit}` : ''}`)
  }
  if (cell.flags?.late) parts.push('Late')
  if (cell.flags?.missing) parts.push('Missing')
  return parts.filter(Boolean).join('\n')
}

function MatrixCellView({ cell, mode }: { cell: MatrixCell | undefined; mode: MatrixDisplayMode }) {
  if (!cell) {
    return (
      <span className="mx-auto flex h-6 w-9 items-center justify-center">
        <span className="block h-5 w-5 rounded-full bg-slate-100" aria-label="No data" />
      </span>
    )
  }

  const title = buildCellTitle(cell, mode)
  const ariaLabel = cell.ariaLabel ?? title.replace(/\n/g, ', ')

  if (mode === 'marks' && cell.renderMarks) {
    return <span title={title} aria-label={ariaLabel}>{cell.renderMarks}</span>
  }

  if (mode === 'marks' && cell.marks) {
    const hasNoMark = cell.status === 'not_started' || cell.status === 'not_submitted' || cell.status === 'unassigned'
    const isCompleteMark = cell.status === 'completed' || cell.status === 'scored'
    const lateClass = cell.flags?.late
      ? 'border border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-100 shadow-[0_0_0_2px_rgba(16,185,129,0.14),inset_0_1px_2px_rgba(16,185,129,0.22)]'
      : ''
    const completeClass = isCompleteMark
      ? 'bg-emerald-400 text-white ring-2 ring-emerald-200'
      : ''
    return (
      <span
        className={`relative mx-auto inline-flex h-6 w-9 items-center justify-center rounded-md px-1 text-[11px] font-semibold leading-none tabular-nums ${
          hasNoMark
            ? 'bg-slate-50 text-slate-300'
            : lateClass || completeClass || 'bg-white text-slate-700 ring-1 ring-slate-200'
        }`}
        title={title}
        aria-label={ariaLabel}
      >
        {formatNumber(cell.marks.earned)}
      </span>
    )
  }

  if (cell.renderStatus) {
    return <>{cell.renderStatus}</>
  }

  return (
    <span title={title} aria-label={ariaLabel} className="mx-auto flex h-6 w-9 items-center justify-center">
      <StatusDot status={cell.status} flags={cell.flags} />
    </span>
  )
}

function LegendItem({ item }: { item: MatrixTableModel['legends'][number] }) {
  if (item.render) {
    return <span className="inline-flex items-center gap-1.5">{item.render}{item.label}</span>
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {item.status && <StatusDot status={item.status} flags={item.flags} className="h-3 w-3" />}
      {!item.status && (
        <span className="inline-flex h-3 w-3 items-center justify-center">
          {item.flags?.late && <StatusDot status="completed" flags={{ late: true }} className="h-3 w-3" />}
          {item.flags?.missing && <FlagSymbol kind="missing" />}
        </span>
      )}
      {item.label}
    </span>
  )
}

function LegendPopover({ items, subtitle }: { items: MatrixTableModel['legends']; subtitle?: string }) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className={`inline-flex h-8 w-8 items-center justify-center transition-colors focus:outline-none ${
          open ? 'text-blue-600' : 'text-slate-400 hover:text-slate-700 focus-visible:text-blue-600'
        }`}
        aria-label={open ? 'Hide legend' : 'Show legend'}
        aria-expanded={open}
        title="Legend"
      >
        <HelpIcon />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Legend"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-52 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg"
        >
          <div className="flex flex-col items-start gap-2">
            {items.map(item => <LegendItem key={item.id} item={item} />)}
            {subtitle && <span className="pt-1 text-slate-400">{subtitle}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function getRowValue(row: MatrixTableRow, sortId: string) {
  switch (sortId) {
    case 'completion':
      return row.summaryValue ?? -1
    case 'lateCount':
      return row.lateCount ?? 0
    case 'missingCount':
      return row.missingCount ?? 0
    case 'averageMarkPct':
      return row.averageMarkPct ?? -1
    case 'scoredCount':
      return row.scoredCount ?? 0
    default:
      return row.sortableName ?? row.name
  }
}

function hasAnyRowValue(rows: MatrixTableRow[], key: 'lateCount' | 'missingCount' | 'averageMarkPct' | 'scoredCount') {
  return rows.some(row => {
    const value = row[key]
    return value !== undefined && value !== null && value !== 0
  })
}

export default function MatrixTable({ model }: Props) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [displayMode, setDisplayMode] = useState<MatrixDisplayMode>(model.defaultDisplayMode ?? 'status')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'student', desc: false }])
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [visibleTableWidth, setVisibleTableWidth] = useState<number | null>(null)
  const [scrollbarState, setScrollbarState] = useState<MatrixScrollbarState>(hiddenScrollbarState)
  const [activeScrollbars, setActiveScrollbars] = useState<ActiveScrollbarState>(inactiveScrollbars)
  const toolbarControlId = useId()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const filterPopoverRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickyBoundaryRef = useRef<HTMLTableCellElement | null>(null)
  const groupHeaderRefs = useRef<Array<HTMLTableCellElement | null>>([])
  const groupWindowRefs = useRef<Array<HTMLDivElement | null>>([])
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const scrollbarHideTimerRefs = useRef<Record<ScrollbarAxis, number | null>>({
    horizontal: null,
    vertical: null,
  })
  const previousScrollPositionRef = useRef({ left: 0, top: 0 })

  const clearScrollbarHideTimer = (axis: ScrollbarAxis) => {
    if (scrollbarHideTimerRefs.current[axis] !== null) {
      window.clearTimeout(scrollbarHideTimerRefs.current[axis]!)
      scrollbarHideTimerRefs.current[axis] = null
    }
  }

  const clearScrollbarHideTimers = () => {
    clearScrollbarHideTimer('horizontal')
    clearScrollbarHideTimer('vertical')
  }

  const scheduleScrollbarHide = (axis: ScrollbarAxis) => {
    clearScrollbarHideTimer(axis)
    scrollbarHideTimerRefs.current[axis] = window.setTimeout(() => {
      setActiveScrollbars(current => ({ ...current, [axis]: false }))
      scrollbarHideTimerRefs.current[axis] = null
    }, SCROLLBAR_IDLE_HIDE_DELAY_MS)
  }

  const showScrollbarTemporarily = (axis: ScrollbarAxis) => {
    setActiveScrollbars(current => current[axis] ? current : { ...current, [axis]: true })
    scheduleScrollbarHide(axis)
  }

  const showScrollbarWhileInteracting = (axis: ScrollbarAxis) => {
    clearScrollbarHideTimer(axis)
    setActiveScrollbars(current => current[axis] ? current : { ...current, [axis]: true })
  }

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    }
  }, [searchOpen])

  useEffect(() => {
    if (!filterOpen) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!filterPopoverRef.current?.contains(event.target as Node)) {
        setFilterOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [filterOpen])

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const updateScrollMetrics = () => {
      setVisibleTableWidth(scrollEl.clientWidth)
      setScrollbarState(calculateScrollbarState(scrollEl))
    }

    const handleScroll = () => {
      const previousPosition = previousScrollPositionRef.current
      const movedHorizontally = scrollEl.scrollLeft !== previousPosition.left
      const movedVertically = scrollEl.scrollTop !== previousPosition.top

      updateScrollMetrics()
      previousScrollPositionRef.current = {
        left: scrollEl.scrollLeft,
        top: scrollEl.scrollTop,
      }

      if (movedHorizontally) showScrollbarTemporarily('horizontal')
      if (movedVertically) showScrollbarTemporarily('vertical')
    }

    updateScrollMetrics()
    previousScrollPositionRef.current = {
      left: scrollEl.scrollLeft,
      top: scrollEl.scrollTop,
    }

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollMetrics)
      : null

    resizeObserver?.observe(scrollEl)
    scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', updateScrollMetrics)

    return () => {
      clearScrollbarHideTimers()
      resizeObserver?.disconnect()
      scrollEl.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', updateScrollMetrics)
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    }
  }, [])

  const handleScrollbarTrackMouseDown = (
    axis: 'horizontal' | 'vertical',
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) return

    const scrollEl = scrollRef.current
    if (!scrollEl) return

    event.preventDefault()
    showScrollbarTemporarily(axis)
    const rect = event.currentTarget.getBoundingClientRect()

    if (axis === 'horizontal') {
      const maxScrollLeft = scrollEl.scrollWidth - scrollEl.clientWidth
      const maxThumbLeft = Math.max(1, rect.width - scrollbarState.horizontalThumbWidth)
      const requestedThumbLeft = event.clientX - rect.left - (scrollbarState.horizontalThumbWidth / 2)
      scrollEl.scrollLeft = clamp(requestedThumbLeft, 0, maxThumbLeft) / maxThumbLeft * maxScrollLeft
    } else {
      const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight
      const maxThumbTop = Math.max(1, rect.height - scrollbarState.verticalThumbHeight)
      const requestedThumbTop = event.clientY - rect.top - (scrollbarState.verticalThumbHeight / 2)
      scrollEl.scrollTop = clamp(requestedThumbTop, 0, maxThumbTop) / maxThumbTop * maxScrollTop
    }

    previousScrollPositionRef.current = {
      left: scrollEl.scrollLeft,
      top: scrollEl.scrollTop,
    }
    setScrollbarState(calculateScrollbarState(scrollEl))
  }

  const handleScrollbarThumbMouseDown = (
    axis: 'horizontal' | 'vertical',
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    const scrollEl = scrollRef.current
    const trackEl = event.currentTarget.parentElement
    if (!scrollEl || !trackEl) return

    event.preventDefault()
    event.stopPropagation()
    showScrollbarWhileInteracting(axis)
    dragCleanupRef.current?.()

    const trackRect = trackEl.getBoundingClientRect()
    const thumbSize = axis === 'horizontal'
      ? scrollbarState.horizontalThumbWidth
      : scrollbarState.verticalThumbHeight
    const maxScroll = axis === 'horizontal'
      ? scrollEl.scrollWidth - scrollEl.clientWidth
      : scrollEl.scrollHeight - scrollEl.clientHeight
    const maxThumbOffset = Math.max(1, (axis === 'horizontal' ? trackRect.width : trackRect.height) - thumbSize)
    const startPointer = axis === 'horizontal' ? event.clientX : event.clientY
    const startScroll = axis === 'horizontal' ? scrollEl.scrollLeft : scrollEl.scrollTop

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const pointer = axis === 'horizontal' ? moveEvent.clientX : moveEvent.clientY
      const nextScroll = startScroll + ((pointer - startPointer) / maxThumbOffset) * maxScroll

      if (axis === 'horizontal') {
        scrollEl.scrollLeft = clamp(nextScroll, 0, maxScroll)
      } else {
        scrollEl.scrollTop = clamp(nextScroll, 0, maxScroll)
      }

      previousScrollPositionRef.current = {
        left: scrollEl.scrollLeft,
        top: scrollEl.scrollTop,
      }
      setScrollbarState(calculateScrollbarState(scrollEl))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      dragCleanupRef.current = null
      scheduleScrollbarHide(axis)
    }

    dragCleanupRef.current = handleMouseUp
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleScrollFrameMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const nearHorizontalScrollbar = scrollbarState.showHorizontal
      && event.clientY >= rect.top
      && rect.bottom - event.clientY <= SCROLLBAR_PROXIMITY_THRESHOLD
    const nearVerticalScrollbar = scrollbarState.showVertical
      && event.clientX >= rect.left
      && rect.right - event.clientX <= SCROLLBAR_PROXIMITY_THRESHOLD

    if (nearHorizontalScrollbar) showScrollbarTemporarily('horizontal')
    if (nearVerticalScrollbar) showScrollbarTemporarily('vertical')
  }

  const handleScrollFrameMouseLeave = () => {
    if (activeScrollbars.horizontal) scheduleScrollbarHide('horizontal')
    if (activeScrollbars.vertical) scheduleScrollbarHide('vertical')
  }

  const flattenedColumns = useMemo(
    () => model.columnGroups.flatMap(group => group.columns),
    [model.columnGroups],
  )
  const groupLayoutKey = model.columnGroups.map(group => `${group.id}:${group.label}:${group.columns.length}`).join('|')

  const tableColumns = useMemo(() => [
    columnHelper.accessor(row => row.sortableName ?? row.name, {
      id: 'student',
      header: 'Student',
      cell: info => info.getValue(),
      sortingFn: 'alphanumeric',
    }),
    columnHelper.accessor(row => row.summaryValue ?? -1, {
      id: 'completion',
      header: model.summaryHeader ?? 'Completion',
    }),
    columnHelper.accessor(row => row.lateCount ?? 0, { id: 'lateCount', header: 'Late' }),
    columnHelper.accessor(row => row.missingCount ?? 0, { id: 'missingCount', header: 'Missing' }),
    columnHelper.accessor(row => row.averageMarkPct ?? -1, { id: 'averageMarkPct', header: 'Avg mark' }),
    columnHelper.accessor(row => row.scoredCount ?? 0, { id: 'scoredCount', header: 'Scored' }),
  ], [model.summaryHeader])

  const table = useReactTable({
    data: model.rows,
    columns: tableColumns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue).trim().toLowerCase()
      if (!query) return true
      const original = row.original
      return [original.name, original.sortableName].filter(Boolean).some(value =>
        String(value).toLowerCase().includes(query),
      )
    },
  })

  const sortOptions = [
    { id: 'student', label: 'Student A-Z', desc: false },
    { id: 'completion', label: `${model.summaryHeader ?? 'Completion'} high-low`, desc: true },
    ...(hasAnyRowValue(model.rows, 'lateCount') ? [{ id: 'lateCount', label: 'Late tasks high-low', desc: true }] : []),
    ...(hasAnyRowValue(model.rows, 'missingCount') ? [{ id: 'missingCount', label: 'Missing tasks high-low', desc: true }] : []),
    ...(hasAnyRowValue(model.rows, 'averageMarkPct') ? [{ id: 'averageMarkPct', label: 'Average mark high-low', desc: true }] : []),
    ...(hasAnyRowValue(model.rows, 'scoredCount') ? [{ id: 'scoredCount', label: 'Scored count high-low', desc: true }] : []),
  ]
  const selectedSort = sorting[0] ?? { id: 'student', desc: false }
  const selectedSortValue = `${selectedSort.id}:${selectedSort.desc ? 'desc' : 'asc'}`
  const hasActiveSort = selectedSortValue !== 'student:asc'
  const visibleRows = table.getRowModel().rows

  const columnSummaries = useMemo(() => {
    const perColumn: Record<string, { mean: number | null; median: number | null; stdev: number | null }> = {}
    let anyValue = false
    for (const column of flattenedColumns) {
      const values: number[] = []
      for (const row of visibleRows) {
        const v = cellMarkValue(row.original.cells[column.id])
        if (v != null) values.push(v)
      }
      if (values.length > 0) anyValue = true
      perColumn[column.id] = { mean: mean(values), median: median(values), stdev: stdev(values) }
    }
    const summaryValues: number[] = []
    for (const row of visibleRows) {
      const v = row.original.summaryValue
      if (typeof v === 'number' && Number.isFinite(v)) summaryValues.push(v)
    }
    const completion = {
      mean: mean(summaryValues),
      median: median(summaryValues),
      stdev: stdev(summaryValues),
    }
    return { perColumn, completion, hasValues: anyValue }
  }, [visibleRows, flattenedColumns])

  const showColumnSummaries = displayMode === 'marks' && visibleRows.length > 0 && columnSummaries.hasValues

  const columnDenominators = useMemo(() => {
    const out: Record<string, number | null> = {}
    for (const column of flattenedColumns) {
      let denom: number | null = null
      for (const row of model.rows) {
        const available = row.cells[column.id]?.marks?.available
        if (typeof available === 'number' && Number.isFinite(available) && available > 0) {
          denom = available
          break
        }
      }
      out[column.id] = denom
    }
    return out
  }, [model.rows, flattenedColumns])

  const showColumnDenominators = displayMode === 'marks'

  const showToolbarSummary = model.showToolbarSummary === true
  const showFloatingGroupLabels = model.floatingColumnGroupLabels === true
  const swapCompactLegendWithModeToggle = !showToolbarSummary && model.supportsMarks === true

  const legendContent = (
    <>
      {model.legends.map(item => <LegendItem key={item.id} item={item} />)}
      {model.subtitle && <span className="text-slate-400">{model.subtitle}</span>}
    </>
  )

  const displayModeToggle = model.supportsMarks ? (
    <div className="inline-flex h-8 items-center gap-1">
      {(['status', 'marks'] as const).map(mode => (
        <button
          key={mode}
          type="button"
          onClick={() => setDisplayMode(mode)}
          className={`h-8 rounded-md px-3 text-sm font-medium capitalize transition-colors ${
            displayMode === mode ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  ) : null

  useLayoutEffect(() => {
    if (!showFloatingGroupLabels) return

    const scrollEl = scrollRef.current
    if (!scrollEl || model.columnGroups.length === 0) {
      return
    }

    let frameId = 0
    let viewportLeft = 0
    let groupBounds: Array<{ left: number; right: number }> = []

    const applyLayouts = () => {
      const viewportRight = scrollEl.clientWidth

      groupBounds.forEach((bounds, index) => {
        const groupWindow = groupWindowRefs.current[index]
        if (!groupWindow || viewportRight <= viewportLeft) {
          return
        }

        const visibleLeft = Math.max(bounds.left - scrollEl.scrollLeft, viewportLeft)
        const visibleRight = Math.min(bounds.right - scrollEl.scrollLeft, viewportRight)
        const visibleWidth = Math.max(0, visibleRight - visibleLeft)
        const roundedLeft = Math.round(visibleLeft)
        const roundedWidth = Math.round(visibleWidth)
        const isVisible = roundedWidth >= MIN_GROUP_LABEL_VISIBLE_WIDTH

        groupWindow.style.transform = `translate3d(${roundedLeft}px, 0, 0)`
        groupWindow.style.width = `${roundedWidth}px`
        groupWindow.classList.toggle('activity-table-zone-window-visible', isVisible)
        groupWindow.classList.toggle('activity-table-zone-window-hidden', !isVisible)
      })
    }

    const measureBounds = () => {
      const containerRect = scrollEl.getBoundingClientRect()
      const stickyBoundaryRect = stickyBoundaryRef.current?.getBoundingClientRect()
      viewportLeft = stickyBoundaryRect
        ? Math.max(0, stickyBoundaryRect.right - containerRect.left)
        : 0

      groupBounds = model.columnGroups.map((_, index) => {
        const groupCell = groupHeaderRefs.current[index]
        const groupRect = groupCell?.getBoundingClientRect()

        if (!groupRect || groupRect.width === 0) {
          return { left: viewportLeft, right: viewportLeft }
        }

        return {
          left: groupRect.left - containerRect.left + scrollEl.scrollLeft,
          right: groupRect.right - containerRect.left + scrollEl.scrollLeft,
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
    groupHeaderRefs.current.forEach(groupHeader => {
      groupHeader && resizeObserver?.observe(groupHeader)
    })

    return () => {
      cancelAnimationFrame(frameId)
      scrollEl.removeEventListener('scroll', scheduleLayout)
      window.removeEventListener('resize', scheduleMeasure)
      resizeObserver?.disconnect()
    }
  }, [showFloatingGroupLabels, groupLayoutKey, model.columnGroups])

  if (model.rows.length === 0) {
    return <div className="py-16 text-center text-sm text-slate-400">{model.emptyRowsMessage}</div>
  }

  if (flattenedColumns.length === 0) {
    return <div className="py-16 text-center text-sm text-slate-400">{model.emptyColumnsMessage}</div>
  }

  return (
    <>
      <div className={`activity-table-wrapper overflow-hidden rounded-xl border border-slate-200 bg-white ${model.className ?? ''}`}>
        <div className="shrink-0 border-b border-slate-200 bg-slate-50/90 px-2 py-2">
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${showToolbarSummary ? 'justify-between' : 'justify-end'}`}>
            {showToolbarSummary && (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{model.title}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                    {visibleRows.length}/{model.rows.length} {model.rowNoun ?? 'students'}
                  </span>
                </div>
              </div>
            )}

            {!showToolbarSummary && (
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  {swapCompactLegendWithModeToggle ? displayModeToggle : legendContent}
                </div>
              </div>
            )}

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <div
                id={`${toolbarControlId}-search`}
                className={`relative h-8 origin-left overflow-hidden transition-[width,transform] duration-200 ease-out ${
                  searchOpen ? 'w-52 scale-100' : 'w-8 scale-95'
                }`}
              >
                <input
                  ref={searchInputRef}
                  type="search"
                  value={globalFilter}
                  onChange={event => setGlobalFilter(event.target.value)}
                  onBlur={event => {
                    if (!event.currentTarget.value) {
                      setSearchOpen(false)
                    }
                  }}
                  placeholder="Search students"
                  disabled={!searchOpen}
                  className={`h-8 w-52 rounded-md border bg-white pl-8 pr-8 text-sm text-slate-700 outline-none transition-[border-color,opacity] focus:border-blue-500 focus:ring-0 ${
                    searchOpen ? 'border-slate-300 opacity-100' : 'border-transparent opacity-0'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className={`absolute left-0 top-0 inline-flex h-8 w-8 items-center justify-center text-sm font-medium transition-colors ${
                    globalFilter || searchOpen
                      ? 'text-blue-600'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                  aria-controls={`${toolbarControlId}-search`}
                  aria-expanded={searchOpen}
                  aria-label="Search students"
                  title="Search students"
                >
                  <SearchIcon />
                </button>
                {globalFilter && (
                  <button
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                      setGlobalFilter('')
                      setSearchOpen(false)
                    }}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <ClearIcon />
                  </button>
                )}
              </div>
              <div ref={filterPopoverRef} className="relative">
                <button
                  type="button"
                  onClick={() => setFilterOpen(open => !open)}
                  className={`inline-flex h-8 w-8 items-center justify-center text-sm font-medium transition-colors ${
                    hasActiveSort || filterOpen
                      ? 'text-blue-600'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                  aria-controls={`${toolbarControlId}-filter`}
                  aria-expanded={filterOpen}
                  aria-label="Sort students"
                  title="Sort students"
                >
                  <SortIcon />
                </button>
                <div
                  id={`${toolbarControlId}-filter`}
                  role="dialog"
                  aria-label="Sort options"
                  aria-hidden={!filterOpen}
                  className={`absolute right-0 top-[calc(100%+0.4rem)] z-50 w-64 origin-top-right rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg transition-[opacity,transform] duration-150 ease-out ${
                    filterOpen ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1 scale-95 opacity-0'
                  }`}
                >
                  <div role="menu" aria-label="Sort order" className="flex flex-col gap-0.5">
                    {sortOptions.map(option => (
                      <button
                        key={`${option.id}:${option.desc ? 'desc' : 'asc'}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selectedSortValue === `${option.id}:${option.desc ? 'desc' : 'asc'}`}
                        disabled={!filterOpen}
                        onClick={() => {
                          setSorting([{ id: option.id, desc: option.desc }])
                          setFilterOpen(false)
                        }}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                          selectedSortValue === `${option.id}:${option.desc ? 'desc' : 'asc'}`
                            ? 'bg-blue-50 text-blue-600'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {selectedSortValue === `${option.id}:${option.desc ? 'desc' : 'asc'}` && <CheckMenuIcon />}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {model.onExport && (
                <button
                  type="button"
                  onClick={model.onExport}
                  disabled={model.exportLoading}
                  className={`inline-flex h-8 w-8 items-center justify-center text-sm font-medium transition-colors ${
                    model.exportLoading
                      ? 'text-blue-600 animate-pulse'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                  aria-label="Export CSV"
                  title="Export CSV"
                >
                  <DownloadIcon />
                </button>
              )}
              {!swapCompactLegendWithModeToggle && displayModeToggle}
              {swapCompactLegendWithModeToggle && (
                <LegendPopover items={model.legends} subtitle={model.subtitle} />
              )}
            </div>
          </div>

          {showToolbarSummary && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {legendContent}
            </div>
          )}
        </div>

        <div
          className="activity-table-scroll-frame"
          onMouseMove={handleScrollFrameMouseMove}
          onMouseLeave={handleScrollFrameMouseLeave}
        >
          {showFloatingGroupLabels && (
            <div className="activity-table-zone-overlay" aria-hidden="true">
              {model.columnGroups.map((group, index) => (
                <div
                  key={group.id}
                  data-zone-key={group.id}
                  ref={element => {
                    groupWindowRefs.current[index] = element
                  }}
                  className="activity-table-zone-window activity-table-zone-window-hidden"
                >
                  <div className="activity-table-zone-label">{group.label}</div>
                </div>
              ))}
            </div>
          )}
          <div ref={scrollRef} className="activity-table-scroll">
            <table className={`activity-table w-full text-sm ${model.tableClassName ?? ''}`}>
            <thead>
              {model.columnGroups.length >= 1 && (
              <tr className="bg-slate-50 border-b border-slate-200">
                {table.getHeaderGroups()[0].headers.slice(0, 2).map(header => (
                  <th
                    key={header.id}
                    ref={element => {
                      if (header.column.id === 'completion') {
                        stickyBoundaryRef.current = element
                      }
                    }}
                    className={`${header.column.id === 'student' ? 'sticky-col-header-1' : 'sticky-col-header-2'} border-r border-slate-200 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500`}
                    rowSpan={2}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
                {model.columnGroups.map((group, index) => (
                  <th
                    key={group.id}
                    colSpan={group.columns.length}
                    ref={element => {
                      groupHeaderRefs.current[index] = element
                    }}
                    aria-label={group.label}
                    className={`border-r border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 last:border-r-0 ${group.dividerClassName ?? ''}`}
                  >
                    <span
                      className={`block truncate ${showFloatingGroupLabels ? 'select-none opacity-0' : ''}`}
                      title={group.label}
                    >
                      {group.label}
                    </span>
                  </th>
                ))}
              </tr>
              )}
              <tr className="bg-slate-50 border-b border-slate-200">
                {flattenedColumns.map(column => {
                  const denom = columnDenominators[column.id]
                  const showDenom = showColumnDenominators && denom != null
                  const reserveDenomSlot = showColumnDenominators && denom == null
                  return (
                  <th
                    key={column.id}
                    className={`${column.widthClass ?? 'h-[130px] w-11 min-w-11 max-w-11'} border-r border-slate-100 px-0 py-0 align-bottom text-center last:border-r-slate-200 ${column.dividerClassName ?? ''}`}
                    title={column.tooltip ?? column.label}
                    data-group-name={column.dataGroupName}
                  >
                    {column.headerVariant === 'wide' ? (
                      <div className="mx-auto flex w-full flex-col items-center gap-0.5 px-1 py-2 text-center">
                        <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium leading-tight text-slate-500" title={column.label}>{column.label}</span>
                        {column.shortLabel && <span className="text-[10px] font-medium leading-none text-slate-400">{column.shortLabel}</span>}
                        {showDenom && <span className="text-[10px] font-normal leading-none text-slate-400 tabular-nums">/{denom}</span>}
                        {reserveDenomSlot && <span aria-hidden="true" className="text-[10px] font-normal leading-none tabular-nums opacity-0">/0</span>}
                      </div>
                    ) : column.headerVariant === 'short' ? (
                      <span className="mx-auto flex w-10 flex-col items-center gap-0.5 overflow-hidden px-1 py-2 text-center text-xs font-medium leading-tight text-slate-500">
                        <span className="block w-full overflow-hidden text-ellipsis">{column.shortLabel ?? column.label}</span>
                        {showDenom && <span className="text-[10px] font-normal text-slate-400 tabular-nums">/{denom}</span>}
                        {reserveDenomSlot && <span aria-hidden="true" className="text-[10px] font-normal tabular-nums opacity-0">/0</span>}
                      </span>
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-end gap-0.5 px-1 pb-1">
                        <span className="block max-h-[104px] overflow-hidden text-ellipsis whitespace-nowrap text-center text-xs font-medium leading-tight text-slate-500 [transform:rotate(180deg)] [writing-mode:vertical-rl]">
                          {column.label}
                        </span>
                        {showDenom && <span className="text-[10px] font-normal text-slate-400 tabular-nums">/{denom}</span>}
                        {reserveDenomSlot && <span aria-hidden="true" className="text-[10px] font-normal tabular-nums opacity-0">/0</span>}
                      </div>
                    )}
                  </th>
                  )
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={flattenedColumns.length + 2} className="bg-slate-100 p-0">
                    <div
                      role="status"
                      className="sticky left-0 flex min-h-48 items-center justify-center px-4 text-center text-sm font-medium text-slate-500"
                      style={visibleTableWidth ? { width: `${visibleTableWidth}px` } : undefined}
                    >
                      No students found.
                    </div>
                  </td>
                </tr>
              ) : visibleRows.map((row, index) => {
                const original = row.original
                const rowBg = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                return (
                  <tr key={original.id} className={`${rowBg} transition-colors hover:bg-brand-50/40`}>
                    <td className={`sticky-col-1 border-r border-slate-200 px-4 py-2.5 ${rowBg}`}>
                      <span className="text-sm font-medium text-slate-800">{original.name}</span>
                    </td>
                    <td className={`sticky-col-2 border-r border-slate-200 px-3 py-2.5 ${rowBg}`}>
                      <CompletionBar value={original.summaryValue} />
                    </td>
                    {flattenedColumns.map(column => {
                      const cell = original.cells[column.id]
                      const lateCellClass = displayMode === 'marks' && cell?.flags?.late
                        ? ''
                        : ''
                      return (
                        <td
                          key={column.id}
                          className={`border-r border-slate-100 px-2 py-2.5 text-center last:border-r-0 ${lateCellClass} ${column.cellClassName ?? ''} ${column.dividerClassName ?? ''}`}
                        >
                          <MatrixCellView cell={cell} mode={displayMode} />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {showColumnSummaries && (['mean', 'median', 'stdev'] as const).map((stat, statIndex) => {
                const label = stat === 'mean' ? 'Average' : stat === 'median' ? 'Median' : 'Std Dev'
                const rowBg = 'bg-slate-50'
                const topBorder = statIndex === 0 ? 'border-t-2 border-slate-300' : ''
                return (
                  <tr key={`summary-${stat}`} className={`${rowBg} ${topBorder} font-medium text-slate-700`}>
                    <td className={`sticky-col-1 border-r border-slate-200 px-4 py-2 ${rowBg} ${topBorder}`}>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                    </td>
                    <td className={`sticky-col-2 border-r border-slate-200 px-3 py-2 text-sm ${rowBg} ${topBorder}`}>
                      {formatPercent(columnSummaries.completion[stat])}
                    </td>
                    {flattenedColumns.map(column => (
                      <td
                        key={column.id}
                        className={`border-r border-slate-100 px-2 py-2 text-center text-sm last:border-r-0 ${column.dividerClassName ?? ''}`}
                      >
                        {formatNumber(columnSummaries.perColumn[column.id]?.[stat] ?? null)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
            </table>
          </div>
          {scrollbarState.showHorizontal && (
            <div
              aria-hidden="true"
              className={`activity-table-scrollbar activity-table-scrollbar-horizontal ${
                activeScrollbars.horizontal ? 'activity-table-scrollbar-visible' : ''
              }`}
              data-testid="matrix-scrollbar-horizontal"
              onMouseDown={event => handleScrollbarTrackMouseDown('horizontal', event)}
              style={{ right: scrollbarState.showVertical ? 'var(--activity-table-scrollbar-size)' : 0 }}
            >
              <div
                className="activity-table-scrollbar-thumb"
                data-testid="matrix-scrollbar-horizontal-thumb"
                onMouseDown={event => handleScrollbarThumbMouseDown('horizontal', event)}
                style={{
                  transform: `translate3d(${Math.round(scrollbarState.horizontalThumbLeft)}px, 0, 0)`,
                  width: `${scrollbarState.horizontalThumbWidth}px`,
                }}
              />
            </div>
          )}
          {scrollbarState.showVertical && (
            <div
              aria-hidden="true"
              className={`activity-table-scrollbar activity-table-scrollbar-vertical ${
                activeScrollbars.vertical ? 'activity-table-scrollbar-visible' : ''
              }`}
              data-testid="matrix-scrollbar-vertical"
              onMouseDown={event => handleScrollbarTrackMouseDown('vertical', event)}
              style={{ bottom: scrollbarState.showHorizontal ? 'var(--activity-table-scrollbar-size)' : 0 }}
            >
              <div
                className="activity-table-scrollbar-thumb"
                data-testid="matrix-scrollbar-vertical-thumb"
                onMouseDown={event => handleScrollbarThumbMouseDown('vertical', event)}
                style={{
                  height: `${scrollbarState.verticalThumbHeight}px`,
                  transform: `translate3d(0, ${Math.round(scrollbarState.verticalThumbTop)}px, 0)`,
                }}
              />
            </div>
          )}
        </div>
      </div>
      {model.hiddenFooter}
    </>
  )
}

export { StatusDot, formatPercent, formatNumber, getRowValue }
