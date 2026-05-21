import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts'
import type { AttendanceSummary } from '../../types'
import { ATTENDANCE_COLORS } from './colors'

interface Props {
  summary: AttendanceSummary
}

export default function AttendanceDonutChart({ summary }: Props) {
  const slices = [
    { name: 'Present', value: summary.present, color: ATTENDANCE_COLORS.present },
    { name: 'Late', value: summary.late, color: ATTENDANCE_COLORS.late },
    { name: 'Partial', value: summary.partial, color: ATTENDANCE_COLORS.partial },
    { name: 'Absent', value: summary.absent, color: ATTENDANCE_COLORS.absent },
  ].filter(d => d.value > 0)

  if (slices.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No attendance data
      </div>
    )
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={slices}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {slices.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            formatter={(value, name) => [value, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      {summary.attendance_rate !== null && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginBottom: 30 }}>
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-900">{summary.attendance_rate}%</p>
            <p className="text-xs text-slate-400">Rate</p>
          </div>
        </div>
      )}
    </div>
  )
}
