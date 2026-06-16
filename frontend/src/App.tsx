import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Overview from './pages/Overview'
import CourseGroupDetail from './pages/CourseGroupDetail'
import CourseDetail from './pages/CourseDetail'
import Students from './pages/Students'
import StudentProfile from './pages/StudentProfile'
import Reports from './pages/Reports'
import Login from './pages/Login'
import Admin from './pages/Admin'
import ExtensionBridge from './pages/ExtensionBridge'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Overview /></ProtectedRoute>} />
        <Route path="/courses/group/:groupCode" element={<ProtectedRoute><CourseGroupDetail /></ProtectedRoute>} />
        <Route path="/courses/:courseId" element={<ProtectedRoute><CourseDetail /></ProtectedRoute>} />
        <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
        <Route path="/students/:userId" element={<ProtectedRoute><StudentProfile /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/extension-bridge" element={<ProtectedRoute><ExtensionBridge /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
