import type {
  CourseGroupMatrix,
  CourseMatrix,
  EdStemMatrix,
  EdStemLessonStatus,
  GradeoCourseReport,
  GradeoExam,
  GradeoQuestionResult,
  GradeoResultStatus,
  GradeoTopicBandCell,
  GradeoTopicBands,
  GradeoTopicSummary,
  SubmissionStatus,
} from '../types'
import {
  buildCanvasActivityColumns,
  getCanvasDueNowCompletionRate,
  getCanvasDueNowCount,
  prepareCanvasActivityView,
  type CanvasActivityColumn,
} from './activityTableModel'
import { formatPercent } from './MatrixTable'
import type {
  MatrixCell,
  MatrixCellStatus,
  MatrixColumn,
  MatrixColumnGroup,
  MatrixLegendItem,
  MatrixTableModel,
} from './matrixTableTypes'

const canvasStatusMap: Record<SubmissionStatus, MatrixCellStatus> = {
  completed: 'completed',
  in_progress: 'in_progress',
  not_started: 'not_started',
  excused: 'excused',
}

const edStemStatusMap: Record<EdStemLessonStatus, MatrixCellStatus> = {
  completed: 'completed',
  viewed: 'viewed',
  not_started: 'not_started',
}

const gradeoStatusMap: Record<GradeoResultStatus, MatrixCellStatus> = {
  scored: 'scored',
  awaiting_marking: 'awaiting_marking',
  not_submitted: 'not_submitted',
}

const canvasFlagLegends: MatrixLegendItem[] = [
  { id: 'late', label: 'Late', flags: { late: true } },
]

function formatDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString()
}

function formatMark(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function shortCanvasLabel(column: CanvasActivityColumn) {
  return column.name.match(/^\d+\.\d+/)?.[1] ?? column.name.slice(0, 4)
}

function buildCanvasTooltip(column: CanvasActivityColumn) {
  const dueLabel = formatDate(column.due_at)
  return [
    column.name,
    `Group: ${column.source_group_name}`,
    dueLabel ? `Due ${dueLabel}` : 'No due date',
    column.points_possible != null ? `${column.points_possible} pts` : null,
  ].filter(Boolean).join('\n')
}

function getCanvasDivider(columnIndex: number, firstFutureIndex: number | null) {
  if (firstFutureIndex !== null && firstFutureIndex > 0 && columnIndex === firstFutureIndex) {
    return 'timeline-divider-primary-start'
  }
  if (firstFutureIndex !== null && firstFutureIndex > 0 && columnIndex === firstFutureIndex - 1) {
    return 'timeline-divider-primary-end'
  }
  return ''
}

function getCanvasZoneDivider(zoneKey: 'due_now' | 'future' | 'undated', firstFutureIndex: number | null) {
  if (firstFutureIndex === null || firstFutureIndex <= 0) return ''
  if (zoneKey === 'due_now') return 'timeline-divider-primary-end'
  if (zoneKey === 'future') return 'timeline-divider-primary-start'
  return ''
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function shortenLabels(labels: string[]): string[] {
  if (labels.length < 2) return labels
  const counts = new Map<string, number>()
  for (const label of labels) {
    const match = label.match(/^([^\s_\-]+[\s_\-])/)
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  let bestPrefix: string | null = null
  let bestCount = 0
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      bestPrefix = prefix
      bestCount = count
    }
  }
  const threshold = Math.max(2, Math.ceil(labels.length * 0.5))
  if (!bestPrefix || bestCount < threshold) return labels
  const prefix = bestPrefix
  return labels.map(label => {
    if (!label.startsWith(prefix)) return label
    const stripped = label.slice(prefix.length).trim()
    return stripped.length > 0 ? stripped : label
  })
}

export function buildCanvasMatrixTableModel(matrix: CourseMatrix): MatrixTableModel {
  const activityColumns = buildCanvasActivityColumns(matrix.assignment_groups)
  const activityView = prepareCanvasActivityView(activityColumns)
  const dueNowCount = getCanvasDueNowCount(activityView)
  let cursor = 0

  const columnGroups: MatrixColumnGroup[] = activityView.zones.map(zone => {
    const zoneColumns = activityView.columns.slice(cursor, cursor + zone.count)
    const columns: MatrixColumn[] = zoneColumns.map(column => {
      const columnIndex = activityView.columns.findIndex(item => item.id === column.id)
      return {
        id: String(column.id),
        label: column.name,
        shortLabel: shortCanvasLabel(column),
        tooltip: buildCanvasTooltip(column),
        headerVariant: 'short',
        widthClass: 'w-11 min-w-11 max-w-11',
        dividerClassName: getCanvasDivider(columnIndex, activityView.firstFutureIndex),
        dataGroupName: column.source_group_name,
      }
    })
    cursor += zone.count
    return {
      id: zone.key,
      label: zone.label,
      columns,
      dividerClassName: getCanvasZoneDivider(zone.key, activityView.firstFutureIndex),
    }
  })

  const rows = matrix.students.map(student => {
    const visibleScorePcts: number[] = []
    let lateCount = 0

    const cells: Record<string, MatrixCell> = {}
    for (const column of activityView.columns) {
      const sub = student.submissions[String(column.id)]
      if (sub?.late) lateCount += 1
      if (sub?.score != null && column.points_possible != null && column.points_possible > 0) {
        visibleScorePcts.push(sub.score / column.points_possible)
      }

      const status = canvasStatusMap[sub?.status ?? 'not_started']
      const scoreLine = sub?.score != null && column.points_possible != null
        ? `${sub.score} / ${column.points_possible} pts`
        : sub?.score != null
          ? `${sub.score} pts`
          : null

      cells[String(column.id)] = {
        status,
        label: sub?.status ?? 'not_started',
        tooltip: [
          column.name,
          status === 'not_started' ? 'Not started' : sub?.status?.replace(/_/g, ' '),
          scoreLine,
        ].filter(Boolean).join('\n'),
        marks: {
          earned: sub?.score ?? null,
          available: column.points_possible,
          unit: 'pts',
        },
        flags: {
          late: Boolean(sub?.late),
        },
        ariaLabel: `${student.name}, ${column.name}: ${sub?.status?.replace(/_/g, ' ') ?? 'not started'}${sub?.late ? ', late' : ''}`,
      }
    }

    return {
      id: student.id,
      name: student.name,
      sortableName: student.sortable_name,
      summaryValue: getCanvasDueNowCompletionRate(student, activityView.columns, dueNowCount),
      summaryLabel: 'Due-now completion',
      lateCount,
      averageMarkPct: average(visibleScorePcts),
      cells,
    }
  })

  return {
    title: 'Canvas Tasks',
    showToolbarSummary: false,
    tableClassName: 'activity-table-matrix-canvas',
    floatingColumnGroupLabels: true,
    summaryHeader: 'Completion',
    supportsMarks: true,
    emptyRowsMessage: 'No students found. Trigger a sync to load data.',
    emptyColumnsMessage: 'No published assignments found in this course.',
    rows,
    columnGroups,
    legends: [
      { id: 'completed', label: 'Completed', status: 'completed' },
      { id: 'in_progress', label: 'In progress', status: 'in_progress' },
      { id: 'not_started', label: 'Not started', status: 'not_started' },
      ...canvasFlagLegends,
    ],
  }
}

export function buildEdStemMatrixTableModel(matrix: EdStemMatrix): MatrixTableModel {
  const modules = matrix.modules ?? []
  const allLessons = modules.flatMap(module => module.lessons)

  return {
    title: 'EdStem Lessons',
    showToolbarSummary: false,
    tableClassName: 'activity-table-matrix-rotated',
    floatingColumnGroupLabels: true,
    summaryHeader: 'Completion',
    supportsMarks: false,
    emptyRowsMessage: 'No students found. Trigger a sync to load data.',
    emptyColumnsMessage: 'No lessons found for this EdStem course.',
    columnGroups: modules.map(module => {
      const shortTitles = shortenLabels(module.lessons.map(lesson => lesson.title))
      return {
        id: module.name,
        label: module.name,
        columns: module.lessons.map((lesson, index) => ({
          id: String(lesson.id),
          label: shortTitles[index],
          tooltip: lesson.title + (lesson.is_interactive ? ' (interactive)' : ''),
          headerVariant: 'wide',
          widthClass: 'w-28 min-w-28 max-w-28',
        })),
      }
    }),
    rows: (matrix.students ?? []).map(student => ({
      id: student.id,
      name: student.name,
      sortableName: student.sortable_name,
      summaryValue: student.completion_rate,
      cells: Object.fromEntries(allLessons.map(lesson => {
        const progress = student.progress[String(lesson.id)]
        const status = edStemStatusMap[progress?.status ?? 'not_started']
        return [String(lesson.id), {
          status,
          label: progress?.status ?? 'not_started',
          tooltip: [
            lesson.title,
            status === 'not_started' ? 'Not started' : progress?.status?.replace(/_/g, ' '),
            progress?.completed_at ? `Completed ${new Date(progress.completed_at).toLocaleDateString()}` : null,
          ].filter(Boolean).join('\n'),
          flags: {},
          ariaLabel: `${student.name}, ${lesson.title}: ${progress?.status?.replace(/_/g, ' ') ?? 'not started'}`,
        } satisfies MatrixCell]
      })),
    })),
    legends: [
      { id: 'completed', label: 'Completed', status: 'completed' },
      { id: 'viewed', label: 'Viewed', status: 'viewed' },
      { id: 'not_started', label: 'Not started', status: 'not_started' },
    ],
  }
}

function buildQuestionTooltip(exam: GradeoExam, questions: GradeoQuestionResult[]) {
  return [
    exam.name,
    exam.syllabus_title ? `Syllabus: ${exam.syllabus_title}` : null,
    exam.topics.length ? `Topics: ${exam.topics.join(', ')}` : null,
    ...questions.map(question => {
      const label = [question.question, question.question_part].filter(Boolean).join(' · ')
      const mark = question.mark != null || question.marks_available != null
        ? ` (${question.mark ?? '—'}/${question.marks_available ?? '—'})`
        : ''
      const feedback = question.feedback ? ` — ${question.feedback}` : ''
      return `${label || question.gradeo_question_part_id}${mark}${feedback}`
    }),
  ].filter(Boolean).join('\n')
}

export function buildGradeoReportMatrixTableModel(
  report: GradeoCourseReport,
  hiddenStudents: Array<{ id: number; name: string }> = [],
): MatrixTableModel {
  const exams = report.exams ?? []
  const rows = (report.students ?? []).map(student => {
    const markPcts: number[] = []
    let scoredCount = 0

    const cells = Object.fromEntries(exams.map(exam => {
      const result = student.results[exam.id]
      if (!result) {
        return [exam.id, {
          status: 'unassigned',
          label: 'Not assigned',
          tooltip: `${exam.name}\nNot assigned`,
          flags: {},
          ariaLabel: `${exam.name}: Not assigned`,
        } satisfies MatrixCell]
      }

      if (result.status === 'scored') scoredCount += 1
      if (result.exam_mark != null && result.marks_available != null && result.marks_available > 0) {
        markPcts.push(result.exam_mark / result.marks_available)
      }

      const status = gradeoStatusMap[result.status]
      const scoreLine = result.status === 'scored'
        ? `Score: ${result.exam_mark ?? '—'}/${result.marks_available ?? '—'}`
        : result.status === 'awaiting_marking'
          ? 'Awaiting marking'
          : 'Not submitted'

      return [exam.id, {
        status,
        label: result.status,
        tooltip: [
          exam.name,
          scoreLine,
          result.class_average != null ? `Class avg: ${result.class_average}` : null,
          buildQuestionTooltip(exam, result.questions),
        ].filter(Boolean).join('\n'),
        marks: {
          earned: result.exam_mark,
          available: result.marks_available,
        },
        flags: {},
        ariaLabel: `${student.name}, ${exam.name}: ${result.status.replace(/_/g, ' ')}`,
      } satisfies MatrixCell]
    }))

    return {
      id: student.id,
      name: student.name,
      sortableName: student.sortable_name,
      summaryValue: student.completion_rate,
      scoredCount,
      averageMarkPct: average(markPcts),
      cells,
    }
  })

  return {
    title: 'Gradeo Results',
    showToolbarSummary: false,
    tableClassName: 'activity-table-matrix-rotated',
    floatingColumnGroupLabels: true,
    summaryHeader: 'Completion',
    supportsMarks: true,
    emptyRowsMessage: 'No students found. Refresh the Gradeo directory and import a class from the extension first.',
    emptyColumnsMessage: 'No Gradeo exams have been imported for this course yet.',
    rows,
    columnGroups: (() => {
      const shortNames = shortenLabels(exams.map(exam => exam.name))
      return [{
        id: 'gradeo-results',
        label: 'Results',
        columns: exams.map((exam, index) => ({
          id: exam.id,
          label: shortNames[index],
          tooltip: [
            exam.name,
            exam.class_average != null ? `Class avg: ${exam.class_average}` : null,
            exam.topics.length ? `Topics: ${exam.topics.join(', ')}` : null,
            exam.outcomes.length ? `Outcomes: ${exam.outcomes.join(', ')}` : null,
          ].filter(Boolean).join('\n'),
          headerVariant: 'wide',
          widthClass: 'w-28 min-w-28 max-w-28',
        })),
      }]
    })(),
    legends: [
      { id: 'scored', label: 'Scored', status: 'scored' },
      { id: 'awaiting_marking', label: 'Awaiting marking', status: 'awaiting_marking' },
      { id: 'not_submitted', label: 'Not submitted', status: 'not_submitted' },
    ],
    hiddenFooter: hiddenStudents.length > 0 ? (
      <p
        className="cursor-help px-4 py-3 text-xs text-slate-400"
        title={hiddenStudents.map(s => s.name).join('\n')}
      >
        {hiddenStudents.length} student{hiddenStudents.length === 1 ? '' : 's'} hidden — not in Gradeo roster for this class
      </p>
    ) : null,
  }
}

function bandToneClass(band: number) {
  if (band >= 5) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (band >= 3) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

function buildTopicHeaderTitle(topic: GradeoTopicSummary) {
  return [
    topic.name,
    `${topic.student_count} student${topic.student_count === 1 ? '' : 's'}`,
    `Average ${formatPercent(topic.average_score_pct)}`,
  ].join('\n')
}

function buildTopicCellTitle(studentName: string, topicName: string, cell: GradeoTopicBandCell) {
  return [
    `${studentName} · ${topicName}`,
    `Band B${cell.predicted_band}`,
    `Score ${formatPercent(cell.score_pct)}`,
    `Confidence ${cell.confidence}`,
    `Marks ${formatMark(cell.earned_marks)}/${formatMark(cell.available_marks)}`,
    `${cell.exam_count} exam${cell.exam_count === 1 ? '' : 's'}`,
    `${cell.part_count} part${cell.part_count === 1 ? '' : 's'}`,
  ].join('\n')
}

function renderTopicBandCell(studentName: string, topicName: string, cell: GradeoTopicBandCell | undefined) {
  if (!cell) {
    return (
      <span
        className="mx-auto block text-center text-sm font-semibold text-slate-300"
        title={`${studentName} · ${topicName}\nNo topic evidence`}
        aria-label={`${studentName}, ${topicName}: no topic evidence`}
      >
        —
      </span>
    )
  }

  const title = buildTopicCellTitle(studentName, topicName, cell)
  return (
    <span
      title={title}
      aria-label={title.replace(/\n/g, ', ')}
      className={`mx-auto flex h-14 w-20 flex-col items-center justify-center rounded-md border ${bandToneClass(cell.predicted_band)}`}
    >
      <span className="text-sm font-bold leading-none">B{cell.predicted_band}</span>
      <span className="mt-1 text-xs font-medium leading-none tabular-nums">{formatPercent(cell.score_pct)}</span>
      <span className="mt-1 max-w-[4.5rem] truncate rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-500">
        {cell.confidence}
      </span>
    </span>
  )
}

export function buildGradeoTopicBandsMatrixTableModel(topicBands: GradeoTopicBands): MatrixTableModel {
  const topics = topicBands.topics ?? []
  const rows = (topicBands.students ?? []).map(student => {
    const scorePcts = Object.values(student.topics).map(topic => topic.score_pct)
    return {
      id: student.id,
      name: student.name,
      sortableName: student.sortable_name,
      summaryValue: average(scorePcts),
      averageMarkPct: average(scorePcts),
      cells: Object.fromEntries(topics.map(topic => {
        const cell = student.topics[topic.name]
        return [topic.name, {
          status: 'evidence',
          label: cell ? `B${cell.predicted_band}` : 'No topic evidence',
          tooltip: cell ? buildTopicCellTitle(student.name, topic.name, cell) : `${student.name} · ${topic.name}\nNo topic evidence`,
          renderStatus: renderTopicBandCell(student.name, topic.name, cell),
          flags: {},
          ariaLabel: cell
            ? buildTopicCellTitle(student.name, topic.name, cell).replace(/\n/g, ', ')
            : `${student.name}, ${topic.name}: no topic evidence`,
        } satisfies MatrixCell]
      })),
    }
  })

  return {
    title: 'Gradeo Topic Bands',
    showToolbarSummary: false,
    tableClassName: 'activity-table-matrix-wide',
    floatingColumnGroupLabels: true,
    summaryHeader: 'Avg topic',
    supportsMarks: false,
    emptyRowsMessage: 'No students found. Refresh the Gradeo directory and import a class from the extension first.',
    emptyColumnsMessage: 'No topic-band evidence found yet. Import Gradeo CSV question rows with topic labels to populate this view.',
    rows,
    columnGroups: [{
      id: 'gradeo-topic-bands',
      label: 'Topic Bands',
      columns: topics.map(topic => ({
        id: topic.name,
        label: topic.name,
        shortLabel: `Avg ${formatPercent(topic.average_score_pct)}`,
        tooltip: buildTopicHeaderTitle(topic),
        headerVariant: 'wide',
        widthClass: 'w-40 min-w-40 max-w-40',
      })),
    }],
    legends: [
      { id: 'b6', label: 'B6 90+' },
      { id: 'b5', label: 'B5 80+' },
      { id: 'b4', label: 'B4 70+' },
      { id: 'b3', label: 'B3 60+' },
      { id: 'b2', label: 'B2 50+' },
      { id: 'b1', label: 'B1 <50' },
    ],
  }
}

export function buildCourseGroupMatrixTableModel(matrix: CourseGroupMatrix): MatrixTableModel {
  const base = buildCanvasMatrixTableModel(matrix)
  const classCodeByStudentId = new Map<number, string | null>(
    matrix.students.map(s => [s.id, s.class_code]),
  )
  return {
    ...base,
    rows: base.rows.map(row => ({
      ...row,
      subtitle: classCodeByStudentId.get(row.id as number)?.replace(/_\d{4}$/, '') ?? undefined,
    })),
  }
}
