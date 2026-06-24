type AnyRecord = Record<string, any>

interface ExtensionConfig {
  frontendUrl: string
  gradeoApiHeadersJson: string
}

interface GradeoCapturedSession {
  authorization: string
  schoolId?: string | null
  capturedAt?: string
  source?: string
}

interface ImportStudent {
  gradeo_student_id: string
  student_name: string
  rows?: AnyRecord[]
  exam_rows?: AnyRecord[]
}

interface GradeoDirectoryStudent {
  gradeo_student_id: string
  name: string
  email: string
}

interface GradeoClassSummary {
  gradeo_class_id: string
  name: string
  syllabuses?: AnyRecord[]
  syllabus_title?: string | null
  teacher_count?: number | null
  student_count?: number | null
}

interface KingsTrackExtensionApi {
  defaultConfig: ExtensionConfig
  getConfig: () => Promise<ExtensionConfig>
  saveConfig: (config: Partial<ExtensionConfig>) => Promise<ExtensionConfig>
  bridgeRequest: (path: string, options?: AnyRecord) => Promise<any>
  getDebugLogs: () => Promise<AnyRecord[]>
  clearDebugLogs: () => Promise<void>
  logDebug: (scope: string, event: string, details?: AnyRecord) => Promise<AnyRecord>
  wait: (ms: number) => Promise<void>
  waitFor: <T>(predicate: () => T | null | undefined | false, timeoutMs?: number) => Promise<T>
  getSelectedDropdownOption: (ariaLabel: string) => { id: string; name: string; root: Element }
  listDropdownOptions: (ariaLabel: string) => Promise<Array<{ id: string; name: string; element?: Element }>>
  selectDropdownOption: (ariaLabel: string, optionSelector: string | { id?: string; name?: string }) => Promise<void>
  findActionByText: (pattern: RegExp) => Element | undefined
  parseCsv: (text: string) => AnyRecord[]
  toImportRow: (row: AnyRecord, canonicalMarkingSessionId?: string | null) => AnyRecord
  buildStudentImportFromRows: (rows: AnyRecord[], fallbackStudent: { id: string; name: string }) => ImportStudent
  buildStudentImport: (csvText: string, fallbackStudent: { id: string; name: string }) => ImportStudent
  findGradeoBearerTokenFromText: (text: string) => string | null
  extractGradeoSchoolIdFromText: (text: string) => string | null
  extractGradeoSessionFromSources: (sources: AnyRecord) => GradeoCapturedSession | null
  normalizeGradeoSession: (candidate: AnyRecord) => GradeoCapturedSession | null
  describeGradeoSession: (session?: AnyRecord | null) => AnyRecord
  runReportingSync: (deps: AnyRecord) => Promise<AnyRecord>
  extractStudentDirectoryFromDocument: (doc: Document) => GradeoDirectoryStudent[]
  inspectStudentDirectoryDocument: (doc: Document) => AnyRecord
  extractSchoolGroupsFromDocument: (doc: Document) => GradeoClassSummary[]
  inspectSchoolGroupsDocument: (doc: Document) => AnyRecord
  sendDebugSnapshot?: (snapshot: AnyRecord) => Promise<void>
}

interface Window {
  KingsTrackExtension: any
  __kingsTrackGradeoHookInstalled?: boolean
}

interface WorkerGlobalScope {
  KingsTrackExtension: any
}

declare var KingsTrackExtension: any
declare function importScripts(...urls: string[]): void
