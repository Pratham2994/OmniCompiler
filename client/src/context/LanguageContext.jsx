import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * LanguageContext (per-file)
 * - Single source of truth for language per fileId.
 * - Auto-detect (heuristic for now) and manual override are both tracked per file.
 * - startPollingForFile polls only the provided fileId (caller should pass active file).
 * - All future HTTP/WS for detection will live here only.
 */

const MONACO_IDS = ['python', 'javascript', 'java', 'cpp', 'go', 'plaintext']

// API base for backend detection
const API_BASE = (import.meta?.env?.VITE_API_BASE) || 'http://localhost:8000'
const DETECT_CHUNK = 4000

function normalizeLang(id) {
  const s = String(id || '').toLowerCase()
  return MONACO_IDS.includes(s) ? s : 'plaintext'
}

// Build request body for /detect
function buildDetectPayload(code = '') {
  const text = String(code || '')
  const first = text.slice(0, DETECT_CHUNK)
  const last = text.slice(Math.max(0, text.length - DETECT_CHUNK))
  const enc = new TextEncoder()
  return {
    first_chunk: first,
    last_chunk: last,
    total_len: text.length,
    n_bytes: enc.encode(text).length,
    mode: 'auto',
  }
}

// Call backend /detect endpoint
async function postDetect(code = '') {
  try {
    const res = await fetch(`${API_BASE}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDetectPayload(code)),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data && data.status === 'ok' && data.lang) {
      return normalizeLang(data.lang)
    }
    return null
  } catch {
    return null
  }
}

// Heuristic fallback (kept for any offline/edge cases)
function heuristicDetectLanguage(code = '') {
  const src = String(code || '')
  if (!src.trim()) return 'plaintext'
  if ((/(^|\n)\s*def\s+\w+\s*\(|(^|\n)\s*class\s+\w+\s*:/m.test(src)) || /\bprint\s*\(/.test(src) || /:\s*\n\s{2,}\w/.test(src)) return 'python'
  if (/#include\s+[<"].*?[>"]/m.test(src) || /std::/.test(src) || /\bint\s+main\s*\(/.test(src)) return 'cpp'
  if (/\bpackage\s+main\b/.test(src) || /\bfunc\s+main\s*\(/.test(src) || /\bimport\s+\(/.test(src) || /\bfmt\.Print/.test(src)) return 'go'
  if (/\bclass\s+\w+\s*\{/.test(src) || /\bpublic\s+static\s+void\s+main\s*\(\s*String\[\]\s+\w+\)/.test(src) || /\bSystem\.out\.println\s*\(/.test(src)) return 'java'
  if (/\bconsole\.log\s*\(/.test(src) || /\bfunction\s+\w+\s*\(/.test(src) || /\b(const|let|var)\s+\w+\s*=/.test(src) || /\bimport\s+.*\s+from\s+['"]/m.test(src)) return 'javascript'
  return 'plaintext'
}

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  // Global toggle: auto vs manual (applies to how effective language is chosen per-file)
  const [autoDetect, setAutoDetect] = useState(true)

  // Per-file maps
  const [manualByFile, setManualByFile] = useState(() => ({}))          // { [fileId]: monacoId }
  const [detectedByFile, setDetectedByFile] = useState(() => ({}))      // { [fileId]: monacoId }

  // Version bump to trigger subscribers when any per-file value changes
  const [version, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)

  // Poll timers per file
  const pollTimersRef = useRef(new Map()) // fileId -> intervalId
  const inFlightRef = useRef(new Map())   // fileId -> boolean (prevent overlapping requests)

  // Accessors
  const getManualLanguage = (fileId) => {
    const v = (fileId && manualByFile[fileId]) || ''
    return MONACO_IDS.includes(v) ? v : ''
  }
  const getDetectedLanguage = (fileId) => {
    const v = (fileId && detectedByFile[fileId]) || ''
    return MONACO_IDS.includes(v) ? v : ''
  }
  const getEffectiveLanguage = (fileId) => {
    const raw = autoDetect
      ? (getDetectedLanguage(fileId) || 'plaintext')
      : (getManualLanguage(fileId) || 'plaintext')
    return MONACO_IDS.includes(raw) ? raw : 'plaintext'
  }

  // Setters
  const setManualLanguage = (fileId, langId) => {
    if (!fileId) return
    setManualByFile(prev => {
      const next = { ...prev, [fileId]: (MONACO_IDS.includes(langId) ? langId : 'plaintext') }
      return next
    })
    bump()
  }
  const setDetectedLanguage = (fileId, langId) => {
    if (!fileId) return
    setDetectedByFile(prev => {
      const next = { ...prev, [fileId]: (MONACO_IDS.includes(langId) ? langId : 'plaintext') }
      return next
    })
    bump()
  }

  // Polling for a specific file
  function stopPollingForFile(fileId) {
    if (!fileId) return
    const m = pollTimersRef.current
    const t = m.get(fileId)
    if (t) {
      clearInterval(t)
      m.delete(fileId)
    }
  }
  function stopAllPolling() {
    const m = pollTimersRef.current
    for (const t of m.values()) clearInterval(t)
    m.clear()
  }
  function startPollingForFile(fileId, getCode, intervalMs = 2000) {
    if (!fileId || typeof getCode !== 'function') return
    stopPollingForFile(fileId)

    const tick = async () => {
      if (inFlightRef.current.get(fileId)) return
      inFlightRef.current.set(fileId, true)
      try {
        const code = getCode() || ''
        const lang = await postDetect(code)
        if (lang) setDetectedLanguage(fileId, lang)
      } finally {
        inFlightRef.current.set(fileId, false)
      }
    }

    // Fire once immediately, then every interval
    tick()
    const id = setInterval(tick, Math.max(500, Number(intervalMs) || 2000))
    pollTimersRef.current.set(fileId, id)
  }

  useEffect(() => () => stopAllPolling(), [])

  // Helpers
  async function detectLanguageOnce(getCode, fileId) {
    const code = typeof getCode === 'function' ? (getCode() || '') : ''
    const lang = heuristicDetectLanguage(code)
    if (fileId) setDetectedLanguage(fileId, lang)
    return lang
  }

  function buildRunPayload({ fileId, code, languageOverride } = {}) {
    const fallback = getEffectiveLanguage(fileId)
    const language = (languageOverride && MONACO_IDS.includes(languageOverride)) ? languageOverride : fallback
    return {
      fileId: String(fileId ?? ''),
      language,
      code: String(code ?? ''),
      timestamp: Date.now(),
    }
  }

  // Placeholders for future HTTP/WS
  async function requestDetectFromServer(code, fileId) {
    const lang = await postDetect(code || '')
    if (lang && fileId) setDetectedLanguage(fileId, lang)
    return { fileId, language: lang || null }
  }
  function connectLanguageWs() { return () => {} }
  function disconnectLanguageWs() {}

  const value = useMemo(() => ({
    // global
    autoDetect,
    setAutoDetect,
    version,
    // per-file getters
    getManualLanguage,
    getDetectedLanguage,
    getEffectiveLanguage,
    // per-file setters
    setManualLanguage,
    setDetectedLanguage,
    // polling (per-file)
    startPollingForFile,
    stopPollingForFile,
    stopAllPolling,
    // helpers/stubs
    detectLanguageOnce,
    buildRunPayload,
    requestDetectFromServer,
    connectLanguageWs,
    disconnectLanguageWs,
  }), [autoDetect, version, manualByFile, detectedByFile])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}