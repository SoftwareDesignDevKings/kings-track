import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Course, CourseMatrix, SyncStatus, HealthResponse } from '../types'

const apiBaseOverride =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL
const API_BASE = (apiBaseOverride || '/api').replace(/\/$/, '')

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)
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
      // Invalidate everything — data will be refreshed when sync completes
      queryClient.invalidateQueries({ queryKey: ['sync-status'] })
    },
  })
}
