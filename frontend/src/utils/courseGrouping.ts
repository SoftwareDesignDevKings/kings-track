/**
 * Derive the course group code from a Canvas course_code.
 *
 * Strips an optional year suffix (_2026) and the section identifier to get
 * the base subject grouping:
 *   "11SENX_2026"  → "11SEN"
 *   "11ENCD1_2026" → "11ENC"
 *   "12SENX3_2026" → "12SEN"
 *
 * Must mirror the backend `_get_course_group_code()` in courses.py.
 */
export function getCourseGroupCode(courseCode: string | null): string {
  if (!courseCode) return ''
  let code = courseCode.trim().toUpperCase()
  // Strip optional year suffix (e.g. _2026)
  code = code.replace(/_\d{4}$/, '')
  // Extract year prefix + 3-letter subject code, if there's a section suffix
  const m = code.match(/^(\d{1,2}[A-Z]{3})/)
  if (m && code.length > m[1].length) return m[1]
  return code
}
