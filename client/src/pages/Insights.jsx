import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext.jsx'
import { Icon, ManualLanguagePicker } from '../components/run/ui.jsx'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const stripExtension = (name = '') => {
  const clean = String(name || '').trim()
  if (!clean) return 'file'
  const idx = clean.lastIndexOf('.')
  if (idx > 0) return clean.slice(0, idx)
  return clean
}

const LANGUAGE_LABELS = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  cpp: 'C++',
  go: 'Go',
  c: 'C',
  csharp: 'C#',
  rust: 'Rust',
  kotlin: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  ruby: 'Ruby',
  sql: 'SQL',
  html_css: 'HTML/CSS',
  bash: 'Bash',
  assembly: 'Assembly (x86-64)',
  plaintext: 'Plain Text',
}

const languageLabel = (id) => LANGUAGE_LABELS[id?.toLowerCase()] || 'Plain Text'

const EXTENSION_MAP = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  csharp: 'cs',
  go: 'go',
  rust: 'rs',
  kotlin: 'kt',
  swift: 'swift',
  php: 'php',
  ruby: 'rb',
  sql: 'sql',
  html_css: 'html',
  bash: 'sh',
  assembly: 'asm',
  plaintext: 'txt',
}

const extForLang = (id) => EXTENSION_MAP[id?.toLowerCase()] || 'txt'

const defaultFiles = [
  { id: 'f1', name: 'Main', language: 'plaintext', content: 'Hello!' },
]

const normalizeNewlines = (text = '') => text.replace(/\r\n?/g, '\n')

const LS_KEY = 'oc_files_snapshot_v1'
const LS_TTL_MS = 10 * 60 * 1000
const INSIGHT_SNAPSHOT_KEY = 'oc_insights_snapshot_v1'
const INSIGHT_TTL_MS = 10 * 60 * 1000

const readFreshSnapshot = () => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.files) || typeof data.ts !== 'number') return null
    if ((Date.now() - data.ts) > LS_TTL_MS) return null
    const files = data.files.slice(0, 5).map((f, idx) => {
      const id = String(f?.id || `f_restored_${idx}_${Math.random().toString(36).slice(2, 8)}`)
      const content = normalizeNewlines(String(f?.content || ''))
      return { id, name: String(f?.name || `file_${idx + 1}`), language: 'plaintext', content }
    })
    const activeId = (data.activeId && files.find((x) => x.id === data.activeId)) ? data.activeId : (files[0]?.id || null)
    return { files, activeId }
  } catch {
    return null
  }
}

const readInsightSnapshot = () => {
  try {
    const raw = localStorage.getItem(INSIGHT_SNAPSHOT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data.ts !== 'number' || !data.result) return null
    if ((Date.now() - data.ts) > INSIGHT_TTL_MS) return null
    return {
      result: data.result,
      focusPath: data.focusPath || null,
      lastInsightAt: typeof data.lastInsightAt === 'number' ? data.lastInsightAt : null,
    }
  } catch {
    return null
  }
}

function useFocusTrap(active) {
  const containerRef = useRef(null)
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const focusable = container.querySelectorAll(
      'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    const handleKey = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      } else if (e.key === 'Escape') {
        container.dispatchEvent(new CustomEvent('trap-escape', { bubbles: true }))
      }
    }
    container.addEventListener('keydown', handleKey)
    if (first) first.focus()

    return () => {
      container.removeEventListener('keydown', handleKey)
    }
  }, [active])

  return containerRef
}

const formatTimestamp = (date) => {
  if (!date) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const asList = (value) => {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

export default function Insights() {
  const THEME_MAP = {
    'vscode-dark-plus': { rootClass: ['theme-dark', 'dark'], monaco: 'vs-dark' },
    'vscode-light-plus': { rootClass: ['theme-light'], monaco: 'vs' },
    'vscode-high-contrast': { rootClass: ['theme-hc', 'dark'], monaco: 'hc-black' },
  }

  const [theme, setTheme] = useState(() => localStorage.getItem('oc_theme') || 'vscode-dark-plus')
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-light', 'theme-dark', 'theme-hc', 'dark')
    const conf = THEME_MAP[theme] || THEME_MAP['vscode-dark-plus']
    conf.rootClass.forEach((c) => root.classList.add(c))
    localStorage.setItem('oc_theme', theme)
  }, [theme])

  const {
    autoDetect,
    setAutoDetect,
    getManualLanguage,
    getEffectiveLanguage,
    setManualLanguage,
    startPollingForFile,
    stopPollingForFile,
    apiBase,
  } = useLanguage()

  const initialInsightSnapshot = useMemo(() => readInsightSnapshot(), [])

  const [files, setFiles] = useState(() => {
    const snap = readFreshSnapshot()
    return snap?.files || defaultFiles
  })
  const [activeFileId, setActiveFileId] = useState(() => {
    const snap = readFreshSnapshot()
    return snap?.activeId || (snap?.files?.[0]?.id) || 'f1'
  })
  const activeFile = useMemo(() => files.find((f) => f.id === activeFileId) || files[0], [files, activeFileId])

  const [hydrated, setHydrated] = useState(false)
  const saveTimerRef = useRef(null)
  const modelsRef = useRef(new Map())

  const flushSnapshot = useCallback(() => {
    if (!hydrated) return
    try {
      const filesToSave = (files || []).map((f) => {
        let content = normalizeNewlines(String(f.content ?? ''))
        try {
          const m = modelsRef.current?.get(f.id)
          if (m && typeof m.getValue === 'function') {
            content = normalizeNewlines(String(m.getValue() ?? f.content ?? ''))
          }
        } catch {}
        return { id: f.id, name: f.name, content }
      }).slice(0, 5)
      const payload = { ts: Date.now(), activeId: activeFileId, files: filesToSave }
      localStorage.setItem(LS_KEY, JSON.stringify(payload))
    } catch {}
  }, [files, activeFileId, hydrated])

  const flushSnapshotRef = useRef(flushSnapshot)
  useEffect(() => {
    flushSnapshotRef.current = flushSnapshot
  }, [flushSnapshot])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      flushSnapshotRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (data && typeof data.ts === 'number' && (Date.now() - data.ts) > LS_TTL_MS) {
          localStorage.removeItem(LS_KEY)
        }
      }
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveTimerRef.current = setTimeout(() => {
      flushSnapshot()
      saveTimerRef.current = null
    }, 400)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [flushSnapshot, hydrated])

  useEffect(() => {
    if (!hydrated) return
    const handleBeforeUnload = () => flushSnapshot()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushSnapshot()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [flushSnapshot, hydrated])

  const manualLanguage = getManualLanguage(activeFileId)
  const effectiveLanguage = getEffectiveLanguage(activeFileId)

  const [leftMounted, setLeftMounted] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [leftTab] = useState('files')
  const leftTrapRef = useFocusTrap(leftOpen)
  const openDrawer = () => {
    if (leftMounted && leftOpen) return
    setLeftMounted(true)
    requestAnimationFrame(() => setLeftOpen(true))
  }
  const closeDrawer = () => {
    setLeftOpen(false)
    setTimeout(() => setLeftMounted(false), 200)
  }
  useEffect(() => {
    if (!leftOpen) return
    const el = leftTrapRef.current
    if (!el) return
    const h = () => closeDrawer()
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [leftOpen, leftTrapRef])

  const [outputCollapsed, setOutputCollapsed] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.65)
  const isResizingRef = useRef(false)
  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current) return
      const bodyRect = document.getElementById('oc-workspace')?.getBoundingClientRect()
      if (!bodyRect) return
      const x = e.clientX - bodyRect.left
      const ratio = clamp(x / bodyRect.width, 0.4, 0.7)
      setSplitRatio(ratio)
    }
    const onUp = () => {
      isResizingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const [workspaceW, setWorkspaceW] = useState(0)
  useEffect(() => {
    const el = document.getElementById('oc-workspace')
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r?.width) setWorkspaceW(r.width)
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect?.()
    if (rect?.width) setWorkspaceW(rect.width)
    return () => ro.disconnect()
  }, [])

  const editorContainerRef = useRef(null)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 })
  const [monacoReady, setMonacoReady] = useState(Boolean(window.monaco))
  useEffect(() => {
    const handleReady = () => setMonacoReady(true)
    window.addEventListener('monaco_ready', handleReady)
    if (window.monaco) setMonacoReady(true)
    return () => {
      window.removeEventListener('monaco_ready', handleReady)
    }
  }, [])

  useEffect(() => {
    if (!monacoReady) return
    if (editorRef.current) return
    const el = editorContainerRef.current
    if (!el) return
    const monaco = window.monaco
    monacoRef.current = monaco
    const ensureModel = (file) => {
      let m = modelsRef.current.get(file.id)
      if (!m) {
        m = monaco.editor.createModel(file.content, 'plaintext')
        modelsRef.current.set(file.id, m)
        m.onDidChangeContent(() => {
          const value = normalizeNewlines(m.getValue() || '')
          setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, content: value } : f)))
        })
      }
      return m
    }
    const editor = monaco.editor.create(el, {
      value: activeFile?.content ?? '',
      language: effectiveLanguage || 'plaintext',
      automaticLayout: true,
      minimap: { enabled: true },
      theme: (THEME_MAP[theme]?.monaco || 'vs-dark'),
      fontSize: 14,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'all',
      cursorBlinking: 'smooth',
      tabSize: 4,
      insertSpaces: true,
      roundedSelection: true,
      wordWrap: 'off',
      contextmenu: true,
      renderWhitespace: 'selection',
      renderIndentGuides: true,
      bracketPairColorization: { enabled: true },
    })

    editor.onDidChangeCursorPosition((ev) => {
      setCursorPos({ line: ev.position.lineNumber, column: ev.position.column })
    })

    if (activeFile) {
      const model = ensureModel(activeFile)
      editor.setModel(model)
      monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
    }
    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monacoReady])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    const conf = THEME_MAP[theme] || THEME_MAP['vscode-dark-plus']
    monaco.editor.setTheme(conf.monaco)
  }, [theme])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const model = editor.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
  }, [effectiveLanguage])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor || !activeFile) return
    let model = modelsRef.current.get(activeFile.id)
    if (!model) {
      model = monaco.editor.createModel(activeFile.content, 'plaintext')
      modelsRef.current.set(activeFile.id, model)
      model.onDidChangeContent(() => {
        const value = normalizeNewlines(model.getValue() || '')
        setFiles((prev) => prev.map((f) => (f.id === activeFile.id ? { ...f, content: value } : f)))
      })
    }
    editor.setModel(model)
    monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
    const pos = editor.getPosition()
    if (pos) setCursorPos({ line: pos.lineNumber, column: pos.column })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, files.length])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrapRef = useFocusTrap(settingsOpen)
  const [fontSize, setFontSize] = useState(14)
  useEffect(() => {
    const ed = editorRef.current
    if (ed) ed.updateOptions({ fontSize })
  }, [fontSize])
  useEffect(() => {
    if (!settingsOpen) return
    const el = settingsTrapRef.current
    if (!el) return
    const h = () => setSettingsOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [settingsOpen, settingsTrapRef])

  const [showToast, setShowToast] = useState(null)
  const triggerToast = useCallback((msg) => {
    setShowToast(msg)
    setTimeout(() => setShowToast(null), 1800)
  }, [])

  const onNewFile = () => {
    if (files.length >= 5) {
      triggerToast('Max 5 files allowed')
      return
    }
    const name = prompt('Enter file name (no extension displayed):')
    if (!name) return
    const clean = stripExtension(name.trim())
    if (!clean) {
      triggerToast('Name cannot be empty')
      return
    }
    if (files.some((f) => f.name === clean)) {
      triggerToast('Duplicate name not allowed')
      return
    }
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: 'plaintext', content: '' }
    setFiles((prev) => [...prev, newFile])
    setActiveFileId(id)
  }

  const uploadInDrawerRef = useRef(null)
  const onDrawerUpload = () => uploadInDrawerRef.current?.click()
  const onDrawerUploadSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const clean = stripExtension(file.name)
    if (!clean) return
    if (files.length >= 5) {
      triggerToast('Max 5 files allowed')
      return
    }
    if (files.some((f) => f.name === clean)) {
      triggerToast('Duplicate name not allowed')
      return
    }
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: 'plaintext', content: '' }
    setFiles((prev) => [...prev, newFile])
    setActiveFileId(id)
    triggerToast(`Opened "${file.name}" (name shown without extension)`)
    e.target.value = ''
  }

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const onRenameFile = (id, newName) => {
    const clean = stripExtension(newName.trim())
    if (!clean) {
      triggerToast('Name cannot be empty')
      return false
    }
    if (files.some((f) => f.name === clean && f.id !== id)) {
      triggerToast('Duplicate name not allowed')
      return false
    }
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name: clean } : f)))
    return true
  }
  const onDeleteFile = (id) => {
    if (files.length <= 1) {
      triggerToast('At least one file must remain')
      return
    }
    if (!confirm('Delete this file?')) return
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id)
      if (id === activeFileId && next.length) setActiveFileId(next[0].id)
      return next
    })
  }

  const [quickOpen, setQuickOpen] = useState(false)
  const quickTrapRef = useFocusTrap(quickOpen)
  const [quickQuery, setQuickQuery] = useState('')
  const quickList = files.filter((f) => f.name.toLowerCase().includes(quickQuery.toLowerCase()))
  const chooseQuick = (id) => {
    setActiveFileId(id)
    setQuickOpen(false)
  }
  useEffect(() => {
    if (!quickOpen) return
    const el = quickTrapRef.current
    if (!el) return
    const h = () => setQuickOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [quickOpen, quickTrapRef])

  const onFormat = async () => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const action = ed.getAction('editor.action.formatDocument')
      if (action) {
        await action.run()
        triggerToast('Formatted')
        return
      }
    } catch {}
    const model = ed.getModel()
    if (!model) return
    const original = model.getValue()
    const normalized = original
      .split('\n')
      .map((line) => line.replace(/\s+$/g, '').replace(/\t/g, '    '))
      .join('\n')
    if (normalized !== original) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: normalized }], () => null)
      triggerToast('Formatted')
    }
  }

  const onFind = () => {
    const ed = editorRef.current
    if (!ed) return
    ed.getAction('actions.find')?.run()
  }

  const toggleOutputCollapsed = () => setOutputCollapsed((v) => !v)

  const editorBasisPx = Math.max(0, Math.round((outputCollapsed ? 1 : splitRatio) * workspaceW))
  const outputBasisPx = Math.max(0, Math.round((outputCollapsed ? 0 : (1 - splitRatio)) * workspaceW))
  const editorWidthStyle = workspaceW ? editorBasisPx : (outputCollapsed ? '100%' : `${Math.round(splitRatio * 100)}%`)
  const outputWidthStyle = workspaceW ? outputBasisPx : (outputCollapsed ? '0%' : `${Math.round((1 - splitRatio) * 100)}%`)
  const editorCompact = !outputCollapsed && splitRatio < 0.28

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFileId) return
    if (autoDetect) {
      startPollingForFile(activeFileId, () => normalizeNewlines(editor.getModel()?.getValue() || ''), 2000)
    } else {
      stopPollingForFile(activeFileId)
    }
    return () => {
      stopPollingForFile(activeFileId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetect, monacoReady, activeFileId])

  const getLiveContent = useCallback((file) => {
    const model = modelsRef.current.get(file.id)
    if (model && typeof model.getValue === 'function') {
      return normalizeNewlines(String(model.getValue() ?? ''))
    }
    return normalizeNewlines(String(file.content ?? ''))
  }, [])

  const nameWithExt = useCallback((file, fallbackLang) => {
    const resolvedLang = getEffectiveLanguage(file.id) || fallbackLang || 'plaintext'
    const ext = extForLang(resolvedLang)
    const base = stripExtension(file.name || 'file')
    return ext ? `${base}.${ext}` : base
  }, [getEffectiveLanguage])

  const buildInsightPayload = useCallback(() => {
    const entryLang = getEffectiveLanguage(activeFileId) || 'plaintext'
    const focusFile = files.find((f) => f.id === activeFileId) || files[0]
    const focusPath = focusFile ? nameWithExt(focusFile, entryLang) : null
    const payloadFiles = files
      .map((file) => {
        const content = getLiveContent(file)
        if (!content.trim()) return null
        return { path: nameWithExt(file, entryLang), content }
      })
      .filter(Boolean)

    return { entryLang, focus_path: focusPath, files: payloadFiles }
  }, [files, activeFileId, getEffectiveLanguage, getLiveContent, nameWithExt])

  const [insightResult, setInsightResult] = useState(() => initialInsightSnapshot?.result ?? null)
  const [insightBusy, setInsightBusy] = useState(false)
  const [insightError, setInsightError] = useState(null)
  const [lastInsightAt, setLastInsightAt] = useState(() => (
    initialInsightSnapshot?.lastInsightAt ? new Date(initialInsightSnapshot.lastInsightAt) : null
  ))
  const [lastFocusPath, setLastFocusPath] = useState(initialInsightSnapshot?.focusPath || null)

  const writeInsightSnapshot = useCallback((payload) => {
    try {
      if (!payload) {
        localStorage.removeItem(INSIGHT_SNAPSHOT_KEY)
        return
      }
      localStorage.setItem(INSIGHT_SNAPSHOT_KEY, JSON.stringify({
        ts: Date.now(),
        result: payload.result,
        focusPath: payload.focusPath || null,
        lastInsightAt: payload.lastInsightAt ?? null,
      }))
    } catch {}
  }, [])

  const generateInsights = useCallback(async () => {
    if (!activeFile) {
      triggerToast('Add or select a file to analyze')
      return
    }
    const activeContent = getLiveContent(activeFile)
    if (!activeContent.trim()) {
      triggerToast('Active file is empty. Add some code first.')
      return
    }
    const payloadMeta = buildInsightPayload()
    if (!payloadMeta.focus_path) {
      triggerToast('Unable to determine focus file path')
      return
    }
    if (!payloadMeta.files.length) {
      triggerToast('Add code to at least one file before requesting insights')
      return
    }

    setInsightBusy(true)
    setInsightError(null)
    try {
      const res = await fetch(`${apiBase}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: payloadMeta.files,
          focus_path: payloadMeta.focus_path,
          language: payloadMeta.entryLang === 'plaintext' ? undefined : payloadMeta.entryLang,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const nowTs = Date.now()
      setInsightResult(data)
      setLastInsightAt(new Date(nowTs))
      setLastFocusPath(payloadMeta.focus_path)
      writeInsightSnapshot({ result: data, focusPath: payloadMeta.focus_path, lastInsightAt: nowTs })
    } catch (err) {
      setInsightError(err?.message || 'Unable to generate insights')
    } finally {
      setInsightBusy(false)
    }
  }, [activeFile, apiBase, buildInsightPayload, getLiveContent, triggerToast, writeInsightSnapshot])

  const clearInsights = useCallback(() => {
    setInsightResult(null)
    setInsightError(null)
    setLastInsightAt(null)
    setLastFocusPath(null)
    writeInsightSnapshot(null)
  }, [writeInsightSnapshot])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        generateInsights()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p')) {
        e.preventDefault()
        setQuickOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f')) {
        const ed = editorRef.current
        if (ed) {
          e.preventDefault()
          ed.getAction('actions.find')?.run()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generateInsights])

  const languageBadgeText = autoDetect
    ? `Detected: ${languageLabel(effectiveLanguage)} (auto)`
    : `Pinned: ${languageLabel(manualLanguage || effectiveLanguage)} (manual)`

  const focusPreview = activeFile
    ? nameWithExt(activeFile, effectiveLanguage)
    : 'main.py'
  const insightLanguage = insightResult?.language || languageLabel(effectiveLanguage)

  return (
    <div className="h-screen w-screen">
      <a
        href="#editor-pane"
        className="sr-only focus:not-sr-only absolute top-1 left-1 z-50 bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
      >
        Skip to editor
      </a>

      <header className="h-14 border-b border-[var(--oc-border)] flex items-center justify-between px-3 gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/run"
            className="flex items-center gap-2 text-sm font-semibold px-2 py-1 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
            aria-label="Omni Compiler Home"
          >
            <Icon name="file" className="size-4" />
            <span>Omni Compiler</span>
          </Link>

          <span aria-hidden="true" className="h-5 w-px bg-[var(--oc-border)]" />

          <nav className="flex items-center gap-2" aria-label="Primary">
            <Link
              to="/run"
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-surface-2)]"
            >
              Run
            </Link>
            <Link
              to="/debug"
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-surface-2)]"
            >
              Debug
            </Link>
            <Link
              to="/translate"
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-surface-2)]"
            >
              Translate
            </Link>
            <Link
              to="/insights"
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)]"
            >
              AI Insights
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <button
            id="settingsBtn"
            onClick={() => setSettingsOpen(true)}
            className="oc-btn oc-btn-primary"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen ? 'true' : 'false'}
          >
            <Icon name="settings" />
            Settings
          </button>
        </div>
      </header>

      <div className="relative h-[calc(100vh-56px)] w-full overflow-hidden">
        <button
          data-testid="tid-left-drawer-trigger"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 oc-icon-btn rounded-r-lg"
          aria-label="Files & Deps"
          onClick={openDrawer}
          title="Files & Deps"
        >
          <Icon name="chevron-right" />
        </button>

        {leftMounted && (
          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-y-0 left-0 z-40 flex"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeDrawer()
            }}
          >
            <div
              ref={leftTrapRef}
              className={`w-[300px] h-full bg-[var(--oc-surface)] border-r border-[var(--oc-border)] shadow-xl outline-none transform transition-transform duration-200 ${leftOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
              <div className="h-12 px-3 border-b border-[var(--oc-border)] flex items-center justify-between">
                <div className="text-sm font-medium">Files</div>
                <button
                  onClick={closeDrawer}
                  className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
                  aria-label="Close drawer"
                  title="Close"
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="p-3">
                {leftTab === 'files' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-[var(--oc-muted)]">Max 5 items</div>
                      <div className="flex items-center gap-1">
                        <button
                          data-testid="tid-add-file"
                          className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
                          title="Add new file (name only)"
                          aria-label="Add new file"
                          onClick={onNewFile}
                        >
                          <Icon name="plus" />
                        </button>
                        <input ref={uploadInDrawerRef} type="file" className="hidden" onChange={onDrawerUploadSelected} />
                        <button
                          data-testid="tid-upload-file"
                          className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
                          title="Upload file (name shown without extension)"
                          aria-label="Upload file"
                          onClick={onDrawerUpload}
                        >
                          <Icon name="upload" />
                        </button>
                      </div>
                    </div>
                    <ul
                      data-testid="tid-files-list"
                      className="space-y-1"
                      role="listbox"
                      aria-label="Files list"
                    >
                      {files.length === 0 && (
                        <li className="text-sm text-[var(--oc-muted)]">No files yet. Click + to add.</li>
                      )}
                      {files.map((f) => (
                        <li
                          key={f.id}
                          className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm cursor-pointer ${activeFileId === f.id ? 'oc-selected' : 'hover:bg-[var(--oc-surface-2)]'}`}
                          onClick={() => setActiveFileId(f.id)}
                          aria-selected={activeFileId === f.id ? 'true' : 'false'}
                          role="option"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon name="file" />
                            {renamingId === f.id ? (
                              <form
                                className="flex-1 min-w-0"
                                onSubmit={(e) => {
                                  e.preventDefault()
                                  const ok = onRenameFile(f.id, renameValue)
                                  if (ok) {
                                    setRenamingId(null)
                                    setRenameValue('')
                                  }
                                }}
                              >
                                <input
                                  className="w-full bg-transparent border-b border-[var(--oc-border)] focus:border-[var(--oc-primary-600)] outline-none"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={() => {
                                    setRenamingId(null)
                                    setRenameValue('')
                                  }}
                                  aria-label="Rename file"
                                  autoFocus
                                />
                              </form>
                            ) : (
                              <span className="truncate">{f.name}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                            <button
                              className="p-1 rounded hover:bg-[var(--oc-surface-2)]"
                              aria-label="Rename"
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenamingId(f.id)
                                setRenameValue(f.name)
                              }}
                              title="Rename (inline)"
                            >
                              <Icon name="pencil" />
                            </button>
                            <button
                              className="p-1 rounded hover:bg-[var(--oc-surface-2)]"
                              aria-label="Delete"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDeleteFile(f.id)
                              }}
                              title="Delete (confirm)"
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            <div className="w-5 h-full" />
          </div>
        )}

        <div id="oc-workspace" className="absolute inset-0 flex">
          <motion.section
            id="editor-pane"
            className="h-full border-r border-[var(--oc-border)] flex flex-col"
            style={{ width: editorWidthStyle }}
            animate={workspaceW ? { width: editorBasisPx } : undefined}
            transition={{ duration: 0.28, ease: [0.22, 0.8, 0.36, 1] }}
          >
            <div className="h-11 shrink-0 px-3 border-b border-[var(--oc-border)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs md:text-sm">
                <nav aria-label="Breadcrumbs" className="flex items-center gap-1 text-[var(--oc-muted)]">
                  <span>workspace</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-[var(--oc-fg)] truncate">{activeFile?.name || 'main'}</span>
                </nav>
              </div>
              <div className="flex items-center gap-2">
                {!editorCompact && (
                  <span className="h-8 inline-flex items-center text-sm px-2 rounded bg-[var(--oc-surface-2)]">
                    Language: {languageLabel(effectiveLanguage)} {autoDetect ? '(auto)' : '(manual)'}
                  </span>
                )}
                <button
                  id="formatBtn"
                  onClick={onFormat}
                  className={`h-8 ${editorCompact ? 'w-8 px-0' : 'px-3'} text-sm rounded bg-[var(--oc-surface-2)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center gap-1`}
                  title="Format document"
                  aria-label="Format document"
                >
                  <Icon name="wand" />
                  {!editorCompact && <span>Format</span>}
                </button>
                <button
                  id="findBtn"
                  onClick={onFind}
                  className={`h-8 ${editorCompact ? 'w-8 px-0' : 'px-3'} text-sm rounded bg-[var(--oc-surface-2)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center gap-1`}
                  title="Find"
                  aria-label="Find in editor"
                >
                  <Icon name="search" />
                  {!editorCompact && <span>Find</span>}
                </button>
              </div>
            </div>

            <div ref={editorContainerRef} className="flex-1 min-h-0" aria-label="Code editor" />

            <div className="h-7 shrink-0 px-3 border-t border-[var(--oc-border)] text-[11px] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span id="cursorPos">Ln {cursorPos.line}, Col {cursorPos.column}</span>
              </div>
              <div className="flex items-center gap-3">
                <span id="modeIndicator">Mode: AI Insights</span>
                <span id="langIndicator">{languageLabel(effectiveLanguage)} {autoDetect ? '(auto)' : '(manual)'}</span>
                <span id="encoding">UTF-8</span>
                <span id="indent">Spaces: 4</span>
              </div>
            </div>
          </motion.section>

          <motion.div
            role="separator"
            aria-orientation="vertical"
            className="oc-splitter cursor-col-resize"
            style={{ width: outputCollapsed ? 0 : 6, opacity: outputCollapsed ? 0 : 1 }}
            onMouseDown={() => {
              isResizingRef.current = true
              document.body.style.userSelect = 'none'
              document.body.style.cursor = 'col-resize'
            }}
            title="Drag to resize"
            transition={{ duration: 0.2 }}
          />

          <AnimatePresence initial={false}>
            {!outputCollapsed && (
              <motion.section
                className="h-full flex flex-col"
                style={{ width: outputWidthStyle, willChange: 'width, transform, opacity' }}
                initial={{ opacity: 0, x: 12, width: 0 }}
                animate={workspaceW ? { opacity: 1, x: 0, width: outputBasisPx } : { opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12, width: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 0.8, 0.36, 1] }}
              >
                <div className="h-11 shrink-0 px-3 border-b border-[var(--oc-border)] flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-[var(--oc-surface-2)] border border-[var(--oc-border)]">
                        {languageBadgeText}
                      </span>
                      <span className="inline-flex items-center px-2 py-1 rounded bg-[var(--oc-surface-2)] border border-dashed border-[var(--oc-border)] text-[var(--oc-muted)]">
                        Focus: {lastFocusPath || focusPreview}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {insightResult && (
                      <button
                        onClick={clearInsights}
                        className="oc-icon-btn"
                        aria-label="Clear insights"
                        title="Clear insights"
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                    <button
                      onClick={generateInsights}
                      disabled={insightBusy}
                      className={`oc-btn-cta h-9 px-5 rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center gap-2 ${insightBusy ? 'opacity-70 cursor-wait' : ''}`}
                      aria-label="Generate AI Insights"
                      title="Generate AI Insights (Ctrl/Cmd + Enter)"
                    >
                      {insightBusy && (
                        <span className="size-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" aria-hidden="true" />
                      )}
                      <span className="font-semibold tracking-wide text-sm">Generate AI Insights</span>
                    </button>
                    <button
                      data-testid="tid-collapse-output"
                      className="oc-icon-btn"
                      aria-label="Collapse panel"
                      title="Collapse panel"
                      onClick={toggleOutputCollapsed}
                    >
                      <Icon name="chevron-right" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
                  {insightError && (
                    <div className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-200 flex items-center gap-2">
                      <Icon name="x" className="size-4" />
                      <span>{insightError}</span>
                    </div>
                  )}

                  {insightResult ? (
                    <div className="flex-1 min-h-0 overflow-auto space-y-3">
                      <InsightCard
                        title="What it does"
                        icon="wand"
                        accent="hero"
                        badge={
                          <span className="text-[11px] uppercase tracking-wide text-[var(--oc-muted)]">
                            Language: {insightLanguage}
                          </span>
                        }
                      >
                        {insightResult.what_it_does?.trim() || 'Gemini did not return a summary.'}
                      </InsightCard>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <InsightCard title="Key behaviors" icon="node-function">
                          <InsightList items={asList(insightResult.key_behaviors)} empty="No key behaviors identified" />
                        </InsightCard>
                        <InsightCard title="Complexity" icon="settings">
                          <div className="space-y-1 text-sm">
                            <div className="text-[var(--oc-muted)]">Estimated Complexity</div>
                            <div className="text-base font-semibold">{insightResult?.complexity?.estimate || 'Unknown'}</div>
                            <div className="text-[var(--oc-muted)]">
                              {insightResult?.complexity?.rationale || 'LLM did not provide rationale.'}
                            </div>
                          </div>
                        </InsightCard>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <InsightCard title="Obvious bugs" icon="node-return" accent="alert">
                          <InsightList items={asList(insightResult.obvious_bugs)} empty="No obvious bugs detected" />
                        </InsightCard>
                        <InsightCard title="Possible bugs" icon="node-switch" accent="warning">
                          <InsightList items={asList(insightResult.possible_bugs)} empty="No potential issues mentioned" />
                        </InsightCard>
                      </div>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <InsightCard title="Fix ideas" icon="node-method">
                          <InsightList items={asList(insightResult.fixes)} empty="No fixes suggested" />
                        </InsightCard>
                        <InsightCard title="Risk profile" icon="node-try">
                          <InsightList items={asList(insightResult.risks)} empty="No risks highlighted" />
                        </InsightCard>
                      </div>

                      <InsightCard title="Test ideas" icon="search">
                        <InsightList items={asList(insightResult.test_ideas)} empty="No tests proposed" />
                      </InsightCard>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <div className="h-full min-h-[220px] w-full rounded-xl border border-dashed border-[var(--oc-border)] bg-gradient-to-br from-[var(--oc-primary-900)]/30 via-transparent to-[var(--oc-surface-2)] flex flex-col items-center justify-center text-center px-6 py-8 gap-3">
                        <div className="text-lg font-semibold">AI Insights</div>
                        <p className="text-sm text-[var(--oc-muted)] max-w-md">
                          Keep coding on the left. When you want a summary, risk sweep, or quick QA plan, hit "Generate AI Insights" and Gemini will analyze every open file with language detection, focus on <span className="font-semibold text-[var(--oc-fg)]">{focusPreview}</span>, and stream back a color-coded dossier.
                        </p>
                        <div className="text-xs text-[var(--oc-muted)]">
                          Tip: Use Ctrl/Cmd + Enter to trigger insights without leaving the editor.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {outputCollapsed && (
            <button
              data-testid="tid-collapse-output"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 oc-icon-btn rounded-l-lg"
              aria-label="Expand panel"
              onClick={toggleOutputCollapsed}
              title="Expand panel"
            >
              <Icon name="chevron-left" />
            </button>
          )}
        </div>
      </div>

      {settingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false)
          }}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            ref={settingsTrapRef}
            className="relative z-10 w-[92vw] max-w-md rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 shadow-2xl outline-none"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Settings</h3>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
                aria-label="Close settings"
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Theme</div>
                    <div className="text-xs text-[var(--oc-muted)]">Applies to the entire UI and the editor</div>
                  </div>
                </div>
                <fieldset className="grid grid-cols-1 gap-2" aria-label="Theme">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="oc-theme"
                      checked={theme === 'vscode-dark-plus'}
                      onChange={() => setTheme('vscode-dark-plus')}
                      aria-label="VS Code Dark+ theme"
                    />
                    <span>VS Code Dark+</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="oc-theme"
                      checked={theme === 'vscode-light-plus'}
                      onChange={() => setTheme('vscode-light-plus')}
                      aria-label="VS Code Light+ theme"
                    />
                    <span>VS Code Light+</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="oc-theme"
                      checked={theme === 'vscode-high-contrast'}
                      onChange={() => setTheme('vscode-high-contrast')}
                      aria-label="High Contrast theme"
                    />
                    <span>High Contrast</span>
                  </label>
                </fieldset>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Font Size</div>
                  <div className="text-xs text-[var(--oc-muted)]">{fontSize}px</div>
                </div>
                <input
                  type="range"
                  min={12}
                  max={20}
                  step={1}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  aria-label="Editor font size"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Language detection</div>
                    <div className="text-xs text-[var(--oc-muted)]">Auto-detect enabled by default</div>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDetect}
                      onChange={(e) => setAutoDetect(e.target.checked)}
                      aria-label="Toggle language auto-detect"
                    />
                    <span>{autoDetect ? 'Auto' : 'Manual'}</span>
                  </label>
                </div>
                {!autoDetect && (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">Manual language</div>
                      <div className="text-xs text-[var(--oc-muted)]">Choose when auto is off</div>
                    </div>
                    <ManualLanguagePicker value={manualLanguage} onChange={(id) => setManualLanguage(activeFileId, id)} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {quickOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setQuickOpen(false)
          }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            ref={quickTrapRef}
            className="relative z-10 w-[92vw] max-w-lg rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface)] p-3 shadow-2xl outline-none"
          >
            <input
              autoFocus
              placeholder="Type a file name…"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              className="oc-input"
              aria-label="Quick open query"
            />
            <ul className="mt-2 max-h-64 overflow-auto">
              {quickList.map((f) => (
                <li key={f.id}>
                  <button
                    className="w-full text-left px-3 py-2 rounded hover:bg-[var(--oc-surface-2)]"
                    onClick={() => chooseQuick(f.id)}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
              {quickList.length === 0 && (
                <li className="px-3 py-2 text-sm text-[var(--oc-muted)]">No matches</li>
              )}
            </ul>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showToast && (
          <motion.div
            className="oc-toast fixed bottom-3 right-3 z-50 px-3 py-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            {showToast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InsightCard({ title, icon, accent = 'default', badge, children }) {
  const accentStyles = {
    default: 'bg-[var(--oc-surface-2)] border-[var(--oc-border)]',
    hero: 'bg-gradient-to-br from-[var(--oc-primary-800)]/40 via-[var(--oc-primary-600)]/20 to-transparent border-transparent shadow-lg shadow-[var(--oc-primary-900)]/30',
    alert: 'bg-red-500/5 border-red-500/30',
    warning: 'bg-amber-500/5 border-amber-500/30',
  }
  const cls = accentStyles[accent] || accentStyles.default
  return (
    <div className={`rounded-xl border px-3 py-3 space-y-2 ${cls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--oc-fg)]">
          <Icon name={icon} className="size-4" />
          <span>{title}</span>
        </div>
        {badge}
      </div>
      <div className="text-sm text-[var(--oc-muted)] leading-relaxed whitespace-pre-wrap">
        {children}
      </div>
    </div>
  )
}

function InsightList({ items, empty }) {
  if (!items.length) {
    return <p className="text-sm text-[var(--oc-muted)]">{empty}</p>
  }
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`} className="flex items-start gap-2">
          <span className="mt-1 size-1.5 rounded-full bg-[var(--oc-primary-500)]" aria-hidden="true" />
          <span className="text-[var(--oc-fg)]">{item}</span>
        </li>
      ))}
    </ul>
  )
}
