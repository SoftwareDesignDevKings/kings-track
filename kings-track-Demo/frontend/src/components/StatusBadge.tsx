import type { SubmissionStatus } from '../types'

interface Props {
  status: SubmissionStatus
  score?: number | null
  pointsPossible?: number | null
  late?: boolean
  missing?: boolean
}

const statusConfig = {
  completed: {
    label: 'Completed',
    dotClass: 'bg-emerald-400',
    ringClass: 'ring-emerald-200',
    icon: (
      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
        <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  in_progress: {
    label: 'In progress',
    dotClass: 'bg-amber-400',
    ringClass: 'ring-amber-200',
    icon: (
      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 10 10">
        <rect x="3" y="2" width="1.2" height="6" rx="0.6"/>
        <rect x="5.8" y="2" width="1.2" height="6" rx="0.6"/>
      </svg>
    ),
  },
  not_started: {
    label: 'Not started',
    dotClass: 'bg-slate-200',
    ringClass: 'ring-slate-100',
    icon: null,
  },
  excused: {
    label: 'Excused',
    dotClass: 'bg-slate-300',
    ringClass: 'ring-slate-200',
    icon: null,
  },
}

export default function StatusBadge({ status, score, pointsPossible, late, missing }: Props) {
  const config = statusConfig[status]

  const tooltipParts: string[] = [config.label]
  if (score !== null && score !== undefined && pointsPossible !== null && pointsPossible !== undefined) {
    tooltipParts.push(`${score} / ${pointsPossible} pts`)
  } else if (score !== null && score !== undefined) {
    tooltipParts.push(`${score} pts`)
  }
  if (late) tooltipParts.push('Late')
  if (missing) tooltipParts.push('Missing')
  const tooltip = tooltipParts.join(' · ')

  return (
    <div className="flex items-center justify-center" title={tooltip}>
      <div
        className={`
          w-5 h-5 rounded-full flex items-center justify-center
          ring-2 ${config.ringClass} ${config.dotClass}
          ${late && status === 'completed' ? 'ring-amber-300' : ''}
        `}
      >
        {config.icon}
      </div>
    </div>
  )
}
