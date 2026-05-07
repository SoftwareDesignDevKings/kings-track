import { useCanvasHealth } from '../services/api'

export default function CanvasOutageBanner() {
  const { data } = useCanvasHealth()

  if (!data || data.up || !data.configured) return null

  const { title, body } =
    data.reason === 'maintenance'
      ? {
          title: 'Canvas is currently down for maintenance',
          body: 'Data shown may be stale. New syncs will resume automatically when Canvas is restored.',
        }
      : data.reason === 'network_error'
      ? {
          title: 'Cannot reach Canvas',
          body: 'Data shown may be stale until the connection is restored.',
        }
      : {
          title: 'Canvas is currently unreachable',
          body: `Status ${data.status ?? 'unknown'}. Data shown may be stale.`,
        }

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-4">
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      >
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625l6.28-10.875zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 7a1 1 0 100 2 1 1 0 000-2z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-amber-900">{title}</p>
          <p className="mt-0.5 text-amber-800/90">{body}</p>
        </div>
      </div>
    </div>
  )
}
