import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Run from './pages/Run.jsx'
import Debug from './pages/Debug.jsx'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/run" replace />} />
        <Route path="/run" element={<Run />} />
        <Route path="/debug" element={<Debug />} />
        <Route path="*" element={<Navigate to="/run" replace />} />
      </Routes>
    </BrowserRouter>
  )
}