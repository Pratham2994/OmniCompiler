import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext.jsx'
import { Icon, ManualLanguagePicker } from '../components/run/ui.jsx'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const stripExtension = (name) => {
  const idx = name.lastIndexOf('.')
  if (idx > 0) return name.slice(0, idx)
  return name
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

const TARGET_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'java',
  'cpp',
  'go',
  'csharp',
  'rust',
  'kotlin',
  'swift',
  'assembly',
].map((id) => ({ id, label: languageLabel(id) }))

const defaultFiles = [
  { id: 'f1', name: 'Main', language: 'plaintext', content: 'Hello!' },
]

const normalizeNewlines = (text = '') => text.replace(/\r\n?/g, '\n')

const LS_KEY = 'oc_files_snapshot_v1'
const LS_TTL_MS = 10 * 60 * 1000

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

export default function Translate() {
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
  const [splitRatio, setSplitRatio] = useState(0.4)
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

  const [selectedTargets, setSelectedTargets] = useState(['python'])
  const [translations, setTranslations] = useState([])
  const [translating, setTranslating] = useState(false)
  const [translationStatus, setTranslationStatus] = useState('')
  const [lastTranslatedAt, setLastTranslatedAt] = useState(null)

  const toggleTarget = (id) => {
    setSelectedTargets((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }

  const clearTranslations = () => {
    setTranslations([])
    setLastTranslatedAt(null)
  }

  const copyTranslation = async (langId, code) => {
    try {
      await navigator.clipboard.writeText(code || '')
      triggerToast(`Copied ${languageLabel(langId)}`)
    } catch {
      triggerToast('Unable to copy text')
    }
  }

  const translateCode = useCallback(async () => {
    if (!activeFile) {
      triggerToast('Add or select a file to translate')
      return
    }
    const targets = Array.from(new Set(selectedTargets))
    if (!targets.length) {
      triggerToast('Select at least one target language')
      return
    }
    const effLang = getEffectiveLanguage(activeFileId) || 'plaintext'
    if (effLang === 'plaintext') {
      triggerToast('Pick a programming language for the source file')
      return
    }
    const editor = editorRef.current
    const model = editor?.getModel()
    let code = normalizeNewlines(activeFile.content || '')
    if (model) {
      code = normalizeNewlines(model.getValue() || '')
      const latest = code
      setFiles((prev) => prev.map((f) => (f.id === activeFileId ? { ...f, content: latest } : f)))
    }
    if (!code.trim()) {
      triggerToast('Source code is empty')
      return
    }
    setTranslating(true)
    setTranslationStatus(`Translating to ${targets.map((t) => languageLabel(t)).join(', ')}`)
    try {
      const res = await fetch(`${apiBase}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_code: code,
          source_language: effLang,
          target_languages: targets,
          options: {
            preserve_comments: true,
            preserve_structure: true,
          },
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const list = Array.isArray(data?.translations) ? data.translations : []
      setTranslations(list)
      setLastTranslatedAt(new Date())
      if (!list.length) triggerToast('Translation completed with no outputs')
    } catch (err) {
      console.error(err)
      triggerToast(`Translation failed: ${err?.message || 'Unknown error'}`)
    } finally {
      setTranslating(false)
      setTranslationStatus('')
    }
  }, [activeFile, activeFileId, apiBase, getEffectiveLanguage, selectedTargets, setFiles, triggerToast])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        translateCode()
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
  }, [translateCode])

  const onFormat = async () => {
    const ed = editorRef.current
    if (! ed) return
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
  }, [autoDetect, monacoReady, activeFileId])

  const sourceBadgeText = autoDetect
    ? `Detected: ${languageLabel(effectiveLanguage)} (auto)`
    : `Pinned: ${languageLabel(manualLanguage || effectiveLanguage)} (manual)`
  const statusSummary = translating
    ? translationStatus
    : (lastTranslatedAt ? `Last translated ${lastTranslatedAt.toLocaleTimeString()}` : 'Ready to translate')

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
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)]"
            >
              Translate
            </Link>
            <Link
              to="/insights"
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-surface-2)]"
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
                {leftTab === 'files' ? (
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
                        <li className="text-sm text-[var(--oc-muted)]">No files yet. Click + to add.</li>)
                      }
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
                ) : null}
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
                <span id="modeIndicator">Mode: Translate</span>
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
                <div className="h-11 shrink-0 px-3 border-b border-[var(--oc-border)] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center px-2 py-1 rounded bg-[var(--oc-surface-2)] border border-[var(--oc-border)]">
                      {sourceBadgeText}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={clearTranslations}
                      className="oc-icon-btn"
                      aria-label="Clear translations"
                      title="Clear translations"
                    >
                      <Icon name="trash" />
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

                <div className="flex-1 min-h-0 p-3 flex flex-col gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Target languages</div>
                      <div className="text-xs text-[var(--oc-muted)]">{selectedTargets.length} selected</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TARGET_LANGUAGES.map((lang) => {
                        const active = selectedTargets.includes(lang.id)
                        return (
                          <button
                            key={lang.id}
                            type="button"
                            aria-pressed={active ? 'true' : 'false'}
                            onClick={() => toggleTarget(lang.id)}
                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${active ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] border-[var(--oc-primary-500)] shadow-inner' : 'bg-[var(--oc-surface-2)] text-[var(--oc-muted)] border-[var(--oc-border)] hover:text-[var(--oc-fg)]'}`}
                          >
                            {lang.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-[var(--oc-muted)]">{statusSummary}</div>
                    <button
                      onClick={translateCode}
                      disabled={translating}
                      className={`oc-btn-cta h-11 px-6 rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center gap-2 ${translating ? 'opacity-70 cursor-wait' : ''}`}
                      aria-label="Translate code"
                      title="Translate (Ctrl/Cmd + Enter)"
                    >
                      {translating && (
                        <span className="size-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" aria-hidden="true" />
                      )}
                      <span className="font-semibold tracking-wide text-sm">Translate</span>
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-auto space-y-3">
                    {translations.length === 0 ? (
                      <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center text-sm text-[var(--oc-muted)] border border-dashed border-[var(--oc-border)] rounded">
                        <p>Select one or more target languages and click Translate to see results.</p>
                      </div>
                    ) : (
                      translations.map((t) => (
                        <div key={t.target_language} className="border border-[var(--oc-border)] rounded bg-[var(--oc-surface-2)] flex flex-col" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }}>
                          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--oc-border)]">
                            <div className="text-sm font-semibold">{languageLabel(t.target_language)}</div>
                            <button
                              className="oc-icon-btn"
                              aria-label={`Copy ${languageLabel(t.target_language)} translation`}
                              onClick={() => copyTranslation(t.target_language, t.code)}
                            >
                              <Icon name="copy" />
                            </button>
                          </div>
                          <pre className="m-0 p-3 font-mono text-xs whitespace-pre-wrap oc-console overflow-auto">
                            {t.code || ''}
                          </pre>
                        </div>
                      ))
                    )}
                  </div>
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
