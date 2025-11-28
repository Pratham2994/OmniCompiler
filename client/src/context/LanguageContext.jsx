import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

const MONACO_IDS = ['python', 'javascript', 'java', 'cpp', 'go', 'plaintext']

const normalizeNewlines = (text = '') => text.replace(/\r\n?/g, '\n')

const API_BASE = (import.meta?.env?.VITE_API_BASE) || 'http://localhost:8000'
const DETECT_CHUNK = 4000

function normalizeLang(id) {
  const s = String(id || '').toLowerCase()
  return MONACO_IDS.includes(s) ? s : 'plaintext'
}

function buildDetectPayload(code = '', moreChunks = null) {
  const text = normalizeNewlines(String(code || ''))
  const first = text.slice(0, DETECT_CHUNK)
  const last = text.slice(Math.max(0, text.length - DETECT_CHUNK))
  const enc = new TextEncoder()
  const payload = {
    first_chunk: first,
    last_chunk: last,
    total_len: text.length,
    n_bytes: enc.encode(text).length,
    mode: 'auto',
  }
  if (Array.isArray(moreChunks) && moreChunks.length) {
    payload.more_chunks = moreChunks
  }
  return payload
}

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

async function detectFromServerWithRetries(code = '', maxRounds = 3) {
  let rounds = 0
  let moreChunks = null
  const text = String(code || '')
  while (rounds < maxRounds) {
    const body = buildDetectPayload(text, moreChunks)
    try {
      const res = await fetch(`${API_BASE}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) break
      const data = await res.json()
      if (data?.status === 'ok' && data?.lang) {
        return {
          status: 'ok',
          lang: normalizeLang(data.lang),
          confidence: data?.confidence ?? null,
          source: data?.source ?? null,
        }
      }
      if (data?.status === 'need_more' && Array.isArray(data?.request_ranges) && data.request_ranges.length) {
        const chunks = []
        for (const r of data.request_ranges) {
          const s = Number(r?.start ?? 0)
          const e = (r?.end != null)
            ? Number(r.end)
            : (r?.len != null ? s + Number(r.len) : Math.min(s + DETECT_CHUNK, text.length))
          const start = Math.max(0, s)
          const end = Math.max(start, Math.min(text.length, e))
          const dataStr = text.slice(start, end)
          chunks.push({ start, data: dataStr })
        }
        moreChunks = chunks
        rounds += 1
        continue
      }
      break
    } catch {
      break
    }
  }
  return { status: 'error', lang: null, confidence: null, source: null }
}

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
  const [autoDetect, setAutoDetect] = useState(true)

  const [manualByFile, setManualByFile] = useState(() => ({}))
  const [detectedByFile, setDetectedByFile] = useState(() => ({}))
  const [lastMetaByFile, setLastMetaByFile] = useState(() => ({}))

  const [version, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)

  const pollTimersRef = useRef(new Map())
  const inFlightRef = useRef(new Map())

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
  const getLastDetectMeta = (fileId) => {
    return (fileId && lastMetaByFile[fileId]) || null
  }

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
        const res = await detectFromServerWithRetries(code, 3)
        if (res?.lang) {
          setDetectedLanguage(fileId, res.lang)
          setLastMetaByFile(prev => ({ ...prev, [fileId]: { status: res.status, lang: res.lang, confidence: res.confidence, source: res.source } }))
        }
      } finally {
        inFlightRef.current.set(fileId, false)
      }
    }

    tick()
    const id = setInterval(tick, Math.max(500, Number(intervalMs) || 2000))
    pollTimersRef.current.set(fileId, id)
  }

  useEffect(() => () => stopAllPolling(), [])

  async function detectLanguageOnce(getCode, fileId) {
    const raw = typeof getCode === 'function' ? (getCode() || '') : ''
    const code = normalizeNewlines(String(raw))
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
      code: normalizeNewlines(String(code ?? '')),
      timestamp: Date.now(),
    }
  }

  async function requestDetectFromServer(code, fileId) {
    const res = await detectFromServerWithRetries(code || '', 3)
    if (res?.lang && fileId) {
      setDetectedLanguage(fileId, res.lang)
      setLastMetaByFile(prev => ({ ...prev, [fileId]: { status: res.status, lang: res.lang, confidence: res.confidence, source: res.source } }))
    }
    return { fileId, language: res?.lang || null, status: res?.status ?? 'error', confidence: res?.confidence ?? null, source: res?.source ?? null }
  }
  function connectLanguageWs() { return () => {} }
  function disconnectLanguageWs() {}

  const value = useMemo(() => ({
    autoDetect,
    setAutoDetect,
    version,
    apiBase: API_BASE,
    getManualLanguage,
    getDetectedLanguage,
    getEffectiveLanguage,
    getLastDetectMeta,
    setManualLanguage,
    setDetectedLanguage,
    startPollingForFile,
    stopPollingForFile,
    stopAllPolling,
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
