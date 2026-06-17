import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts'
import { EMERALD_500, BRAND_500, SLATE_300, AMBER_400 } from './colors'

interface Props {
  completed: number
  inProgress: number
  notStarted: number
  excused: number
}

const STATUS_COLORS: Record<string, string> = {
  Completed: EMERALD_500,
  'In Progress': BRAND_500,
  'Not Started': SLATE_300,
  Excused: AMBER_400,
}

export default function SubmissionStatusChart({ completed, inProgress, notStarted, excused }: Props) {
  const total = completed + inProgress + notStarted + excused
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-400">
        No submission data
      </div>
    )
  }

  const data = [
    { name: 'Completed', count: completed, pct: Math.round((completed / total) * 100) },
    { name: 'In Progress', count: inProgress, pct: Math.round((inProgress / total) * 100) },
    { name: 'Not Started', count: notStarted, pct: Math.round((notStarted / total) * 100) },
    { name: 'Excused', count: excused, pct: Math.round((excused / total) * 100) },
  ].filter(d => d.count > 0)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={80}
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <Tooltip
          formatter={(value: number, _name: string, props: { payload: { pct: number } }) => [
            `${value} (${props.payload.pct}%)`,
            'Submissions',
          ]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || SLATE_300} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
