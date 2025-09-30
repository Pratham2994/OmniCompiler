import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * Omni Compiler — Run UI (First Page Only)
 * Front-end only; no backend wiring.
 * - Monaco Editor via CDN loader configured in index.html (window.monaco)
 * - TailwindCSS utility styling
 * - Accessible modals/drawers with focus trap
 * - Keyboard shortcuts
 * - Test IDs present
 */

// ---------- Utilities ----------
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


const monacoLangId = (display) => {
  switch (display) {
    case 'Python': return 'python'
    case 'JavaScript': return 'javascript'
    case 'Java': return 'java'
    case 'C++': return 'cpp'
    case 'Go': return 'go'
    default: return 'plaintext'
  }
}

// Display label from Monaco language id
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

const placeholderByLangId = {
  python: "# Write your code here\nprint('Hello Omni')\n",
  javascript: "console.log('Hello Omni')\n",
  java: 'class Main { public static void main(String[] args){ System.out.println("Hello Omni"); } }',
  cpp: '#include <bits/stdc++.h>\nusing namespace std; int main(){ cout<<"Hello Omni"; }',
  go: 'package main\nimport "fmt"\nfunc main(){ fmt.Println("Hello Omni") }\n',
}

const defaultFiles = [
  { id: 'f1', name: 'main', language: 'plaintext', content: 'hello!\n' },
]

// ---------- Icons (inline minimal lucide-like) ----------
function Icon({ name, className = 'size-4', strokeWidth = 2, label }) {
  const props = {
    width: '1em',
    height: '1em',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': label ? 'false' : 'true',
    role: 'img',
    'aria-label': label || undefined,
    className,
  }
  switch (name) {
    case 'panel-left-open':
      return (<svg {...props}><rect x="3" y="4" width="6" height="16" /><rect x="9" y="4" width="12" height="16" opacity=".2"/><path d="M7 8l-2 4 2 4" /></svg>)
    case 'panel-right-close':
      return (<svg {...props}><rect x="3" y="4" width="18" height="16" opacity=".2"/><rect x="15" y="4" width="6" height="16" /><path d="M17 8l2 4-2 4" /></svg>)
    case 'plus':
      return (<svg {...props}><path d="M12 5v14M5 12h14" /></svg>)
    case 'upload':
      return (<svg {...props}><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></svg>)
    case 'settings':
      return (<svg {...props}><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 008.6 15a1.65 1.65 0 00-1.82-.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06A2 2 0 017.04 4.29l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0015 8.6c.41 0 .8-.16 1.09-.46l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 15z" /></svg>)
    case 'search':
      return (<svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>)
    case 'wand':
      return (<svg {...props}><path d="M15 4V2M15 10v-2M19 6h2M11 6H9M17.5 8.5l1.5 1.5M12.5 3.5L11 2M3 21l9-9" /></svg>)
    case 'trash':
      return (<svg {...props}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>)
    case 'pencil':
      return (<svg {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>)
    case 'file':
      return (<svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>)
    case 'chevron-right':
      return (<svg {...props}><path d="M9 18l6-6-6-6" /></svg>)
    case 'chevron-left':
      return (<svg {...props}><path d="M15 18l-6-6 6-6" /></svg>)
    case 'x':
      return (<svg {...props}><path d="M18 6L6 18M6 6l12 12" /></svg>)
    case 'play':
      return (<svg {...props}><path d="M7 6v12l10-6-10-6z" /></svg>)
    default:
      return null
  }
}

// ---------- Focus Trap Hook ----------
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

// ---------- App ----------
function App() {
  // Theming
  const [theme, setTheme] = useState('dark') // 'light' | 'dark'
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  // Mode switch (Run/Debug — Debug visual only)
  const [mode, setMode] = useState('Run') // default Run
  const [showDebugTip, setShowDebugTip] = useState(false)
  const onToggleMode = () => {
    const next = mode === 'Run' ? 'Debug' : 'Run'
    setMode(next)
    if (next === 'Debug') {
      setShowDebugTip(true)
      setTimeout(() => setShowDebugTip(false), 2000)
    }
  }

  // Files State
  const [files, setFiles] = useState(defaultFiles)
  const [activeFileId, setActiveFileId] = useState('f1')
  const activeFile = useMemo(() => files.find(f => f.id === activeFileId) || files[0], [files, activeFileId])

  // Drawer
  const [leftMounted, setLeftMounted] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [leftTab, setLeftTab] = useState('files') // 'files' | 'deps'
  const leftTrapRef = useFocusTrap(leftOpen)

  const openDrawer = () => {
    if (leftMounted && leftOpen) return
    setLeftMounted(true)
    // let it mount then animate in
    requestAnimationFrame(() => setLeftOpen(true))
  }
  const closeDrawer = () => {
    setLeftOpen(false)
    // allow slide-out animation to finish
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
  const [splitRatio, setSplitRatio] = useState(0.5) // editor width ratio (default 50/50)
  const isResizingRef = useRef(false)

  // Settings Modal state (moved up so it's available for editor/monaco effects)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrapRef = useFocusTrap(settingsOpen)
  const [fontSize, setFontSize] = useState(14)
  const [autoDetect, setAutoDetect] = useState(true)
  const [autoLang, setAutoLang] = useState('')

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current) return
      const bodyRect = document.getElementById('oc-workspace')?.getBoundingClientRect()
      if (!bodyRect) return
      const x = e.clientX - bodyRect.left
      const ratio = clamp(x / bodyRect.width, 0.4, 0.7) // min editor 40%, min output 30%
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


  // Editor (Monaco via CDN loader)
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

  function langDisplay(file) {
    const id = (file?.language || '').toLowerCase()
    switch (id) {
      case 'python': return 'Python'
      case 'javascript': return 'JavaScript'
      case 'java': return 'Java'
      case 'cpp': return 'C++'
      case 'go': return 'Go'
      default: return 'Plain Text'
    }
  }

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
        m = monaco.editor.createModel(file.content, file.language || 'plaintext')
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
      language: activeFile?.language ?? 'plaintext',
      automaticLayout: true,
      minimap: { enabled: true },
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
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
      const currentLangId = autoDetect ? monacoLangId(langDisplay(activeFile)) : (autoLang || 'plaintext')
      monaco.editor.setModelLanguage(model, currentLangId)
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
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
  }, [theme])

  // Update language in Monaco when detection mode or manual language changes
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const model = editor.getModel()
    if (!model) return
    const langId = autoDetect ? monacoLangId(langDisplay(activeFile)) : (autoLang || 'plaintext')
    monaco.editor.setModelLanguage(model, langId)
  }, [autoDetect, autoLang])

  // Change model on activeFile change
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor || !activeFile) return

    let model = modelsRef.current.get(activeFile.id)
    if (!model) {
      model = monaco.editor.createModel(activeFile.content, activeFile.language || 'plaintext')
      modelsRef.current.set(activeFile.id, model)
      model.onDidChangeContent(() => {
        const value = model.getValue()
        setFiles(prev => prev.map(f => f.id === activeFile.id ? { ...f, content: value } : f))
      })
    }
    editor.setModel(model)
    const currentLangId = autoDetect ? monacoLangId(langDisplay(activeFile)) : (autoLang || 'plaintext')
    monaco.editor.setModelLanguage(model, currentLangId)
    const pos = editor.getPosition()
    if (pos) setCursorPos({ line: pos.lineNumber, column: pos.column })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, files.length])

  // Header Actions
  const [showToast, setShowToast] = useState(null) // string | null
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
    const defLangId = 'python'
    const content = placeholderByLangId[defLangId]
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: defLangId, content }
    setFiles(prev => [...prev, newFile])
    setActiveFileId(id)
  }


  /* eslint-disable no-unused-vars */
  // Retained top-bar file handlers for use in other surfaces (e.g., left drawer / future UI)
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
    const defLangId = 'python'
    const content = placeholderByLangId[defLangId]
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
  /* eslint-enable no-unused-vars */

  // Settings Modal effects
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

  // Left Drawer - Files handlers
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
    const defLangId = 'python'
    const content = placeholderByLangId[defLangId]
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

  // Output / Run
  const [outputTab, setOutputTab] = useState('run') // 'run' | 'resources'
  const [outputLog, setOutputLog] = useState(['Welcome to Omni Compiler (UI-only).'])
  const [running, setRunning] = useState(false)


  const runSimulate = () => {
    if (running) return
    setRunning(true)
    setOutputTab('run')
    const ts = nowTime()
    setTimeout(() => {
      setOutputLog(prev => [...prev, `[${ts}] Run simulated`])
      setRunning(false)
    }, 900)
  }

  // Clear output log
  const onClearOutput = () => {
    setOutputLog([])
  }

  // Keyboard Shortcuts: Quick Open & Palette
  const [quickOpen, setQuickOpen] = useState(false)
  const quickTrapRef = useFocusTrap(quickOpen)
  const [quickQuery, setQuickQuery] = useState('')
  const quickList = files.filter(f => f.name.toLowerCase().includes(quickQuery.toLowerCase()))
  const chooseQuick = (id) => {
    setActiveFileId(id)
    setQuickOpen(false)
  }

  // Command palette removed
  useEffect(() => {
    if (!quickOpen) return
    const el = quickTrapRef.current
    if (!el) return
    const h = () => setQuickOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [quickOpen, quickTrapRef])
  // Command palette focus trap removed

  useEffect(() => {
    const onKey = (e) => {
      // Ctrl/Cmd+Enter: Run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        runSimulate()
      }
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Language change & editor actions
  const onFormat = async () => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const action = ed.getAction('editor.action.formatDocument')
      if (action) {
        await action.run()
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
    }
  }
  const onFind = () => {
    const ed = editorRef.current
    if (!ed) return
    ed.getAction('actions.find')?.run()
  }

  // Responsive: collapse output toggle
  const toggleOutputCollapsed = () => setOutputCollapsed(v => !v)

  // Derived widths (px) for smooth animation
  const editorBasisPx = Math.max(0, Math.round((outputCollapsed ? 1 : splitRatio) * workspaceW))
  const outputBasisPx = Math.max(0, Math.round((outputCollapsed ? 0 : (1 - splitRatio)) * workspaceW))
  // Fallback % widths until ResizeObserver reports size (prevents initial snap)
  const editorWidthStyle = workspaceW ? editorBasisPx : (outputCollapsed ? '100%' : `${Math.round(splitRatio * 100)}%`)
  const outputWidthStyle = workspaceW ? outputBasisPx : (outputCollapsed ? '0%' : `${Math.round((1 - splitRatio) * 100)}%`)
  // Compact editor header when the editor is very narrow
  const editorCompact = !outputCollapsed && splitRatio < 0.28

  // Custom dark dropdown for manual language (so the native white menu isn't used)
  const ManualLanguagePicker = ({ value, onChange }) => {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
      const onDoc = (e) => {
        if (!ref.current) return
        if (!ref.current.contains(e.target)) setOpen(false)
      }
      document.addEventListener('mousedown', onDoc)
      return () => document.removeEventListener('mousedown', onDoc)
    }, [])

    const options = [
      { id: '', label: 'Select language…' },
      { id: 'python', label: 'Python' },
      { id: 'javascript', label: 'JavaScript' },
      { id: 'java', label: 'Java' },
      { id: 'cpp', label: 'C++' },
      { id: 'go', label: 'Go' },
      { id: 'plaintext', label: 'Plain Text' },
    ]
    const current = options.find(o => o.id === value)?.label || 'Select language…'

    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          className="h-9 min-w-[12rem] px-3 inline-flex items-center justify-between rounded-md border border-white/10 bg-white/10 text-neutral-100 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-violet-500"
          aria-haspopup="listbox"
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => setOpen(v => !v)}
        >
          <span className="truncate">{current}</span>
          <span className="ml-2 opacity-80"><Icon name="chevron-right" className="size-3 rotate-90" /></span>
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute z-10 right-0 mt-1 w-48 max-h-60 overflow-auto rounded-md border border-white/10 bg-[#0f121a] text-neutral-100 shadow-xl"
          >
            {options.map(opt => (
              <li key={opt.id}>
                <button
                  role="option"
                  aria-selected={value === opt.id}
                  onClick={() => { onChange(opt.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${value === opt.id ? 'bg-white/10' : ''}`}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="h-screen w-screen">
      <a href="#editor-pane" className="sr-only focus:not-sr-only absolute top-1 left-1 z-50 bg-amber-500 text-black px-2 py-1 rounded">
        Skip to editor
      </a>

      {/* Header */}
      <header className="h-14 border-b border-neutral-200/60 dark:border-white/10 flex items-center justify-between px-3 gap-3">
        {/* Left slot */}
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-2 text-sm font-semibold px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
            aria-label="Omni Compiler Home"
            onClick={() => {}}
          >
            <Icon name="file" className="size-4" />
            <span>Omni Compiler</span>
          </button>

          <span aria-hidden="true" className="h-5 w-px bg-neutral-300 dark:bg-white/20" />

          {/* Run/Debug switch */}
          <div data-testid="tid-mode-switch" className="flex items-center gap-2" role="group" aria-label="Run Debug Mode">
            <button
              className={`px-3 py-1.5 text-sm rounded-l border border-neutral-200/60 dark:border-white/10 ${mode === 'Run' ? 'bg-[var(--oc-primary-600)] text-white' : 'bg-[var(--oc-surface-2)]'}`}
              aria-pressed={mode === 'Run'}
              onClick={() => mode === 'Debug' ? onToggleMode() : null}
            >
              Run
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-r border border-neutral-200/60 dark:border-white/10 ${mode === 'Debug' ? 'bg-[var(--oc-primary-600)] text-white' : 'bg-[var(--oc-surface-2)]'}`}
              aria-pressed={mode === 'Debug'}
              onClick={() => mode === 'Run' ? onToggleMode() : null}
              aria-describedby={showDebugTip ? 'debug-tip' : undefined}
              title="Debug mode is coming soon. Currently visual only."
            >
              Debug
            </button>
            {showDebugTip && (
              <span id="debug-tip" className="ml-2 text-xs text-neutral-600 dark:text-neutral-300">
                Debug mode is coming soon. Currently visual only.
              </span>
            )}
          </div>
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
          <Icon name="chevron-left" />
        </button>

        {/* Left overlay drawer */}
        {leftMounted && (
          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-y-0 left-0 z-40 flex"
            onClick={(e) => {
              // click outside drawer to close, keep 20px gutter visible
              if (e.target === e.currentTarget) closeDrawer()
            }}
          >
            <div
              ref={leftTrapRef}
              className={`w-[300px] h-full bg-white dark:bg-[#0f121a] border-r border-neutral-200 dark:border-white/10 shadow-xl outline-none transform transition-transform duration-200 ${leftOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
              <div className="h-12 px-3 border-b border-neutral-200 dark:border-white/10 flex items-center justify-between">
                <div className="text-sm font-medium">Files</div>
                <button
                  onClick={closeDrawer}
                  className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="Close drawer"
                  title="Close"
                >
                  <Icon name="x" />
                </button>
              </div>

              {/* Tabs */}
              {/* Section label */}

              <div className="p-3">
                {leftTab === 'files' ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-neutral-600 dark:text-neutral-300">Max 5 items</div>
                      <div className="flex items-center gap-1">
                        <button
                          data-testid="tid-add-file"
                          className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          title="Add new file (name only)"
                          aria-label="Add new file"
                          onClick={addFileInDrawer}
                        >
                          <Icon name="plus" />
                        </button>
                        <input ref={uploadInDrawerRef} type="file" className="hidden" onChange={onDrawerUploadSelected} />
                        <button
                          data-testid="tid-upload-file"
                          className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
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
                        <li className="text-sm text-neutral-500">No files yet. Click + to add.</li>
                      )}
                      {files.map((f) => (
                        <li
                          key={f.id}
                          className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm cursor-pointer ${activeFileId === f.id ? 'bg-violet-600/10 ring-1 ring-violet-600/50' : 'hover:bg-neutral-100 dark:hover:bg-white/10'}`}
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
                                  className="w-full bg-transparent border-b border-neutral-400 focus:border-violet-600 outline-none"
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
                              className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-white/10"
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
                              className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-white/10"
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
                    <div className="text-sm text-neutral-600 dark:text-neutral-300">
                      Static placeholder — Non-functional for now. Renders a simple list with add/remove disabled and a tooltip "Coming soon".
                    </div>
                    <ul className="text-sm list-disc pl-5 space-y-1">
                      <li>python: requests</li>
                      <li>node: lodash</li>
                      <li>java: junit</li>
                    </ul>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 rounded bg-neutral-100 dark:bg-white/10 cursor-not-allowed" title="Coming soon" aria-disabled="true">Add</button>
                      <button className="px-3 py-1.5 rounded bg-neutral-100 dark:bg-white/10 cursor-not-allowed" title="Coming soon" aria-disabled="true">Remove</button>
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
            className="h-full border-r border-neutral-200/60 dark:border-white/10 flex flex-col"
            style={{ width: editorWidthStyle }}
            animate={workspaceW ? { width: editorBasisPx } : undefined}
            transition={{ duration: 0.28, ease: [0.22, 0.8, 0.36, 1] }}
          >
            {/* Editor header / breadcrumbs / actions */}
            <div className="h-11 shrink-0 px-3 border-b border-neutral-200/60 dark:border-white/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs md:text-sm">
                <nav aria-label="Breadcrumbs" className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <span>workspace</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-neutral-900 dark:text-neutral-100 truncate">{activeFile?.name || 'main'}</span>
                </nav>
              </div>

              <div className="flex items-center gap-2">
                {!editorCompact && (
                  <span className="h-8 inline-flex items-center text-sm px-2 rounded bg-neutral-100 dark:bg-white/10">
                    Language: {autoDetect ? langDisplay(activeFile) : languageLabel(autoLang || 'plaintext')} {autoDetect ? '(auto)' : '(manual)'}
                  </span>
                )}
                <button
                  id="formatBtn"
                  onClick={onFormat}
                  className={`h-8 ${editorCompact ? 'w-8 px-0' : 'px-3'} text-sm rounded bg-neutral-100 dark:bg-white/10 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center justify-center gap-1`}
                  title="Format document"
                  aria-label="Format document"
                >
                  <Icon name="wand" />
                  {!editorCompact && <span>Format</span>}
                </button>
                <button
                  id="findBtn"
                  onClick={onFind}
                  className={`h-8 ${editorCompact ? 'w-8 px-0' : 'px-3'} text-sm rounded bg-neutral-100 dark:bg-white/10 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center justify-center gap-1`}
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
            <div className="h-7 shrink-0 px-3 border-t border-neutral-200/60 dark:border-white/10 text-[11px] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span id="cursorPos">Ln {cursorPos.line}, Col {cursorPos.column}</span>
              </div>
              <div className="flex items-center gap-3">
                <span id="modeIndicator">Mode: {mode}</span>
                <span id="langIndicator">{autoDetect ? `${langDisplay(activeFile)} (auto)` : `${languageLabel(autoLang || 'plaintext')} (manual)`}</span>
                <span id="encoding">UTF-8</span>
                <span id="indent">Spaces: 4</span>
              </div>
            </div>
          </motion.section>

          {/* Splitter */}
          <motion.div
            role="separator"
            aria-orientation="vertical"
            className="cursor-col-resize hover:bg-violet-600/30"
            style={{ width: outputCollapsed ? 0 : 6, opacity: outputCollapsed ? 0 : 1 }}
            onMouseDown={(e) => {
              isResizingRef.current = true
              document.body.style.userSelect = 'none'
              document.body.style.cursor = 'col-resize'
            }}
            title="Drag to resize"
            transition={{ duration: 0.2 }}
          />

          {/* Output Pane */}
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
              {/* Output header */}
              <div className="h-11 shrink-0 px-3 border-b border-neutral-200/60 dark:border-white/10 flex items-center justify-between">
                {/* Tabs (left) */}
                <div role="tablist" aria-label="Output tabs" className="flex items-center gap-1">
                  <button
                    role="tab"
                    aria-selected={outputTab === 'run'}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${outputTab === 'run' ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10' : 'text-neutral-300 hover:bg-white/5'}`}
                    onClick={() => setOutputTab('run')}
                  >
                    Run
                  </button>
                  <button
                    role="tab"
                    aria-selected={outputTab === 'resources'}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${outputTab === 'resources' ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10' : 'text-neutral-300 hover:bg-white/5'}`}
                    onClick={() => setOutputTab('resources')}
                  >
                    Resources
                  </button>
                </div>

                {/* Actions (right) */}
                <div className="flex items-center gap-1.5">
                  <button
                    data-testid="tid-run-btn"
                    onClick={runSimulate}
                    disabled={running}
                    className={`oc-btn-cta h-9 w-9 rounded-full focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center justify-center ${running ? 'opacity-90 cursor-default' : ''}`}
                    aria-busy={running ? 'true' : 'false'}
                    aria-label="Run"
                    title={running ? 'Running…' : 'Run'}
                  >
                    <Icon name="play" />
                    <span className="sr-only">{running ? 'Running…' : 'Run'}</span>
                  </button>

                  <button
                    onClick={onClearOutput}
                    className="oc-icon-btn"
                    aria-label="Clear output"
                    title="Clear output"
                  >
                    <Icon name="trash" />
                  </button>

                  <button
                    data-testid="tid-collapse-output"
                    className="oc-icon-btn"
                    aria-label="Collapse Output"
                    title="Collapse Output"
                    onClick={toggleOutputCollapsed}
                  >
                    <Icon name="chevron-right" />
                  </button>
                </div>
              </div>

              {/* Tabs */}

              {/* Output content */}
              <div className="flex-1 min-h-0 p-3 flex flex-col">
                {outputTab === 'run' && (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    {/* Primary actions */}

                    {/* Program Output */}
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Program Output</div>
                      <div
                        data-testid="tid-stdout"
                        role="log"
                        aria-live="polite"
                        className="w-full flex-1 min-h-0 bg-black text-green-400 rounded p-2 font-mono text-xs overflow-auto"
                        style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                      >
                        {outputLog.length === 0 ? (
                          <div className="opacity-60">Output will appear here (stub)</div>
                        ) : (
                          outputLog.map((line, i) => <div key={i}>{line}</div>)
                        )}
                      </div>
                    </div>
                  </div>
                )}


                {outputTab === 'resources' && (
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-neutral-100 dark:bg-white/10 rounded p-3">
                      <div className="text-xs text-neutral-500">CPU</div>
                      <div className="text-base">—</div>
                    </div>
                    <div className="bg-neutral-100 dark:bg-white/10 rounded p-3">
                      <div className="text-xs text-neutral-500">Memory</div>
                      <div className="text-base">—</div>
                    </div>
                    <div className="bg-neutral-100 dark:bg-white/10 rounded p-3">
                      <div className="text-xs text-neutral-500">Time</div>
                      <div className="text-base">—</div>
                    </div>
                  </div>
                )}
              </div>
              </motion.section>
            )}
          </AnimatePresence>
          {outputCollapsed && (
            // Collapsed: show a small expand handle on right edge
            <button
              data-testid="tid-collapse-output"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 oc-icon-btn rounded-l-lg"
              aria-label="Expand Output"
              onClick={toggleOutputCollapsed}
              title="Expand Output"
            >
              <Icon name="chevron-right" />
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
            className="relative z-10 w-[92vw] max-w-md rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#0f121a] p-4 shadow-2xl outline-none"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Settings</h3>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-label="Close settings"
              >
                <Icon name="x" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Font Size</div>
                  <div className="text-xs text-neutral-500">{fontSize}px</div>
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
                    <div className="text-xs text-neutral-500">Auto-detect enabled by default</div>
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
                      <div className="text-xs text-neutral-500">Choose when auto is off</div>
                    </div>
                    <ManualLanguagePicker value={autoLang} onChange={setAutoLang} />
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
            className="relative z-10 w-[92vw] max-w-lg rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#0f121a] p-3 shadow-2xl outline-none"
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
                    className="w-full text-left px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10"
                    onClick={() => chooseQuick(f.id)}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
              {quickList.length === 0 && (
                <li className="px-3 py-2 text-sm text-neutral-500">No matches</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Command Palette removed */}

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

export default App
