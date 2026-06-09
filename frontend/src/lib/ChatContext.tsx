import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react'
import { sendChatMessage } from '../services/api'
import type { ChatMessage } from '../types'

interface ChatContextType {
  open: boolean
  setOpen: (open: boolean) => void
  messages: ChatMessage[]
  setMessages: (messages: ChatMessage[]) => void
  input: string
  setInput: (input: string) => void
  loading: boolean
  error: string | null
  setError: (error: string | null) => void
  send: (text: string) => Promise<void>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

/** Turn a thrown fetch error into a short, user-friendly message. */
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // The backend returns a clean { "detail": "..." } message — surface just that.
  const m = raw.match(/"detail"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  if (/\b429\b|quota|rate.?limit/i.test(raw)) {
    return 'The assistant is busy right now. Please wait a moment and try again.'
  }
  if (/\b5\d\d\b|network|failed to fetch/i.test(raw)) {
    return 'The assistant is temporarily unavailable. Please try again shortly.'
  }
  return 'Something went wrong. Please try again.'
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    
    setError(null)
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setLoading(true)
    
    try {
      const res = await sendChatMessage(next)
      setMessages([...next, { role: 'assistant', content: res.reply }])
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [loading, messages])

  return (
    <ChatContext.Provider
      value={{
        open,
        setOpen,
        messages,
        setMessages,
        input,
        setInput,
        loading,
        error,
        setError,
        send
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const context = useContext(ChatContext)
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}
