import type { GradeoCourseReport, GradeoExam, GradeoQuestionResult, GradeoResultStatus } from '../types'

interface Props {
  report: GradeoCourseReport
}

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

const statusDotConfig: Record<GradeoResultStatus, { dot: string; ring: string; label: string }> = {
  not_submitted: { dot: 'bg-slate-200', ring: 'ring-slate-100', label: 'Not submitted' },
  awaiting_marking: { dot: 'bg-amber-400', ring: 'ring-amber-200', label: 'Awaiting marking' },
  scored: { dot: 'bg-emerald-400', ring: 'ring-emerald-200', label: 'Scored' },
}

function buildQuestionTooltip(exam: GradeoExam, questions: GradeoQuestionResult[]) {
  const lines = [
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
  ].filter(Boolean)

  return lines.join('\n')
}

function GradeoCell({
  examName,
  status,
  examMark,
  marksAvailable,
  classAverage,
  tooltip,
}: {
  examName: string
  status: GradeoResultStatus
  examMark: number | null
  marksAvailable: number | null
  classAverage: number | null
  tooltip: string
}) {
  const cfg = statusDotConfig[status]
  const scoreLine = status === 'scored'
    ? `Score: ${examMark ?? '—'}/${marksAvailable ?? '—'}`
    : status === 'awaiting_marking'
      ? 'Awaiting marking'
      : 'Not submitted'
  const title = [
    examName,
    cfg.label,
    scoreLine,
    classAverage != null ? `Class avg: ${classAverage}` : null,
    tooltip,
  ].filter(Boolean).join('\n')

  return (
    <div
      title={title}
      className={`h-5 w-5 mx-auto rounded-full ${cfg.dot} ring-2 ${cfg.ring} cursor-default`}
      aria-label={`${examName}: ${cfg.label}`}
    />
  )
}

function UnassignedCell({ examName }: { examName: string }) {
  return (
    <div
      title={`${examName}\nNot assigned`}
      className="mx-auto flex h-5 w-5 items-center justify-center text-[11px] font-semibold text-slate-300"
      aria-label={`${examName}: Not assigned`}
    >
      -
    </div>
  )
}

export default function GradeoReportTable({ report }: Props) {
  const exams = report.exams ?? []
  const students = report.students ?? []

  if (students.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No students found. Refresh the Gradeo directory and import a class from the extension first.
      </div>
    )
  }

  if (exams.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        No Gradeo exams have been imported for this course yet.
      </div>
    )
  }

  return (
    <div className="activity-table-wrapper border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
        <span className="font-medium">Legend:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-emerald-200 inline-block" />
          Scored
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-400 ring-2 ring-amber-200 inline-block" />
          Awaiting marking
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-slate-200 ring-2 ring-slate-100 inline-block" />
          Not submitted
        </span>
        {report.last_imported_at && (
          <span className="ml-auto text-slate-400">
            Last import {new Date(report.last_imported_at).toLocaleString()}
          </span>
        )}
      </div>

      <div className="activity-table-scroll">
        <table className="activity-table w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky-col-header-1 px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[220px]">
                Student
              </th>
              <th className="sticky-col-header-2 px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200 min-w-[130px]">
                Completion
              </th>
              {exams.map(exam => (
                <th
                  key={exam.id}
                  className="h-[130px] w-11 min-w-11 max-w-11 border-r border-slate-100 px-0 py-0 align-bottom last:border-r-slate-200"
                  title={[
                    exam.name,
                    exam.class_average != null ? `Class avg: ${exam.class_average}` : null,
                    exam.topics.length ? `Topics: ${exam.topics.join(', ')}` : null,
                    exam.outcomes.length ? `Outcomes: ${exam.outcomes.join(', ')}` : null,
                  ].filter(Boolean).join('\n')}
                >
                  <div className="flex h-full w-full items-end justify-center px-1 pb-2">
                    <span className="block max-h-[112px] overflow-hidden text-ellipsis whitespace-nowrap text-center text-xs font-medium leading-tight [transform:rotate(180deg)] [writing-mode:vertical-rl] text-slate-500">
                      {exam.name}
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
                <td className={`sticky-col-2 px-3 py-2.5 border-r border-slate-200 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                  <CompletionBar value={student.completion_rate} />
                </td>
                {exams.map(exam => {
                  const result = student.results[exam.id]
                  return (
                    <td key={exam.id} className="px-3 py-2.5 border-r border-slate-100 last:border-r-0">
                      {result ? (
                        <GradeoCell
                          examName={exam.name}
                          status={result.status}
                          examMark={result.exam_mark}
                          marksAvailable={result.marks_available}
                          classAverage={result.class_average}
                          tooltip={buildQuestionTooltip(exam, result.questions)}
                        />
                      ) : (
                        <UnassignedCell examName={exam.name} />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
