import type { ReactNode } from 'react'

export type MatrixDisplayMode = 'status' | 'marks'

export type MatrixCellStatus =
  | 'completed'
  | 'in_progress'
  | 'not_started'
  | 'excused'
  | 'viewed'
  | 'awaiting_marking'
  | 'scored'
  | 'not_submitted'
  | 'unassigned'
  | 'evidence'

export interface MatrixCellFlags {
  late?: boolean
  missing?: boolean
}

export interface MatrixCellMarks {
  earned: number | null
  available: number | null
  unit?: string
}

export interface MatrixCell {
  status: MatrixCellStatus
  label: string
  tooltip: string
  marks?: MatrixCellMarks | null
  flags?: MatrixCellFlags
  renderStatus?: ReactNode
  renderMarks?: ReactNode
  ariaLabel?: string
}

export interface MatrixColumn {
  id: string
  label: string
  shortLabel?: string
  tooltip?: string
  widthClass?: string
  headerVariant?: 'short' | 'rotated' | 'wide'
  cellClassName?: string
  dividerClassName?: string
  dataGroupName?: string
}

export interface MatrixColumnGroup {
  id: string
  label: string
  columns: MatrixColumn[]
  dividerClassName?: string
}

export interface MatrixTableRow {
  id: string | number
  name: string
  sortableName: string | null
  summaryValue?: number | null
  summaryLabel?: string
  lateCount?: number
  missingCount?: number
  scoredCount?: number
  averageMarkPct?: number | null
  cells: Record<string, MatrixCell | undefined>
}

export interface MatrixLegendItem {
  id: string
  label: string
  status?: MatrixCellStatus
  flags?: MatrixCellFlags
  render?: ReactNode
}

export interface MatrixTableModel {
  title: string
  subtitle?: string
  rowNoun?: string
  showToolbarSummary?: boolean
  tableClassName?: string
  floatingColumnGroupLabels?: boolean
  summaryHeader?: string
  supportsMarks?: boolean
  defaultDisplayMode?: MatrixDisplayMode
  emptyRowsMessage: string
  emptyColumnsMessage: string
  rows: MatrixTableRow[]
  columnGroups: MatrixColumnGroup[]
  legends: MatrixLegendItem[]
  hiddenFooter?: ReactNode
  className?: string
  onExport?: () => void
  exportLoading?: boolean
}
