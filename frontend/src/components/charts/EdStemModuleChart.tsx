import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import type { EdStemModuleBreakdown } from '../../types'
import { EMERALD_500, AMBER_500, SLATE_300 } from './colors'

interface Props {
  modules: EdStemModuleBreakdown[]
}

export default function EdStemModuleChart({ modules }: Props) {
  if (modules.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No EdStem modules
      </div>
    )
  }

  const data = modules.map(m => ({
    name: m.module_name.length > 25 ? m.module_name.slice(0, 22) + '\u2026' : m.module_name,
    Completed: m.completed,
    Viewed: m.viewed,
    'Not Started': m.not_started,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, modules.length * 44 + 60)}>
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
        <Bar dataKey="Completed" stackId="a" fill={EMERALD_500} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Viewed" stackId="a" fill={AMBER_500} />
        <Bar dataKey="Not Started" stackId="a" fill={SLATE_300} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
