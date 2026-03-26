import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Course, CourseMatrix, SyncStatus, HealthResponse, AppUser,
  WhitelistedCourse, AvailableCourse,
  EdStemMatrix, EdStemCourseMapping, EdStemAvailableCourse,
} from '../types'
import { getAccessToken } from '../lib/auth'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken()

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => fetchJSON<HealthResponse>('/health'),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
}

export function useCourses() {
  return useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: () => fetchJSON<Course[]>('/courses'),
    staleTime: 60_000,
  })
}

export function useCourseMatrix(courseId: number) {
  return useQuery<CourseMatrix>({
    queryKey: ['matrix', courseId],
    queryFn: () => fetchJSON<CourseMatrix>(`/courses/${courseId}/matrix`),
    staleTime: 60_000,
    enabled: !isNaN(courseId),
  })
}

export function useSyncStatus() {
  return useQuery<SyncStatus>({
    queryKey: ['sync-status'],
    queryFn: () => fetchJSON<SyncStatus>('/sync/status'),
    refetchInterval: query => query.state.data?.is_running ? 1_000 : 4_000,
    staleTime: 0,
  })
}

export function useTriggerSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      fetchJSON<{ status: string; message: string }>('/sync/trigger', {
        method: 'POST',
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['sync-status'] })
      const previous = queryClient.getQueryData<SyncStatus>(['sync-status'])
      const startedAt = new Date().toISOString()

      queryClient.setQueryData<SyncStatus>(['sync-status'], old => ({
        is_running: true,
        progress: old?.progress ?? {
          sync_type: 'full',
          started_at: startedAt,
          phase: 'Preparing sync',
          current_course_id: null,
          current_step: null,
          total_courses: 0,
          completed_courses: 0,
          pending_course_ids: [],
          completed_course_ids: [],
          total_steps: null,
          completed_steps: 0,
          includes_edstem: false,
        },
        logs: old?.logs ?? [],
      }))

      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['sync-status'], context.previous)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-status'] })
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      queryClient.invalidateQueries({ queryKey: ['matrix'] })
    },
  })
}

// ─── Current user ─────────────────────────────────────────────────────────────

export function useCurrentUser() {
  return useQuery<AppUser>({
    queryKey: ['current-user'],
    queryFn: () => fetchJSON<AppUser>('/auth/me'),
    staleTime: 300_000,
    retry: false,
  })
}

// ─── Admin — users ────────────────────────────────────────────────────────────

export function useAdminUsers() {
  return useQuery<AppUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => fetchJSON<AppUser[]>('/admin/users'),
  })
}

export function useAddUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      fetchJSON<AppUser>('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })
}

export function useRemoveUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (email: string) =>
      fetchJSON<void>(`/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })
}

// ─── Admin — whitelist ────────────────────────────────────────────────────────

export function useWhitelist() {
  return useQuery<WhitelistedCourse[]>({
    queryKey: ['admin-whitelist'],
    queryFn: () => fetchJSON<WhitelistedCourse[]>('/admin/whitelist'),
  })
}

export function useAvailableCourses() {
  return useQuery<AvailableCourse[]>({
    queryKey: ['admin-whitelist-available'],
    queryFn: () => fetchJSON<AvailableCourse[]>('/admin/whitelist/available'),
  })
}

export function useAddToWhitelist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (course: AvailableCourse) =>
      fetchJSON<{ course_id: number; edstem_matched: { edstem_course_id: number; edstem_course_name: string } | null }>(
        '/admin/whitelist',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ course_id: course.id, name: course.name, course_code: course.course_code }),
        },
      ),
    onMutate: async (course: AvailableCourse) => {
      await queryClient.cancelQueries({ queryKey: ['admin-whitelist'] })
      const prev = queryClient.getQueryData<WhitelistedCourse[]>(['admin-whitelist'])
      queryClient.setQueryData<WhitelistedCourse[]>(['admin-whitelist'], old => [
        ...(old ?? []),
        { course_id: course.id, name: course.name, course_code: course.course_code, added_at: null },
      ])
      return { prev }
    },
    onError: (_err, _courseId, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(['admin-whitelist'], ctx.prev)
    },
    onSettled: (_data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-whitelist'] })
      queryClient.invalidateQueries({ queryKey: ['admin-whitelist-available'] })
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      if (_data?.edstem_matched) {
        queryClient.invalidateQueries({ queryKey: ['admin-edstem-mappings'] })
      }
    },
  })
}

export function useRemoveFromWhitelist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (courseId: number) =>
      fetchJSON<void>(`/admin/whitelist/${courseId}`, { method: 'DELETE' }),
    onMutate: async (courseId: number) => {
      await queryClient.cancelQueries({ queryKey: ['admin-whitelist'] })
      const prev = queryClient.getQueryData<WhitelistedCourse[]>(['admin-whitelist'])
      queryClient.setQueryData<WhitelistedCourse[]>(['admin-whitelist'], old =>
        (old ?? []).filter(w => w.course_id !== courseId)
      )
      return { prev }
    },
    onError: (_err, _courseId, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(['admin-whitelist'], ctx.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-whitelist'] })
      queryClient.invalidateQueries({ queryKey: ['admin-whitelist-available'] })
      queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
  })
}

// ─── EdStem — lesson matrix ──────────────────────────────────────────────────

export function useEdStemMatrix(courseId: number) {
  return useQuery<EdStemMatrix>({
    queryKey: ['edstem-matrix', courseId],
    queryFn: () => fetchJSON<EdStemMatrix>(`/courses/${courseId}/edstem-matrix`),
    staleTime: 60_000,
    enabled: !isNaN(courseId),
  })
}

// ─── Admin — EdStem mappings ──────────────────────────────────────────────────

export function useEdStemMappings() {
  return useQuery<EdStemCourseMapping[]>({
    queryKey: ['admin-edstem-mappings'],
    queryFn: () => fetchJSON<EdStemCourseMapping[]>('/admin/edstem-mappings'),
  })
}

export function useEdStemAvailableCourses() {
  return useQuery<EdStemAvailableCourse[]>({
    queryKey: ['admin-edstem-courses'],
    queryFn: () => fetchJSON<EdStemAvailableCourse[]>('/admin/edstem-courses'),
  })
}

export function useCreateEdStemMapping() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { canvas_course_id: number; edstem_course_id: number; edstem_course_name: string }) =>
      fetchJSON('/admin/edstem-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-edstem-mappings'] })
      queryClient.invalidateQueries({ queryKey: ['edstem-matrix'] })
    },
  })
}

export function useAutoMatchEdStem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      fetchJSON<{ matched: { canvas_course_id: number; course_code: string; edstem_course_id: number; edstem_course_name: string }[]; unmatched: string[] }>(
        '/admin/edstem-mappings/auto-match',
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-edstem-mappings'] })
    },
  })
}

export function useDeleteEdStemMapping() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (canvasCourseId: number) =>
      fetchJSON<void>(`/admin/edstem-mappings/${canvasCourseId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-edstem-mappings'] })
      queryClient.invalidateQueries({ queryKey: ['edstem-matrix'] })
    },
  })
}
