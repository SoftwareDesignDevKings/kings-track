import type { GradeoTopicBands } from '../types'
import MatrixTable from './MatrixTable'
import { buildGradeoTopicBandsMatrixTableModel } from './matrixTableAdapters'

interface Props {
  topicBands: GradeoTopicBands
}

export default function GradeoTopicBandsTable({ topicBands }: Props) {
  return <MatrixTable model={buildGradeoTopicBandsMatrixTableModel(topicBands)} />
}
