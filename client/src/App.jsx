import { useEffect, useMemo, useRef, useState } from 'react'

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

const langOptions = ['Python', 'JavaScript', 'Java', 'C++', 'Go']

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

const placeholderByLangId = {
  python: "# Write your code here\nprint('Hello Omni')\n",
  javascript: "console.log('Hello Omni')\n",
  java: 'class Main { public static void main(String[] args){ System.out.println("Hello Omni"); } }',
  cpp: '#include <bits/stdc++.h>\nusing namespace std; int main(){ cout<<"Hello Omni"; }',
  go: 'package main\nimport "fmt"\nfunc main(){ fmt.Println("Hello Omni") }\n',
}

const defaultFiles = [
  { id: 'f1', name: 'main', language: 'python', content: "print('Hello Omni')\n" },
  { id: 'f2', name: 'utils', language: 'python', content: 'def add(a,b): return a+b\n' },
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
  const [leftOpen, setLeftOpen] = useState(false)
  const [leftTab, setLeftTab] = useState('files') // 'files' | 'deps'
  const leftTrapRef = useFocusTrap(leftOpen)
  useEffect(() => {
    if (!leftOpen) return
    const el = leftTrapRef.current
    if (!el) return
    const h = () => setLeftOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [leftOpen, leftTrapRef])

  // Output / Split
  const [outputCollapsed, setOutputCollapsed] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.5) // editor width ratio
  const isResizingRef = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current) return
      const bodyRect = document.getElementById('oc-workspace')?.getBoundingClientRect()
      if (!bodyRect) return
      const x = e.clientX - bodyRect.left
      const ratio = clamp(x / bodyRect.width, 0.2, 0.8)
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
      const l = monacoLangId(langDisplay(activeFile))
      monaco.editor.setModelLanguage(model, l)
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
    const l = monacoLangId(langDisplay(activeFile))
    monaco.editor.setModelLanguage(model, l)
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

  // Settings Modal
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrapRef = useFocusTrap(settingsOpen)
  const [fontSize, setFontSize] = useState(14)
  const [autoDetect, setAutoDetect] = useState(true)
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
    if (!confirm('Delete this file?')) return
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id)
      if (id === activeFileId && next.length) setActiveFileId(next[0].id)
      return next
    })
  }

  // Output / Run
  const [outputTab, setOutputTab] = useState('run') // 'run' | 'console' | 'resources'
  const [stdinText, setStdinText] = useState('')
  const [stdinFileName, setStdinFileName] = useState('')
  const stdinUploadRef = useRef(null)
  const [outputLog, setOutputLog] = useState(['Welcome to Omni Compiler (UI-only).'])
  const [running, setRunning] = useState(false)

  const onUploadStdin = () => stdinUploadRef.current?.click()
  const onStdinSelected = (e) => {
    const f = e.target.files?.[0]
    if (f) {
      setStdinFileName(f.name)
    }
    e.target.value = ''
  }

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

  // Keyboard Shortcuts: Quick Open & Palette
  const [quickOpen, setQuickOpen] = useState(false)
  const quickTrapRef = useFocusTrap(quickOpen)
  const [quickQuery, setQuickQuery] = useState('')
  const quickList = files.filter(f => f.name.toLowerCase().includes(quickQuery.toLowerCase()))
  const chooseQuick = (id) => {
    setActiveFileId(id)
    setQuickOpen(false)
  }

  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteTrapRef = useFocusTrap(paletteOpen)
  useEffect(() => {
    if (!quickOpen) return
    const el = quickTrapRef.current
    if (!el) return
    const h = () => setQuickOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [quickOpen, quickTrapRef])
  useEffect(() => {
    if (!paletteOpen) return
    const el = paletteTrapRef.current
    if (!el) return
    const h = () => setPaletteOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [paletteOpen, paletteTrapRef])

  useEffect(() => {
    const onKey = (e) => {
      // Ctrl/Cmd+Enter: Run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        runSimulate()
      }
      // Ctrl/Cmd+P: Quick file switcher (modal stub)
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
      // F1: Command palette (stub)
      if (e.key === 'F1') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  // Language change & editor actions
  const onChangeLanguage = (display) => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!activeFile) return
    const langId = monacoLangId(display)
    setFiles(prev => prev.map(f => f.id === activeFile.id ? { ...f, language: langId } : f))
    if (monaco && editor) {
      const model = editor.getModel()
      if (model) monaco.editor.setModelLanguage(model, langId)
    }
  }
  const onFormat = () => {
    const ed = editorRef.current
    if (!ed) return
    ed.getAction('editor.action.formatDocument')?.run()
  }
  const onFind = () => {
    const ed = editorRef.current
    if (!ed) return
    ed.getAction('actions.find')?.run()
  }

  // Responsive: collapse output toggle
  const toggleOutputCollapsed = () => setOutputCollapsed(v => !v)

  // Derived widths
  const editorWidth = outputCollapsed ? '100%' : `${Math.round(splitRatio * 100)}%`
  const outputWidth = outputCollapsed ? '0%' : `${Math.round((1 - splitRatio) * 100)}%`

  return (
    <div className="h-screen w-screen bg-white text-neutral-900 dark:bg-[#0b0d12] dark:text-neutral-100">
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
              className={`px-3 py-1.5 text-sm rounded-l border border-neutral-300 dark:border-white/20 ${mode === 'Run' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
              aria-pressed={mode === 'Run'}
              onClick={() => mode === 'Debug' ? onToggleMode() : null}
            >
              Run
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-r border border-neutral-300 dark:border-white/20 ${mode === 'Debug' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
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
            id="newFileBtn"
            onClick={onNewFile}
            className="px-3 py-1.5 text-sm rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
            aria-label="New File"
          >
            New File
          </button>
          <input ref={uploadHiddenRef} type="file" className="hidden" onChange={onOpenSelected} />
          <button
            id="openBtn"
            onClick={onOpen}
            className="px-3 py-1.5 text-sm rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
            aria-label="Open File"
          >
            Open
          </button>
          <button
            id="saveBtn"
            onClick={onSave}
            className="px-3 py-1.5 text-sm rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
            aria-label="Save"
          >
            Save
          </button>
          <button
            id="settingsBtn"
            onClick={() => setSettingsOpen(true)}
            className="px-3 py-1.5 text-sm rounded bg-neutral-900 text-neutral-50 dark:bg-white dark:text-black hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center gap-2"
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
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 bg-neutral-900 text-white dark:bg-white dark:text-black p-2 rounded-r focus:outline-none focus:ring-2 focus:ring-violet-500"
          aria-label="Files & Deps"
          onClick={() => setLeftOpen(true)}
          title="Files & Deps"
        >
          <Icon name="panel-left-open" />
        </button>

        {/* Left overlay drawer */}
        {leftOpen && (
          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-y-0 left-0 z-40 flex"
            onClick={(e) => {
              // click outside drawer to close, keep 20px gutter visible
              if (e.target === e.currentTarget) setLeftOpen(false)
            }}
          >
            <div
              ref={leftTrapRef}
              className="w-[300px] h-full bg-white dark:bg-[#0f121a] border-r border-neutral-200 dark:border-white/10 shadow-xl outline-none"
            >
              <div className="h-12 px-3 border-b border-neutral-200 dark:border-white/10 flex items-center justify-between">
                <div className="text-sm font-medium">Files & Dependencies</div>
                <button
                  onClick={() => setLeftOpen(false)}
                  className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="Close drawer"
                  title="Close"
                >
                  <Icon name="x" />
                </button>
              </div>

              {/* Tabs */}
              <div className="px-3 pt-3 flex gap-2 text-sm">
                <button
                  className={`px-3 py-1.5 rounded ${leftTab === 'files' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                  onClick={() => setLeftTab('files')}
                  aria-pressed={leftTab === 'files'}
                >
                  Files
                </button>
                <button
                  className={`px-3 py-1.5 rounded ${leftTab === 'deps' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                  onClick={() => setLeftTab('deps')}
                  aria-pressed={leftTab === 'deps'}
                >
                  Libraries & Dependencies
                </button>
              </div>

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
          <section
            id="editor-pane"
            className="h-full border-r border-neutral-200/60 dark:border-white/10 flex flex-col"
            style={{ width: editorWidth, transition: 'width 150ms ease' }}
          >
            {/* Editor header / breadcrumbs / actions */}
            <div className="h-11 shrink-0 px-3 border-b border-neutral-200/60 dark:border-white/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs md:text-sm">
                <nav aria-label="Breadcrumbs" className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <span>workspace</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-neutral-900 dark:text-neutral-100 truncate">{activeFile?.name || 'main'}</span>
                </nav>
                <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-white/10" title="Language is auto-detected. Change via Settings.">
                  Auto: {langDisplay(activeFile)}?
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="languagePicker">Language</label>
                <select
                  id="languagePicker"
                  data-testid="tid-language-picker"
                  className="h-8 text-sm bg-neutral-100 dark:bg-white/10 rounded px-2 outline-none focus:ring-2 focus:ring-violet-500"
                  value={langDisplay(activeFile)}
                  onChange={(e) => onChangeLanguage(e.target.value)}
                >
                  {langOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <button
                  id="formatBtn"
                  onClick={onFormat}
                  className="h-8 px-3 text-sm rounded bg-neutral-100 dark:bg-white/10 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center gap-1"
                >
                  <Icon name="wand" />
                  Format
                </button>
                <button
                  id="findBtn"
                  onClick={onFind}
                  className="h-8 px-3 text-sm rounded bg-neutral-100 dark:bg-white/10 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center gap-1"
                >
                  <Icon name="search" />
                  Find
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
                <span id="langIndicator">{langDisplay(activeFile)} (auto)</span>
                <span id="encoding">UTF-8</span>
                <span id="indent">Spaces: 4</span>
              </div>
            </div>
          </section>

          {/* Splitter */}
          {!outputCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              className="w-1.5 cursor-col-resize hover:bg-violet-600/30"
              onMouseDown={(e) => {
                isResizingRef.current = true
                document.body.style.userSelect = 'none'
                document.body.style.cursor = 'col-resize'
              }}
              title="Drag to resize"
            />
          )}

          {/* Output Pane */}
          {!outputCollapsed ? (
            <section
              className="h-full flex flex-col"
              style={{ width: outputWidth, transition: 'width 150ms ease' }}
            >
              {/* Output header */}
              <div className="h-11 shrink-0 px-3 border-b border-neutral-200/60 dark:border-white/10 flex items-center justify-between">
                <h2 className="text-sm font-medium">Output</h2>
                <button
                  data-testid="tid-collapse-output"
                  className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  aria-label="Collapse Output"
                  title="Collapse Output"
                  onClick={toggleOutputCollapsed}
                >
                  <Icon name="panel-right-close" />
                </button>
              </div>

              {/* Tabs */}
              <div className="h-10 shrink-0 px-3 border-b border-neutral-200/60 dark:border-white/10 flex items-center gap-2 text-sm">
                <button
                  className={`px-3 py-1.5 rounded ${outputTab === 'run' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                  onClick={() => setOutputTab('run')}
                  aria-pressed={outputTab === 'run'}
                >
                  Run
                </button>
                <button
                  className={`px-3 py-1.5 rounded ${outputTab === 'console' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                  onClick={() => setOutputTab('console')}
                  aria-pressed={outputTab === 'console'}
                >
                  Console
                </button>
                <button
                  className={`px-3 py-1.5 rounded ${outputTab === 'resources' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                  onClick={() => setOutputTab('resources')}
                  aria-pressed={outputTab === 'resources'}
                >
                  Resources
                </button>
              </div>

              {/* Output content */}
              <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4">
                {outputTab === 'run' && (
                  <div className="space-y-4">
                    {/* Primary actions */}
                    <div className="flex items-center gap-2">
                      <button
                        data-testid="tid-run-btn"
                        onClick={runSimulate}
                        disabled={running}
                        className={`h-9 px-4 text-sm rounded text-white focus:outline-none focus:ring-2 focus:ring-violet-500 flex items-center gap-2 ${running ? 'bg-violet-400' : 'bg-violet-600 hover:bg-violet-700'}`}
                        aria-busy={running ? 'true' : 'false'}
                      >
                        <Icon name="play" />
                        {running ? 'Running…' : 'Run ▶'}
                      </button>
                    </div>

                    {/* User Input (stdin) */}
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">User Input (stdin)</div>
                      <textarea
                        data-testid="tid-stdin"
                        value={stdinText}
                        onChange={(e) => setStdinText(e.target.value)}
                        placeholder="Enter input for your program…"
                        className="w-full min-h-24 bg-neutral-100 dark:bg-white/10 rounded p-2 outline-none focus:ring-2 focus:ring-violet-500"
                        aria-label="Program input"
                      />
                      <div className="flex items-center gap-2">
                        <input ref={stdinUploadRef} type="file" className="hidden" onChange={onStdinSelected} />
                        <button
                          id="uploadInputBtn"
                          onClick={onUploadStdin}
                          className="h-8 px-3 text-sm rounded bg-neutral-100 dark:bg-white/10 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        >
                          Upload input file
                        </button>
                        {stdinFileName && (
                          <span className="text-xs text-neutral-600 dark:text-neutral-300">Selected: {stdinFileName}</span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500">If the program expects input, provide it here. Non-functional stub.</div>
                    </div>

                    {/* Program Output */}
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Program Output</div>
                      <div
                        data-testid="tid-stdout"
                        role="log"
                        aria-live="polite"
                        className="w-full min-h-24 bg-black text-green-400 rounded p-2 font-mono text-xs overflow-auto"
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

                {outputTab === 'console' && (
                  <div className="w-full min-h-24 bg-black text-neutral-200 rounded p-2 font-mono text-xs opacity-70">
                    Interactive console placeholder.
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
            </section>
          ) : (
            // Collapsed: show a small expand handle on right edge
            <button
              data-testid="tid-collapse-output"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-20 p-2 rounded-l bg-neutral-900 text-white dark:bg-white dark:text-black focus:outline-none focus:ring-2 focus:ring-violet-500"
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
                  <div className="font-medium">Theme</div>
                  <div className="text-xs text-neutral-500">Light/Dark</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className={`px-3 py-1.5 rounded ${theme === 'light' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                    onClick={() => setTheme('light')}
                    aria-pressed={theme === 'light'}
                  >
                    Light
                  </button>
                  <button
                    className={`px-3 py-1.5 rounded ${theme === 'dark' ? 'bg-violet-600 text-white' : 'bg-neutral-100 dark:bg-white/10'}`}
                    onClick={() => setTheme('dark')}
                    aria-pressed={theme === 'dark'}
                  >
                    Dark
                  </button>
                </div>
              </div>

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

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Language Auto-Detect</div>
                  <div className="text-xs text-neutral-500">Non-functional</div>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoDetect}
                    onChange={(e) => setAutoDetect(e.target.checked)}
                    aria-label="Toggle language auto-detect"
                  />
                  <span>{autoDetect ? 'On' : 'Off'}</span>
                </label>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSettingsOpen(false)}
                className="h-9 px-4 text-sm rounded bg-neutral-900 text-neutral-50 dark:bg-white dark:text-black hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                Close
              </button>
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
              className="w-full h-10 rounded bg-neutral-100 dark:bg-white/10 px-3 outline-none focus:ring-2 focus:ring-violet-500"
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

      {/* Command Palette (F1) */}
      {paletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPaletteOpen(false)
          }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            ref={paletteTrapRef}
            className="relative z-10 w-[92vw] max-w-lg rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#0f121a] p-3 shadow-2xl outline-none"
          >
            <div className="text-sm font-medium mb-2">Command Palette (stub)</div>
            <ul className="text-sm space-y-1">
              <li className="px-2 py-1 rounded bg-neutral-100 dark:bg-white/10">Run (simulate) — Ctrl/Cmd+Enter</li>
              <li className="px-2 py-1 rounded bg-neutral-100 dark:bg-white/10">Find in editor — Ctrl/Cmd+F</li>
              <li className="px-2 py-1 rounded bg-neutral-100 dark:bg-white/10">Quick file switcher — Ctrl/Cmd+P</li>
            </ul>
            <div className="text-xs text-neutral-500 mt-2">Visual only.</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {showToast && (
        <div className="fixed bottom-3 right-3 z-50 px-3 py-2 rounded bg-neutral-900 text-white dark:bg-white dark:text-black shadow">
          {showToast}
        </div>
      )}
    </div>
  )
}

export default App
