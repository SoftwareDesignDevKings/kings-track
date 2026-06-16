/**
 * Derive the course group code from a Canvas course_code.
 *
 * Strips a trailing section identifier (single letter or digit) to get the
 * base subject grouping:
 *   "11SENX" → "11SEN"
 *   "11SENY" → "11SEN"
 *   "11ENC1" → "11ENC"
 *   "11ENC2" → "11ENC"
 *
 * Must mirror the backend `_get_course_group_code()` in courses.py.
 */
export function getCourseGroupCode(courseCode: string | null): string {
  if (!courseCode) return ''
  const code = courseCode.trim().toUpperCase()
  const m = code.match(/^(\d{1,2}[A-Z]{2,})[A-Z\d]$/)
  return m ? m[1] : code
}
