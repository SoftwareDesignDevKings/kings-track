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
import { BRAND_500, SLATE_300 } from './colors'

interface Props {
  groups: CanvasGroupBreakdown[]
}

export default function CanvasScoreChart({ groups }: Props) {
  const scored = groups.filter(g => g.avg_score !== null)

  if (scored.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No scored assignments yet
      </div>
    )
  }

  const data = scored.map(g => ({
    name: g.group_name.length > 20 ? g.group_name.slice(0, 17) + '\u2026' : g.group_name,
    'Avg Score': g.avg_score,
    'Points Possible': g.avg_points_possible,
  }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#64748b' }}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          formatter={(value) => [Number(value).toFixed(1), undefined]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Avg Score" fill={BRAND_500} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Points Possible" fill={SLATE_300} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
