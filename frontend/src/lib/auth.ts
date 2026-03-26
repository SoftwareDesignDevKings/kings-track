export interface AuthUser {
  email: string | null
  role: 'admin' | 'teacher'
  authMode: string
  localAuth: boolean
}

const authMode = (import.meta.env.VITE_AUTH_MODE || 'prod').toLowerCase()

export const isLocalAuth = authMode === 'local'

export async function getAccessToken(): Promise<string | null> {
  if (isLocalAuth) return null

  const { supabase } = await import('./supabase')
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function getClientSession() {
  if (isLocalAuth) {
    return {
      session: {
        user: {
          email: (import.meta.env.VITE_LOCAL_DEV_USER_EMAIL as string | undefined) || 'admin@local.dev',
        },
      },
    }
  }

  const { supabase } = await import('./supabase')
  const { data } = await supabase.auth.getSession()
  return data
}

export async function signIn() {
  if (isLocalAuth) return

  const { supabase } = await import('./supabase')
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
}

export async function signOut() {
  if (isLocalAuth) return

  const { supabase } = await import('./supabase')
  await supabase.auth.signOut()
}

export async function subscribeToAuthChanges(callback: (email: string | null) => void): Promise<() => void> {
  if (isLocalAuth) {
    callback((import.meta.env.VITE_LOCAL_DEV_USER_EMAIL as string | undefined) || 'admin@local.dev')
    return () => {}
  }

  const { supabase } = await import('./supabase')
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user?.email ?? null)
  })

  return () => listener.subscription.unsubscribe()
}
