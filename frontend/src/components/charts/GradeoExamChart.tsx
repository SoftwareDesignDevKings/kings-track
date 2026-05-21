import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  ReferenceLine,
} from 'recharts'
import type { GradeoExamBreakdown } from '../../types'
import { BRAND_500, RED_400, SLATE_400 } from './colors'

interface Props {
  exams: GradeoExamBreakdown[]
}

interface ExamDataPoint {
  name: string
  'Your Score': number
  'Class Avg': number
  exam_mark: number | null
  marks_available: number | null
}

export default function GradeoExamChart({ exams }: Props) {
  const scored = exams.filter(e => e.status === 'scored' && e.exam_mark !== null && e.marks_available !== null && e.marks_available > 0)

  if (scored.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-400">
        No scored exams yet
      </div>
    )
  }

  const data: ExamDataPoint[] = scored.map(e => ({
    name: e.exam_name.length > 20 ? e.exam_name.slice(0, 17) + '\u2026' : e.exam_name,
    'Your Score': Math.round((e.exam_mark! / e.marks_available!) * 100),
    'Class Avg': e.class_average !== null ? Math.round(e.class_average) : 0,
    exam_mark: e.exam_mark,
    marks_available: e.marks_available,
  }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#64748b' }}
          angle={scored.length > 4 ? -30 : 0}
          textAnchor={scored.length > 4 ? 'end' : 'middle'}
          height={scored.length > 4 ? 60 : 30}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          formatter={(value, name, props) => {
            if (name === 'Your Score') {
              const p = (props as { payload: ExamDataPoint }).payload
              return [`${value}% (${p.exam_mark}/${p.marks_available})`, name]
            }
            return [`${value}%`, name]
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={50} stroke="#e2e8f0" strokeDasharray="3 3" />
        <Bar dataKey="Your Score" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={entry['Your Score'] < entry['Class Avg'] ? RED_400 : BRAND_500}
            />
          ))}
        </Bar>
        <Bar dataKey="Class Avg" fill={SLATE_400} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
