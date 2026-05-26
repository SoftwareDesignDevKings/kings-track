import type { GradeoTopicBands } from '../types'
import MatrixTable from './MatrixTable'
import { buildGradeoTopicBandsMatrixTableModel } from './matrixTableAdapters'

interface Props {
  topicBands: GradeoTopicBands
  onExport?: () => void
  exportLoading?: boolean
}

export default function GradeoTopicBandsTable({ topicBands, onExport, exportLoading }: Props) {
  return <MatrixTable model={{ ...buildGradeoTopicBandsMatrixTableModel(topicBands), onExport, exportLoading }} />
}
