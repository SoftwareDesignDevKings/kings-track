import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Course, CourseMatrix, SyncStatus, HealthResponse, AppUser, WhitelistedCourse, AvailableCourse } from '../types'
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
    refetchInterval: 5_000,
    staleTime: 3_000,
  })
}

export function useTriggerSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      fetchJSON<{ status: string; message: string }>('/sync/trigger', {
        method: 'POST',
      }),
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
    mutationFn: (courseId: number) =>
      fetchJSON('/admin/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: courseId }),
      }),
    onMutate: async (courseId: number) => {
      await queryClient.cancelQueries({ queryKey: ['admin-whitelist'] })
      const prev = queryClient.getQueryData<WhitelistedCourse[]>(['admin-whitelist'])
      const available = queryClient.getQueryData<AvailableCourse[]>(['admin-whitelist-available'])
      const course = available?.find(c => c.id === courseId)
      if (course) {
        queryClient.setQueryData<WhitelistedCourse[]>(['admin-whitelist'], old => [
          ...(old ?? []),
          { course_id: courseId, name: course.name, course_code: course.course_code, added_at: null },
        ])
      }
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
