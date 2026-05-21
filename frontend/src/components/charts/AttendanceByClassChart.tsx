import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ReferenceLine,
} from 'recharts'
import type { AttendanceByClass } from '../../types'
import { EMERALD_500, AMBER_500, RED_400 } from './colors'

interface Props {
  classes: AttendanceByClass[]
}

function rateColor(rate: number | null): string {
  if (rate === null) return AMBER_500
  if (rate >= 75) return EMERALD_500
  if (rate >= 50) return AMBER_500
  return RED_400
}

export default function AttendanceByClassChart({ classes }: Props) {
  if (classes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No class attendance data
      </div>
    )
  }

  const data = classes.map(c => ({
    name: c.class_code,
    rate: c.rate ?? 0,
    rawRate: c.rate,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, classes.length * 40 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={100}
          tick={{ fontSize: 11, fill: '#64748b' }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          formatter={(value) => [`${value}%`, 'Attendance Rate']}
        />
        <ReferenceLine x={75} stroke="#e2e8f0" strokeDasharray="3 3" label={{ value: '75%', position: 'top', fill: '#94a3b8', fontSize: 10 }} />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={rateColor(entry.rawRate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
