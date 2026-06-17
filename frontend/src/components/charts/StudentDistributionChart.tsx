import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts'
import { RED_400, AMBER_500, AMBER_400, EMERALD_500 } from './colors'

interface Props {
  /** Completion rates as 0-1 values, one per student */
  completionRates: (number | null)[]
}

const BUCKETS = [
  { label: '0–20%', min: 0, max: 0.2, color: RED_400 },
  { label: '20–40%', min: 0.2, max: 0.4, color: AMBER_500 },
  { label: '40–60%', min: 0.4, max: 0.6, color: AMBER_400 },
  { label: '60–80%', min: 0.6, max: 0.8, color: '#a3e635' },  // lime-400
  { label: '80–100%', min: 0.8, max: 1.01, color: EMERALD_500 },
]

export default function StudentDistributionChart({ completionRates }: Props) {
  const validRates = completionRates.filter((r): r is number => r !== null)
  if (validRates.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-400">
        No student data
      </div>
    )
  }

  const data = BUCKETS.map(bucket => ({
    label: bucket.label,
    count: validRates.filter(r => r >= bucket.min && r < bucket.max).length,
    color: bucket.color,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          width={32}
          allowDecimals={false}
        />
        <Tooltip
          formatter={(value: number) => [`${value} student${value !== 1 ? 's' : ''}`, 'Count']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
