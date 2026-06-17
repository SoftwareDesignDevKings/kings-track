import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from 'recharts'
import { BRAND_500, BRAND_50 } from './colors'

interface Props {
  avgCompletionRate: number | null // 0-1
  avgOnTimeRate: number | null     // 0-1
  avgScore: number | null          // 0-100
}

export default function CourseOverviewRadarChart({ avgCompletionRate, avgOnTimeRate, avgScore }: Props) {
  const data = [
    {
      metric: 'Completion',
      value: avgCompletionRate !== null ? Math.round(avgCompletionRate * 100) : 0,
    },
    {
      metric: 'On-Time',
      value: avgOnTimeRate !== null ? Math.round(avgOnTimeRate * 100) : 0,
    },
    {
      metric: 'Score',
      value: avgScore !== null ? Math.round(avgScore) : 0,
    },
  ]

  const hasData = data.some(d => d.value > 0)
  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fill: '#64748b', fontSize: 12 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: '#94a3b8', fontSize: 10 }}
          tickCount={5}
        />
        <Radar
          dataKey="value"
          stroke={BRAND_500}
          fill={BRAND_50}
          fillOpacity={0.6}
          strokeWidth={2}
        />
        <Tooltip
          formatter={(value) => [`${value}%`, 'Value']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}
