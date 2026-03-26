import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '../services/api'
import { signOut, isLocalAuth } from '../lib/auth'

export default function Header() {
  const { data: currentUser } = useCurrentUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const handleLogout = async () => {
    await signOut()
    queryClient.clear()
    navigate('/login')
  }

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

          {/* Right: Logout */}
          {!isLocalAuth && (
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 transition-colors"
            >
              Log Out
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
