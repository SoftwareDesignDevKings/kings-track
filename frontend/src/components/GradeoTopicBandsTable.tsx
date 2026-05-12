import type { GradeoTopicBandCell, GradeoTopicBands, GradeoTopicSummary } from '../types'

interface Props {
  topicBands: GradeoTopicBands
}

function formatPercent(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function formatMark(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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

function TopicBandCell({
  studentName,
  topicName,
  cell,
}: {
  studentName: string
  topicName: string
  cell: GradeoTopicBandCell | undefined
}) {
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
    <div
      title={title}
      aria-label={title.replace(/\n/g, ', ')}
      className={`mx-auto flex h-14 w-20 flex-col items-center justify-center rounded-md border ${bandToneClass(cell.predicted_band)}`}
    >
      <span className="text-sm font-bold leading-none">B{cell.predicted_band}</span>
      <span className="mt-1 text-xs font-medium leading-none tabular-nums">{formatPercent(cell.score_pct)}</span>
      <span className="mt-1 max-w-[4.5rem] truncate rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-500">
        {cell.confidence}
      </span>
    </div>
  )
}

export default function GradeoTopicBandsTable({ topicBands }: Props) {
  const topics = topicBands.topics ?? []
  const students = topicBands.students ?? []

  if (students.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No students found. Refresh the Gradeo directory and import a class from the extension first.
      </div>
    )
  }

  if (topics.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No topic-band evidence found yet. Import Gradeo CSV question rows with topic labels to populate this view.
      </div>
    )
  }

  return (
    <div className="activity-table-wrapper border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
        <span className="font-medium">Bands:</span>
        <span>B6 90+</span>
        <span>B5 80+</span>
        <span>B4 70+</span>
        <span>B3 60+</span>
        <span>B2 50+</span>
        <span>B1 &lt;50</span>
        <span className="hidden h-4 w-px bg-slate-200 sm:inline-block" />
        <span className="font-medium">Confidence:</span>
        <span>low</span>
        <span>medium</span>
        <span>high</span>
        <span className="ml-auto text-slate-400">
          {topics.length} topic{topics.length === 1 ? '' : 's'} · {students.length} student{students.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="activity-table-scroll">
        <table className="activity-table w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky-col-header-1 px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[220px]">
                Student
              </th>
              {topics.map(topic => (
                <th
                  key={topic.name}
                  className="w-40 min-w-40 max-w-40 border-r border-slate-100 px-3 py-2 text-left align-bottom last:border-r-slate-200"
                  title={buildTopicHeaderTitle(topic)}
                >
                  <div className="flex min-h-16 flex-col justify-end gap-1">
                    <span className="line-clamp-3 text-xs font-semibold leading-snug text-slate-600">
                      {topic.name}
                    </span>
                    <span className="text-[11px] font-medium leading-none text-slate-400">
                      Avg {formatPercent(topic.average_score_pct)}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {students.map((student, index) => (
              <tr
                key={student.id}
                className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-brand-50/40 transition-colors`}
              >
                <td className={`sticky-col-1 px-4 py-2.5 border-r border-slate-200 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                  <span className="font-medium text-slate-800 text-sm">{student.name}</span>
                </td>
                {topics.map(topic => (
                  <td key={topic.name} className="px-2 py-2.5 text-center border-r border-slate-100 last:border-r-0">
                    <TopicBandCell
                      studentName={student.name}
                      topicName={topic.name}
                      cell={student.topics[topic.name]}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
