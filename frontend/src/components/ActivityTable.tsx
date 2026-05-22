import type { CourseMatrix } from '../types'
import MatrixTable from './MatrixTable'
import { buildCanvasMatrixTableModel } from './matrixTableAdapters'
import type { CanvasActivityViewMode } from './activityTableModel'

interface Props {
  matrix: CourseMatrix
  viewMode?: CanvasActivityViewMode
}

export default function ActivityTable({ matrix }: Props) {
  return <MatrixTable model={buildCanvasMatrixTableModel(matrix)} />
}
