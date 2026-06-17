import { useParams, Link, Navigate, useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import ActivityTable from '../components/ActivityTable'
import { buildCourseGroupMatrixTableModel } from '../components/matrixTableAdapters'
import MatrixTable from '../components/MatrixTable'
import { useCourseGroups, useCourseGroupMatrix, useCourseMatrix } from '../services/api'

type GroupTab = 'all' | number

export default function CourseGroupDetail() {
  const { groupCode } = useParams<{ groupCode: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: groups, isLoading: groupsLoading, error: groupsError } = useCourseGroups()

  const group = groups?.find(g => g.group_code === groupCode)

  // Determine active tab from URL
  const classParam = searchParams.get('class')
  const activeTab: GroupTab = classParam ? Number(classParam) : 'all'

  // Fetch combined matrix for "All Students" tab
  const {
    data: groupMatrix,
    isLoading: groupMatrixLoading,
    error: groupMatrixError,
  } = useCourseGroupMatrix(group && group.class_count > 1 ? groupCode : undefined)

  // Fetch individual class matrix when a class tab is selected
  const selectedClassId = typeof activeTab === 'number' ? activeTab : null
  const {
    data: classMatrix,
    isLoading: classMatrixLoading,
    error: classMatrixError,
  } = useCourseMatrix(selectedClassId ?? NaN)

  // Single-class group: redirect directly to class detail
  if (group && group.class_count === 1) {
    return <Navigate to={`/courses/${group.classes[0].id}`} replace />
  }

  const setTab = (tab: GroupTab) => {
    if (tab === 'all') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ class: String(tab) }, { replace: true })
    }
  }

  // Build group matrix table model with class code subtitles
  const groupMatrixModel = groupMatrix ? buildCourseGroupMatrixTableModel(groupMatrix) : null

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <Header />

      <main className="mx-auto flex min-h-0 w-full max-w-screen-2xl flex-1 flex-col px-4 py-6 sm:px-6">
        {/* Breadcrumb */}
        <nav className="mb-5 flex shrink-0 items-center gap-2 text-sm text-slate-400">
          <Link to="/" className="hover:text-brand-600 transition-colors">Courses</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-600">
            {groupsLoading ? '...' : (group?.group_code || groupCode || 'Course')}
          </span>
        </nav>

        {/* Header */}
        <div className="mb-4 shrink-0">
          {groupsLoading ? (
            <div className="h-7 bg-slate-200 rounded w-48 animate-pulse" />
          ) : group ? (
            <>
              <h2 className="text-xl font-semibold text-slate-900">{group.display_name}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {group.class_count} class{group.class_count !== 1 ? 'es' : ''} · {group.total_students} student{group.total_students !== 1 ? 's' : ''}
              </p>
            </>
          ) : !groupsError ? (
            <h2 className="text-xl font-semibold text-slate-900">Course not found</h2>
          ) : null}
        </div>

        {/* Error */}
        {groupsError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
            Failed to load course data.
          </div>
        )}

        {/* Not found */}
        {!groupsLoading && !groupsError && !group && (
          <div className="text-center py-20">
            <h3 className="text-base font-medium text-slate-600 mb-1">Course group not found</h3>
            <p className="text-sm text-slate-400">
              No course group matches &quot;{groupCode}&quot;.
            </p>
          </div>
        )}

        {/* Tab bar + content */}
        {group && (
          <>
            <div className="mb-4 shrink-0 overflow-x-auto overflow-y-hidden border-b border-slate-200">
              <div className="flex min-w-max items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTab('all')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === 'all'
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  All Students
                </button>
                {group.classes.map(cls => (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => setTab(cls.id)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === cls.id
                        ? 'border-brand-500 text-brand-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {cls.course_code?.replace(/_\d{4}$/, '') || cls.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <section className="min-h-0 min-w-0 flex-1 flex flex-col">
              {activeTab === 'all' && (
                <>
                  {groupMatrixLoading && (
                    <div className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                      <div className="h-4 bg-slate-200 rounded w-1/3 mb-3" />
                      <div className="h-4 bg-slate-200 rounded w-2/3 mb-3" />
                      <div className="h-4 bg-slate-200 rounded w-1/2" />
                    </div>
                  )}
                  {groupMatrixError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                      Failed to load combined activity data.
                    </div>
                  )}
                  {groupMatrixModel && (
                    <MatrixTable model={groupMatrixModel} />
                  )}
                </>
              )}

              {selectedClassId !== null && (
                <>
                  <div className="mb-3 shrink-0">
                    <Link
                      to={`/courses/${selectedClassId}`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      View full class detail (Engagement, EdStem, Gradeo...)
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                  {classMatrixLoading && (
                    <div className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                      <div className="h-4 bg-slate-200 rounded w-1/3 mb-3" />
                      <div className="h-4 bg-slate-200 rounded w-2/3 mb-3" />
                      <div className="h-4 bg-slate-200 rounded w-1/2" />
                    </div>
                  )}
                  {classMatrixError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
                      Failed to load activity data.
                    </div>
                  )}
                  {classMatrix && <ActivityTable matrix={classMatrix} />}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
