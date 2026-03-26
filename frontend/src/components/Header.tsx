import { Link } from 'react-router-dom'
import { useCurrentUser } from '../services/api'

export default function Header() {
  const { data: currentUser } = useCurrentUser()

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Logo + nav */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-3 shrink-0">
              <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">K</span>
              </div>
              <span className="text-base font-semibold text-slate-900 hidden sm:inline">Kings Analytics</span>
            </Link>

            <nav className="flex items-center gap-1">
              <Link
                to="/"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                Courses
              </Link>
              {currentUser?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>
        </div>
      </div>
    </header>
  )
}
