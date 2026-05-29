import type { EdStemMatrix } from '../types'
import MatrixTable from './MatrixTable'
import { buildEdStemMatrixTableModel } from './matrixTableAdapters'

interface Props {
  matrix: EdStemMatrix
  onExport?: () => void
  exportLoading?: boolean
}

export default function EdStemLessonTable({ matrix, onExport, exportLoading }: Props) {
  return <MatrixTable model={{ ...buildEdStemMatrixTableModel(matrix), onExport, exportLoading }} />
}
