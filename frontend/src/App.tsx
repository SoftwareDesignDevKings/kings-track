import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Overview from './pages/Overview'
import CourseDetail from './pages/CourseDetail'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'
import Login from './pages/Login'
import Admin from './pages/Admin'
import ExtensionBridge from './pages/ExtensionBridge'
import ProtectedRoute from './components/ProtectedRoute'
import ChatWidget from './components/ChatWidget'

function GlobalChat() {
  // The assistant is available on every authenticated page, but not on login.
  const { pathname } = useLocation()
  if (pathname === '/login') return null
  return <ChatWidget />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Overview /></ProtectedRoute>} />
        <Route path="/courses/:courseId" element={<ProtectedRoute><CourseDetail /></ProtectedRoute>} />
        <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
        <Route path="/students/:userId" element={<ProtectedRoute><StudentProfile /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/extension-bridge" element={<ProtectedRoute><ExtensionBridge /></ProtectedRoute>} />
      </Routes>
      <GlobalChat />
    </BrowserRouter>
  )
}
