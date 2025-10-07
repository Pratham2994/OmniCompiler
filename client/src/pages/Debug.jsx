import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLanguage } from '../context/LanguageContext.jsx'
import { Icon, ManualLanguagePicker } from '../components/run/ui.jsx'
import { Link } from 'react-router-dom'

const nowTime = () => {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const stripExtension = (name) => {
  const idx = name.lastIndexOf('.')
  if (idx > 0) return name.slice(0, idx)
  return name
}

const languageLabel = (id) => {
  switch ((id || '').toLowerCase()) {
    case 'python': return 'Python'
    case 'javascript': return 'JavaScript'
    case 'java': return 'Java'
    case 'cpp': return 'C++'
    case 'go': return 'Go'
    case 'plaintext': return 'Plain Text'
    default: return 'Plain Text'
  }
}

const defaultFiles = [
  { id: 'f1', name: 'main', language: 'plaintext', content: 'Hello!' },
]

// Ephemeral autosave (10 minutes TTL) — same snapshot as Run
const LS_KEY = 'oc_files_snapshot_v1'
const LS_TTL_MS = 10 * 60 * 1000

// Read a fresh snapshot synchronously (used by lazy initial state)
const readFreshSnapshot = () => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.files) || typeof data.ts !== 'number') return null
    if ((Date.now() - data.ts) > LS_TTL_MS) return null
    const files = data.files.slice(0, 5).map((f, idx) => {
      const id = String(f?.id || `f_restored_${idx}_${Math.random().toString(36).slice(2,8)}`)
      return { id, name: String(f?.name || `file_${idx+1}`), language: 'plaintext', content: String(f?.content || '') }
    })
    const activeId = (data.activeId && files.find(x => x.id === data.activeId)) ? data.activeId : (files[0]?.id || null)
    return { files, activeId }
  } catch {
    return null
  }
}

// Simple focus trap used in modals/drawers
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

// Local storage key for breakpoints
const BP_LS_KEY = 'oc_debug_breakpoints_v1'

export default function Debug() {
  // Theme (local) — identical to Run
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
    conf.rootClass.forEach(c => root.classList.add(c))
    localStorage.setItem('oc_theme', theme)
  }, [theme])

  // Language context
  const {
    autoDetect,
    setAutoDetect,
    // per-file getters
    getManualLanguage,
    getEffectiveLanguage,
    // per-file setters
    setManualLanguage,
    // per-file polling
    startPollingForFile,
    stopPollingForFile,
    // helpers
    detectLanguageOnce,
    buildRunPayload, // kept for parity, not used yet
    apiBase,
  } = useLanguage()

  // Files State (hydrate synchronously from localStorage if fresh)
  const [files, setFiles] = useState(() => {
    const snap = readFreshSnapshot()
    return snap?.files || defaultFiles
  })
  const [activeFileId, setActiveFileId] = useState(() => {
    const snap = readFreshSnapshot()
    return snap?.activeId || (snap?.files?.[0]?.id) || 'f1'
  })
  const activeFile = useMemo(() => files.find(f => f.id === activeFileId) || files[0], [files, activeFileId])

  // Hydration gate to avoid overwriting snapshot on first mount
  const [hydrated, setHydrated] = useState(false)

  // Ephemeral autosave support
  const saveTimerRef = useRef(null)

  // Mark hydrated and clean expired snapshot
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

  // Debounced snapshot saver (files + active)
  useEffect(() => {
    if (!hydrated) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveTimerRef.current = setTimeout(() => {
      try {
        const filesToSave = (files || []).map(f => {
          let content = f.content
          try {
            const m = modelsRef.current?.get(f.id)
            if (m && typeof m.getValue === 'function') content = String(m.getValue() ?? f.content ?? '')
          } catch {}
          return { id: f.id, name: f.name, content }
        }).slice(0, 5)
        const payload = { ts: Date.now(), activeId: activeFileId, files: filesToSave }
        localStorage.setItem(LS_KEY, JSON.stringify(payload))
      } catch {}
    }, 400)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [files, activeFileId, hydrated])

  // Flush snapshot on tab hide/close
  useEffect(() => {
    if (!hydrated) return

    const flush = () => {
      try {
        const filesToSave = (files || []).map(f => {
          let content = f.content
          try {
            const m = modelsRef.current?.get(f.id)
            if (m && typeof m.getValue === 'function') content = String(m.getValue() ?? f.content ?? '')
          } catch {}
          return { id: f.id, name: f.name, content }
        }).slice(0, 5)
        const payload = { ts: Date.now(), activeId: activeFileId, files: filesToSave }
        localStorage.setItem(LS_KEY, JSON.stringify(payload))
      } catch {}
    }
    const visHandler = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', visHandler)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', visHandler)
    }
  }, [files, activeFileId, hydrated])

  // Per-file language views
  const manualLanguage = getManualLanguage(activeFileId)
  const effectiveLanguage = getEffectiveLanguage(activeFileId)

  // Drawer
  const [leftMounted, setLeftMounted] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [leftTab] = useState('files') // 'files' | 'deps' (deps tab remains placeholder)
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

  // Output / Split
  const [outputCollapsed, setOutputCollapsed] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.65) // editor width ratio (default 65/35)
  const isResizingRef = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current) return
      const bodyRect = document.getElementById('oc-workspace')?.getBoundingClientRect()
      if (!bodyRect) return
      const x = e.clientX - bodyRect.left
      const ratio = clamp(x / bodyRect.width, 0.4, 0.7) // min editor 40%, min panel 30%
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

  // Track workspace width for smooth width animations
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

  // Editor (Monaco via CDN loader) — identical bootstrap as Run
  const editorContainerRef = useRef(null)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const modelsRef = useRef(new Map())
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

  // Create editor once
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
          const value = m.getValue()
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, content: value } : f))
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

    // initial model
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

  // Update theme in Monaco when theme changes
  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    const conf = THEME_MAP[theme] || THEME_MAP['vscode-dark-plus']
    monaco.editor.setTheme(conf.monaco)
  }, [theme])

  // Update language in Monaco when the effective language changes
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const model = editor.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
  }, [effectiveLanguage])

  // Change model on activeFile change
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor || !activeFile) return

    let model = modelsRef.current.get(activeFile.id)
    if (!model) {
      model = monaco.editor.createModel(activeFile.content, 'plaintext')
      modelsRef.current.set(activeFile.id, model)
      model.onDidChangeContent(() => {
        const value = model.getValue()
        setFiles(prev => prev.map(f => f.id === activeFile.id ? { ...f, content: value } : f))
      })
    }
    editor.setModel(model)
    monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
    const pos = editor.getPosition()
    if (pos) setCursorPos({ line: pos.lineNumber, column: pos.column })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, files.length])

  // Settings Modal state
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

  // Left Drawer - Files handlers (identical to Run)
  const [showToast, setShowToast] = useState(null)
  const triggerToast = (msg) => {
    setShowToast(msg)
    setTimeout(() => setShowToast(null), 1500)
  }

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
    if (files.some(f => f.name === clean)) {
      triggerToast('Duplicate name not allowed')
      return
    }
    const defLangId = 'plaintext'
    const content = ''
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: defLangId, content }
    setFiles(prev => [...prev, newFile])
    setActiveFileId(id)
  }

  const uploadHiddenRef = useRef(null)
  const onOpen = () => {
    uploadHiddenRef.current?.click()
  }
  const onOpenSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const clean = stripExtension(file.name)
    if (!clean) return
    if (files.length >= 5) {
      triggerToast('Max 5 files allowed')
      return
    }
    if (files.some(f => f.name === clean)) {
      triggerToast('Duplicate name not allowed')
      return
    }
    const defLangId = 'plaintext'
    const content = ''
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: defLangId, content }
    setFiles(prev => [...prev, newFile])
    setActiveFileId(id)
    triggerToast(`Opened "${file.name}" (name shown without extension)`)
    e.target.value = ''
  }
  const onSave = () => {
    triggerToast('Saved locally (stub)')
  }

  const addFileInDrawer = () => onNewFile()
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
    if (files.some(f => f.name === clean)) {
      triggerToast('Duplicate name not allowed')
      return
    }
    const defLangId = 'plaintext'
    const content = ''
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: defLangId, content }
    setFiles(prev => [...prev, newFile])
    setActiveFileId(id)
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
    if (files.some(f => f.name === clean && f.id !== id)) {
      triggerToast('Duplicate name not allowed')
      return false
    }
    setFiles(prev => prev.map(f => f.id === id ? { ...f, name: clean } : f))
    return true
  }
  const onDeleteFile = (id) => {
    if (files.length <= 1) {
      triggerToast('At least one file must remain')
      return
    }
    if (!confirm('Delete this file?')) return
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id)
      if (id === activeFileId && next.length) setActiveFileId(next[0].id)
      return next
    })
  }

  // Debug-specific state (UI stub)
  const [debugTab, setDebugTab] = useState('bpvars') // 'bpvars' | 'tree'
  const [breakpoints, setBreakpoints] = useState(() => {
    try {
      const raw = localStorage.getItem(BP_LS_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.slice(0, 128) : []
    } catch { return [] }
  })

  useEffect(() => {
    try {
      localStorage.setItem(BP_LS_KEY, JSON.stringify(breakpoints))
    } catch {}
  }, [breakpoints])

  const addBreakpointAtCursor = () => {
    if (!activeFileId || !activeFile) return
    const line = Math.max(1, Number(cursorPos?.line || 1))
    const id = `${activeFileId}:${line}`
    setBreakpoints(prev => {
      if (prev.some(b => b.id === id)) return prev
      const item = { id, fileId: activeFileId, fileName: activeFile.name, line, condition: '' }
      return [...prev, item].slice(0, 128)
    })
  }
  const removeBreakpoint = (bpId) => {
    setBreakpoints(prev => prev.filter(b => b.id !== bpId))
  }
  const clearBreakpoints = () => setBreakpoints([])

  // Keyboard Shortcuts (no Run binding here)
  const [quickOpen, setQuickOpen] = useState(false)
  const quickTrapRef = useFocusTrap(quickOpen)
  const [quickQuery, setQuickQuery] = useState('')
  const quickList = files.filter(f => f.name.toLowerCase().includes(quickQuery.toLowerCase()))
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

  useEffect(() => {
    const onKey = (e) => {
      // Ctrl/Cmd+P: Quick file switcher (modal)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p')) {
        e.preventDefault()
        setQuickOpen(true)
      }
      // Ctrl/Cmd+F: Find in editor
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f')) {
        const ed = editorRef.current
        if (ed) {
          e.preventDefault()
          ed.getAction('actions.find')?.run()
        }
      }
      // F9: Toggle/add breakpoint at cursor
      if (e.key === 'F9') {
        e.preventDefault()
        addBreakpointAtCursor()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cursorPos, activeFileId, activeFile])

  // Editor actions
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
    } catch { /* ignore and fallback */ }
    const model = ed.getModel()
    if (!model) return
    const original = model.getValue()
    const normalized = original
      .split('\n')
      .map(line => line.replace(/\s+$/g, '').replace(/\t/g, '    '))
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

  // Responsive: collapse panel toggle
  const toggleOutputCollapsed = () => setOutputCollapsed(v => !v)

  // Derived widths (px) for smooth animation
  const editorBasisPx = Math.max(0, Math.round((outputCollapsed ? 1 : splitRatio) * workspaceW))
  const outputBasisPx = Math.max(0, Math.round((outputCollapsed ? 0 : (1 - splitRatio)) * workspaceW))
  const editorWidthStyle = workspaceW ? editorBasisPx : (outputCollapsed ? '100%' : `${Math.round(splitRatio * 100)}%`)
  const outputWidthStyle = workspaceW ? outputBasisPx : (outputCollapsed ? '0%' : `${Math.round((1 - splitRatio) * 100)}%`)
  const editorCompact = !outputCollapsed && splitRatio < 0.28

  // Start/stop auto-detect polling for ACTIVE FILE ONLY
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFileId) return
    if (autoDetect) {
      startPollingForFile(activeFileId, () => editor.getModel()?.getValue() || '', 2000)
    } else {
      stopPollingForFile(activeFileId)
    }
    return () => {
      stopPollingForFile(activeFileId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetect, monacoReady, activeFileId])

  // Build a live code tree from the active file content
  function jumpToLine(ln) {
    try {
      const ed = editorRef.current
      if (!ed) return
      const lineNumber = Math.max(1, Number(ln || 1))
      ed.revealLineInCenter(lineNumber)
      ed.setPosition({ lineNumber, column: 1 })
      ed.focus()
    } catch {}
  }

  function parseCodeTree(lang, code) {
    const l = String(lang || '').toLowerCase()
    const src = String(code || '')
    switch (l) {
      case 'python': return parsePythonTree(src)
      case 'javascript': return parseJsTree(src)
      case 'java': return parseJavaTree(src)
      case 'go': return parseGoTree(src)
      case 'cpp': return parseCppTree(src)
      default: return []
    }
  }

  function parsePythonTree(code = '') {
    const lines = String(code || '').replace(/\t/g, '    ').split(/\r?\n/)
    const roots = []
    const stack = [] // {indent, node}
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const m = raw.match(/^(\s*)(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/)
      if (!m) continue
      const indent = m[1].length
      const kind = m[2] === 'def' ? 'function' : 'class'
      const name = m[3]
      const node = { type: kind, name, line: i + 1, children: [] }
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      if (stack.length) {
        stack[stack.length - 1].node.children.push(node)
      } else {
        roots.push(node)
      }
      stack.push({ indent, node })
    }
    return roots
  }

  function parseJsTree(code = '') {
    const lines = String(code || '').split(/\r?\n/)
    const roots = []
    const classStack = [] // {name, node, depthAtOpen}
    let depth = 0
    const pushRoot = (n) => roots.push(n)

    const isLikelyMethod = (s) => /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(s) && !/^\s*(if|for|while|switch|catch)\b/.test(s)
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const open = (raw.match(/{/g) || []).length
      const close = (raw.match(/}/g) || []).length

      // class
      const cm = raw.match(/^\s*class\s+([A-Za-z_$][\w$]*)/)
      if (cm) {
        const node = { type: 'class', name: cm[1], line: i + 1, children: [] }
        pushRoot(node)
        classStack.push({ name: cm[1], node, depthAtOpen: depth + open - close })
      }

      // function decl
      const fm = raw.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
      if (fm) {
        pushRoot({ type: 'function', name: fm[1], line: i + 1, children: [] })
      }

      // const fn = (...) => ...
      const am = raw.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(.*\)\s*=>/)
      if (am) {
        pushRoot({ type: 'function', name: am[1], line: i + 1, children: [] })
      }

      // methods inside current class
      if (classStack.length && isLikelyMethod(raw)) {
        const mm = raw.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)
        if (mm) {
          classStack[classStack.length - 1].node.children.push({
            type: 'method',
            name: mm[1],
            line: i + 1,
            children: []
          })
        }
      }

      depth += open - close
      // pop class when depth drops below its open depth
      while (classStack.length && depth < classStack[classStack.length - 1].depthAtOpen) {
        classStack.pop()
      }
    }
    return roots
  }

  function parseJavaTree(code = '') {
    const lines = String(code || '').split(/\r?\n/)
    const roots = []
    const classStack = [] // {node, depthAtOpen}
    let depth = 0

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const open = (raw.match(/{/g) || []).length
      const close = (raw.match(/}/g) || []).length

      const cls = raw.match(/^\s*(?:public|private|protected)?\s*(?:final|abstract)?\s*(class|interface|enum)\s+([A-Za-z_][\w]*)/)
      if (cls) {
        const node = { type: cls[1], name: cls[2], line: i + 1, children: [] }
        roots.push(node)
        classStack.push({ node, depthAtOpen: depth + open - close })
      }

      const meth = raw.match(/^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\],\s]+\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/)
      if (meth) {
        if (classStack.length) {
          classStack[classStack.length - 1].node.children.push({ type: 'method', name: meth[1], line: i + 1, children: [] })
        } else {
          roots.push({ type: 'function', name: meth[1], line: i + 1, children: [] })
        }
      }

      depth += open - close
      while (classStack.length && depth < classStack[classStack.length - 1].depthAtOpen) classStack.pop()
    }
    return roots
  }

  function parseGoTree(code = '') {
    const lines = String(code || '').split(/\r?\n/)
    const roots = []
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const pkg = raw.match(/^\s*package\s+([A-Za-z_][\w]*)/)
      if (pkg) roots.push({ type: 'package', name: pkg[1], line: i + 1, children: [] })
      const typ = raw.match(/^\s*type\s+([A-Za-z_][\w]*)\s+(struct|interface)\b/)
      if (typ) roots.push({ type: typ[2], name: typ[1], line: i + 1, children: [] })
      const recv = raw.match(/^\s*func\s*\(\s*[^)]+\)\s*([A-Za-z_][\w]*)\s*\(/)
      if (recv) roots.push({ type: 'method', name: recv[1], line: i + 1, children: [] })
      const fn = raw.match(/^\s*func\s+([A-Za-z_][\w]*)\s*\(/)
      if (fn) roots.push({ type: 'function', name: fn[1], line: i + 1, children: [] })
    }
    return roots
  }

  function parseCppTree(code = '') {
    const lines = String(code || '').split(/\r?\n/)
    const roots = []
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const cls = raw.match(/^\s*(class|struct)\s+([A-Za-z_][\w]*)\b/)
      if (cls) roots.push({ type: cls[1], name: cls[2], line: i + 1, children: [] })
      if (/^\s*(if|for|while|switch|catch)\b/.test(raw)) continue
      const fn = raw.match(/^\s*(?:template\s*<[^>]+>\s*)?[\w:\<\>\*&\s]+?\s+([~]?[A-Za-z_][\w:]*)\s*\([^;]*\)\s*\{/)
      if (fn) roots.push({ type: 'function', name: fn[1], line: i + 1, children: [] })
    }
    return roots
  }

  function getActiveCode() {
    try {
      const ed = editorRef.current
      const model = ed?.getModel?.()
      if (model) return String(model.getValue() || '')
    } catch {}
    return String(activeFile?.content || '')
  }

  function renderTree(nodes, depth = 0) {
    return (nodes || []).map((n, idx) => (
      <li key={`${n.name}:${n.line}:${depth}:${idx}`} className="px-2 py-1 rounded hover:bg-[var(--oc-surface)]">
        <button className="w-full text-left flex items-center justify-between" onClick={() => jumpToLine(n.line)}>
          <span className="truncate flex items-center gap-2">
            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-[var(--oc-surface)] border border-[var(--oc-border)] uppercase tracking-wide">
              {n.type}
            </span>
            <span className="font-medium">{n.name}</span>
          </span>
          <span className="opacity-70 text-xs">:{n.line}</span>
        </button>
        {n.children && n.children.length > 0 ? (
          <ul className="ml-4 mt-1 border-l border-[var(--oc-border)] pl-2 space-y-1">
            {renderTree(n.children, depth + 1)}
          </ul>
        ) : null}
      </li>
    ))
  }

  const codeTree = useMemo(() => {
    const lang = effectiveLanguage || 'plaintext'
    if (lang === 'plaintext') return []
    const src = getActiveCode()
    return parseCodeTree(lang, src)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, effectiveLanguage, files])

  return (
    <div className="h-screen w-screen">
      <a
        href="#editor-pane"
        className="sr-only focus:not-sr-only absolute top-1 left-1 z-50 bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
      >
        Skip to editor
      </a>

      {/* Header */}
      <header className="h-14 border-b border-[var(--oc-border)] flex items-center justify-between px-3 gap-3">
        {/* Left slot */}
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
              className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)]"
            >
              Debug
            </Link>
          </nav>
        </div>

        {/* Right slot */}
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

      {/* Body */}
      <div className="relative h-[calc(100vh-56px)] w-full overflow-hidden">
        {/* Left drawer trigger */}
        <button
          data-testid="tid-left-drawer-trigger"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 oc-icon-btn rounded-r-lg"
          aria-label="Files & Deps"
          onClick={openDrawer}
          title="Files & Deps"
        >
          <Icon name="chevron-right" />
        </button>

        {/* Left overlay drawer */}
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
                          onClick={addFileInDrawer}
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
                ) : (
                  <div className="space-y-3">
                    <div className="text-sm text-[var(--oc-muted)]">
                      Static placeholder — Non-functional for now. Renders a simple list with add/remove disabled and a tooltip "Coming soon".
                    </div>
                    <ul className="text-sm list-disc pl-5 space-y-1">
                      <li>python: requests</li>
                      <li>node: lodash</li>
                      <li>java: junit</li>
                    </ul>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 rounded bg-[var(--oc-surface-2)] cursor-not-allowed" title="Coming soon" aria-disabled="true">Add</button>
                      <button className="px-3 py-1.5 rounded bg-[var(--oc-surface-2)] cursor-not-allowed" title="Coming soon" aria-disabled="true">Remove</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* 20px gutter visible over editor */}
            <div className="w-5 h-full" />
          </div>
        )}

        {/* Workspace split */}
        <div id="oc-workspace" className="absolute inset-0 flex">
          {/* Code pane */}
          <motion.section
            id="editor-pane"
            className="h-full border-r border-[var(--oc-border)] flex flex-col"
            style={{ width: editorWidthStyle }}
            animate={workspaceW ? { width: editorBasisPx } : undefined}
            transition={{ duration: 0.28, ease: [0.22, 0.8, 0.36, 1] }}
          >
            {/* Editor header / breadcrumbs / actions */}
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

            {/* Monaco Editor container */}
            <div ref={editorContainerRef} className="flex-1 min-h-0" aria-label="Code editor" />

            {/* Statusbar */}
            <div className="h-7 shrink-0 px-3 border-t border-[var(--oc-border)] text-[11px] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span id="cursorPos">Ln {cursorPos.line}, Col {cursorPos.column}</span>
              </div>
              <div className="flex items-center gap-3">
                <span id="modeIndicator">Mode: Debug</span>
                <span id="langIndicator">{languageLabel(effectiveLanguage)} {autoDetect ? '(auto)' : '(manual)'}</span>
                <span id="encoding">UTF-8</span>
                <span id="indent">Spaces: 4</span>
              </div>
            </div>
          </motion.section>

          {/* Splitter */}
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

          {/* Debug Pane */}
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
                {/* Header */}
                <div className="h-11 shrink-0 px-3 border-b border-[var(--oc-border)] flex items-center justify-between">
                  {/* Tabs (left) */}
                  <div role="tablist" aria-label="Debug tabs" className="flex items-center gap-1">
                    <button
                      role="tab"
                      aria-selected={debugTab === 'bpvars'}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${debugTab === 'bpvars' ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] shadow-inner ring-1 ring-[var(--oc-border)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-2)]'}`}
                      onClick={() => setDebugTab('bpvars')}
                    >
                      Breakpoints / Variables
                    </button>
                    <button
                      role="tab"
                      aria-selected={debugTab === 'tree'}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${debugTab === 'tree' ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] shadow-inner ring-1 ring-[var(--oc-border)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-2)]'}`}
                      onClick={() => setDebugTab('tree')}
                    >
                      Tree
                    </button>
                  </div>

                  {/* Actions (right) */}
                  <div className="flex items-center gap-1.5">
                    <button
                      data-testid="tid-add-bp"
                      onClick={addBreakpointAtCursor}
                      className="oc-btn-cta h-9 w-9 rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center"
                      aria-label="Add breakpoint at cursor (F9)"
                      title="Add breakpoint at cursor (F9)"
                    >
                      <Icon name="plus" />
                      <span className="sr-only">Add Breakpoint</span>
                    </button>

                    <button
                      onClick={clearBreakpoints}
                      className="oc-icon-btn"
                      aria-label="Clear all breakpoints"
                      title="Clear all breakpoints"
                    >
                      <Icon name="trash" />
                    </button>

                    <button
                      data-testid="tid-collapse-output"
                      className="oc-icon-btn"
                      aria-label="Collapse Panel"
                      title="Collapse Panel"
                      onClick={toggleOutputCollapsed}
                    >
                      <Icon name="chevron-right" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 p-3 flex flex-col">
                  {debugTab === 'bpvars' && (
                    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {/* Breakpoints */}
                      <div className="flex flex-col min-h-0 bg-[var(--oc-surface-2)] rounded p-2" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Breakpoints</div>
                          <div className="flex items-center gap-2">
                            <button className="oc-btn" onClick={addBreakpointAtCursor} aria-label="Add breakpoint at cursor">
                              <Icon name="plus" /> <span className="ml-1">Add</span>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-auto">
                          {breakpoints.length === 0 ? (
                            <div className="text-[var(--oc-muted)]">No breakpoints. Use F9 or the Add button to create one at the current cursor.</div>
                          ) : (
                            <ul className="space-y-1">
                              {breakpoints.map(bp => (
                                <li key={bp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-[var(--oc-surface)]">
                                  <div className="min-w-0 truncate">
                                    <span className="font-medium">{bp.fileName}</span>
                                    <span className="opacity-70"> :{bp.line}</span>
                                    {bp.condition ? <span className="ml-2 text-[var(--oc-muted)]">if {bp.condition}</span> : null}
                                  </div>
                                  <button
                                    className="oc-icon-btn"
                                    onClick={() => removeBreakpoint(bp.id)}
                                    aria-label={`Remove breakpoint at ${bp.fileName}:${bp.line}`}
                                    title="Remove"
                                  >
                                    <Icon name="trash" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      {/* Variables */}
                      <div className="flex flex-col min-h-0 bg-[var(--oc-surface-2)] rounded p-2" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Variables</div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-auto">
                          <div className="text-[var(--oc-muted)]">
                            No active debug session. Variables will appear here when you start debugging.
                          </div>
                          <ul className="mt-2 font-mono text-xs space-y-1">
                            <li>// locals: —</li>
                            <li>// globals: —</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {debugTab === 'tree' && (
                    <div className="flex-1 min-h-0 bg-[var(--oc-surface-2)] rounded p-2 text-sm" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
                      <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)] mb-2">Code Tree</div>
                      {effectiveLanguage === 'plaintext' ? (
                        <div className="text-[var(--oc-muted)]">Select a programming language to enable the code tree.</div>
                      ) : (
                        <>
                          {codeTree.length === 0 ? (
                            <div className="text-[var(--oc-muted)]">No symbols detected. The tree updates live as you type.</div>
                          ) : (
                            <ul className="space-y-1">
                              {renderTree(codeTree)}
                            </ul>
                          )}
                        </>
                      )}
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
              aria-label="Expand Panel"
              onClick={toggleOutputCollapsed}
              title="Expand Panel"
            >
              <Icon name="chevron-left" />
            </button>
          )}
        </div>
      </div>

      {/* Settings Modal */}
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

      {/* Quick Open (Ctrl/Cmd+P) */}
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

      {/* Toast */}
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