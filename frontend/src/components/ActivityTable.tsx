import type { CourseMatrix } from '../types'
import MatrixTable from './MatrixTable'
import { buildCanvasMatrixTableModel } from './matrixTableAdapters'
import type { CanvasActivityViewMode } from './activityTableModel'

interface Props {
  matrix: CourseMatrix
  viewMode?: CanvasActivityViewMode
  onExport?: () => void
  exportLoading?: boolean
}

export default function ActivityTable({ matrix, onExport, exportLoading }: Props) {
  return <MatrixTable model={{ ...buildCanvasMatrixTableModel(matrix), onExport, exportLoading }} />
}
