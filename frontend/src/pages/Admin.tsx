import { useState } from 'react'
import {
  useAdminUsers,
  useAddUser,
  useRemoveUser,
  useWhitelist,
  useAvailableCourses,
  useAddToWhitelist,
  useRemoveFromWhitelist,
} from '../services/api'

export default function Admin() {
  const { data: users = [], isLoading: usersLoading } = useAdminUsers()
  const { data: whitelist = [], isLoading: whitelistLoading } = useWhitelist()
  const { data: available = [] } = useAvailableCourses()

  const addUser = useAddUser()
  const removeUser = useRemoveUser()
  const addToWhitelist = useAddToWhitelist()
  const removeFromWhitelist = useRemoveFromWhitelist()

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'teacher'>('teacher')

  const whitelistedIds = new Set(whitelist.map(w => w.course_id))
  const notWhitelisted = available.filter(c => !whitelistedIds.has(c.id))

  function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    addUser.mutate(
      { email: newEmail.trim(), role: newRole },
      { onSuccess: () => setNewEmail('') },
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-12">
      <h1 className="text-2xl font-semibold text-slate-900">Admin Settings</h1>

      {/* ── Users ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-800">Users</h2>

        {usersLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Added</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u.email}>
                  <td className="px-4 py-2 text-slate-800">{u.email}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === 'admin'
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => removeUser.mutate(u.email)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add user form */}
        <form onSubmit={handleAddUser} className="flex items-center gap-3">
          <input
            type="email"
            placeholder="user@example.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value as 'admin' | 'teacher')}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={addUser.isPending}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            Add User
          </button>
        </form>
        {addUser.isError && (
          <p className="text-sm text-red-600">{(addUser.error as Error).message}</p>
        )}
      </section>

      {/* ── Course Whitelist ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-800">Course Whitelist</h2>
        <p className="text-sm text-slate-500">
          When the whitelist is empty all synced courses are visible. Add courses here to restrict access.
        </p>

        {whitelistLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : whitelist.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No courses whitelisted — all courses are visible.</p>
        ) : (
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Course</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Added</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {whitelist.map(w => (
                <tr key={w.course_id}>
                  <td className="px-4 py-2 text-slate-800">{w.name}</td>
                  <td className="px-4 py-2 text-slate-500">{w.course_code ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {w.added_at ? new Date(w.added_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => removeFromWhitelist.mutate(w.course_id)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {notWhitelisted.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Add a course:</p>
            <div className="flex flex-wrap gap-2">
              {notWhitelisted.map(c => (
                <button
                  key={c.id}
                  onClick={() => addToWhitelist.mutate(c.id)}
                  disabled={addToWhitelist.isPending}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  {c.name}
                  {c.course_code ? ` (${c.course_code})` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
