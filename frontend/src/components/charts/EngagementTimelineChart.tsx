import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import type { CourseActivityDay } from '../../types'
import { BRAND_500, EMERALD_500 } from './colors'

interface Props {
  data: CourseActivityDay[]
}

export default function EngagementTimelineChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-400">
        No course activity data yet
      </div>
    )
  }

  const chartData = data.map(row => ({
    date: row.date,
    'Page views': row.views ?? 0,
    'Participations': row.participations ?? 0,
  }))

  // Show at most ~12 x-axis labels to avoid crowding
  const tickInterval = Math.max(1, Math.floor(chartData.length / 12))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#64748b' }}
          interval={tickInterval}
          tickFormatter={v => v.slice(5)} // show MM-DD only
        />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={36} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="Page views"
          stroke={BRAND_500}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="Participations"
          stroke={EMERALD_500}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
