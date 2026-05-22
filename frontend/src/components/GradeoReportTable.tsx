import type { GradeoCourseReport } from '../types'
import MatrixTable from './MatrixTable'
import { buildGradeoReportMatrixTableModel } from './matrixTableAdapters'

interface Props {
  report: GradeoCourseReport
  hiddenStudents?: Array<{ id: number; name: string }>
}

export default function GradeoReportTable({ report, hiddenStudents = [] }: Props) {
  return <MatrixTable model={buildGradeoReportMatrixTableModel(report, hiddenStudents)} />
}
