import React from 'react'
import Header from './Header'
import ChatWidget from './ChatWidget'
import { useLocation } from 'react-router-dom'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  
  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <Header />
      <div className="flex min-h-0 flex-1 overflow-hidden relative">
        {/* Main Content Area */}
        <div className="flex-1 overflow-auto min-w-0">
          {children}
        </div>
        
        {/* Inline ChatWidget (renders as flex item when open, fixed button when closed) */}
        <ChatWidget />
      </div>
    </div>
  )
}
