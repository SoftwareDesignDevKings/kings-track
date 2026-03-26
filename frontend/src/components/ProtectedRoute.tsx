import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getClientSession, isLocalAuth, subscribeToAuthChanges } from '../lib/auth'

interface Props {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    getClientSession().then((data) => setSessionEmail(data.session?.user?.email ?? null))

    let cleanup = () => {}
    subscribeToAuthChanges((email) => {
      setSessionEmail(email)
    }).then((unsubscribe) => {
      cleanup = unsubscribe
    })

    return () => cleanup()
  }, [])

  if (sessionEmail === undefined) return null
  if (!sessionEmail && !isLocalAuth) return <Navigate to="/login" replace />
  return <>{children}</>
}
