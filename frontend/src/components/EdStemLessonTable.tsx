import type { EdStemMatrix } from '../types'
import MatrixTable from './MatrixTable'
import { buildEdStemMatrixTableModel } from './matrixTableAdapters'

interface Props {
  matrix: EdStemMatrix
}

export default function EdStemLessonTable({ matrix }: Props) {
  return <MatrixTable model={buildEdStemMatrixTableModel(matrix)} />
}
