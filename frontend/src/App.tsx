import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Overview from './pages/Overview'
import CourseDetail from './pages/CourseDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/courses/:courseId" element={<CourseDetail />} />
      </Routes>
    </BrowserRouter>
  )
}
