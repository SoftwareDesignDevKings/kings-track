import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import type { CanvasGroupBreakdown } from '../../types'
import { EMERALD_500, AMBER_500, RED_400, SLATE_300 } from './colors'

interface Props {
  groups: CanvasGroupBreakdown[]
}

export default function CanvasGroupChart({ groups }: Props) {
  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No assignment groups
      </div>
    )
  }

  const data = groups.map(g => {
    const notStarted = Math.max(g.total - g.submitted - g.missing, 0)
    return {
      name: g.group_name.length > 25 ? g.group_name.slice(0, 22) + '\u2026' : g.group_name,
      Submitted: g.submitted,
      Late: g.late,
      Missing: g.missing,
      'Not Started': notStarted,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, groups.length * 44 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Submitted" stackId="a" fill={EMERALD_500} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Late" stackId="a" fill={AMBER_500} />
        <Bar dataKey="Missing" stackId="a" fill={RED_400} />
        <Bar dataKey="Not Started" stackId="a" fill={SLATE_300} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
