import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Run from './pages/Run.jsx'
import Debug from './pages/Debug.jsx'
import Translate from './pages/Translate.jsx'
import Insights from './pages/Insights.jsx'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/run" replace />} />
        <Route path="/run" element={<Run />} />
        <Route path="/debug" element={<Debug />} />
        <Route path="/translate" element={<Translate />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="*" element={<Navigate to="/run" replace />} />
      </Routes>
    </BrowserRouter>
  )
}