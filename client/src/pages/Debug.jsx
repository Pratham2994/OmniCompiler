import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLanguage } from '../context/LanguageContext.jsx'
import { Icon } from '../components/run/ui.jsx'
import DebugHeader from './debug/DebugHeader.jsx'
import FilesDrawer from './debug/FilesDrawer.jsx'
import EditorPane from './debug/EditorPane.jsx'
import DebugPanel from './debug/DebugPanel.jsx'
import SettingsModal from './debug/SettingsModal.jsx'
import QuickOpenModal from './debug/QuickOpenModal.jsx'
import useFocusTrap from './debug/useFocusTrap.js'
import useDebugRunner from './debug/useDebugRunner.js'
import useExecutionTrace from './debug/useCodeTree.js'
import useMonacoEditor from './debug/useMonacoEditor.js'
import { typeColor, typeLegend } from './debug/executionTrace.js'
import { stripExtension } from './debug/traceUtils.js'
import { extForLang } from './debug/parseTrees.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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
      const id = String(f?.id || `f_restored_${idx}_${Math.random().toString(36).slice(2,8)}`)
      return { id, name: String(f?.name || `file_${idx+1}`), language: 'plaintext', content: String(f?.content || '') }
    })
    const activeId = (data.activeId && files.find(x => x.id === data.activeId)) ? data.activeId : (files[0]?.id || null)
    return { files, activeId }
  } catch {
    return null
  }
}

const BP_LS_KEY = 'oc_debug_breakpoints_v1'

export default function Debug() {
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
  const activeFile = useMemo(() => files.find(f => f.id === activeFileId) || files[0], [files, activeFileId])
  const [hydrated, setHydrated] = useState(false)
  const saveTimerRef = useRef(null)

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
  const toggleFilesDrawer = () => {
    if (leftOpen) {
      closeDrawer()
    } else {
      openDrawer()
    }
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

  const {
    editorContainerRef,
    editorRef,
    monacoRef,
    modelsRef,
    cursorPos,
    monacoReady,
    editorReady,
  } = useMonacoEditor({ activeFile, activeFileId, effectiveLanguage, theme, setFiles, filesLength: files.length })

  const breakpointDecorationsRef = useRef([])


  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTrapRef = useFocusTrap(settingsOpen)
  const [fontSize, setFontSize] = useState(14)
  useEffect(() => {
    const ed = editorRef.current
    if (ed) ed.updateOptions({ fontSize })
  }, [fontSize, editorRef])
  useEffect(() => {
    if (!settingsOpen) return
    const el = settingsTrapRef.current
    if (!el) return
    const h = () => setSettingsOpen(false)
    el.addEventListener('trap-escape', h)
    return () => el.removeEventListener('trap-escape', h)
  }, [settingsOpen, settingsTrapRef])

  const [showToast, setShowToast] = useState(null)
  const triggerToast = (msg) => {
    setShowToast(msg)
    setTimeout(() => setShowToast(null), 1500)
  }

  const onNewFile = () => {
    if (files.length >= 5) { triggerToast('Max 5 files allowed'); return }
    const name = prompt('Enter file name (no extension displayed):')
    if (!name) return
    const clean = stripExtension(name.trim())
    if (!clean) { triggerToast('Name cannot be empty'); return }
    if (files.some(f => f.name === clean)) { triggerToast('Duplicate name not allowed'); return }
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: 'plaintext', content: '' }
    setFiles(prev => [...prev, newFile])
    setActiveFileId(id)
  }

  const uploadInDrawerRef = useRef(null)
  const addFileInDrawer = () => onNewFile()
  const onDrawerUpload = () => uploadInDrawerRef.current?.click()
  const onDrawerUploadSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const clean = stripExtension(file.name)
    if (!clean) return
    if (files.length >= 5) { triggerToast('Max 5 files allowed'); return }
    if (files.some(f => f.name === clean)) { triggerToast('Duplicate name not allowed'); return }
    const id = `f${Math.random().toString(36).slice(2, 8)}`
    const newFile = { id, name: clean, language: 'plaintext', content: '' }
    setFiles(prev => [...prev, newFile])
    setActiveFileId(id)
    e.target.value = ''
  }

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const onRenameFile = (id, newName) => {
    const clean = stripExtension(newName.trim())
    if (!clean) { triggerToast('Name cannot be empty'); return false }
    if (files.some(f => f.name === clean && f.id !== id)) { triggerToast('Duplicate name not allowed'); return false }
    setFiles(prev => prev.map(f => f.id === id ? { ...f, name: clean } : f))
    return true
  }
  const onDeleteFile = (id) => {
    if (files.length <= 1) { triggerToast('At least one file must remain'); return }
    if (!confirm('Delete this file?')) return
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id)
      if (id === activeFileId && next.length) setActiveFileId(next[0].id)
      return next
    })
  }

  const [debugTab, setDebugTab] = useState('bpvars')
  const [breakpoints, setBreakpoints] = useState(() => {
    try {
      const raw = localStorage.getItem(BP_LS_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.slice(0, 128) : []
    } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem(BP_LS_KEY, JSON.stringify(breakpoints)) } catch {}
  }, [breakpoints])

  const toggleBreakpointAtLine = useCallback((fileId, maybeLine) => {
    if (!fileId) return
    const line = Math.max(1, Number(maybeLine) || 1)
    const id = `${fileId}:${line}`
    setBreakpoints(prev => {
      if (prev.some(b => b.id === id)) {
        return prev.filter(b => b.id !== id)
      }
      const file = files.find(f => f.id === fileId)
      const item = { id, fileId, fileName: file?.name || 'main', line, condition: '' }
      return [...prev, item].slice(0, 128)
    })
  }, [files])


  useEffect(() => {
    if (!editorReady) return
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const mouseTargetType = monaco.editor?.MouseTargetType
    if (!mouseTargetType) return
    const disposable = editor.onMouseDown((e) => {
      const targetType = e.target?.type
      if (
        targetType === mouseTargetType.GUTTER_GLYPH_MARGIN ||
        targetType === mouseTargetType.GUTTER_LINE_NUMBERS ||
        targetType === mouseTargetType.GUTTER_LINE_DECORATIONS
      ) {
        const lineNumber =
          e.target?.position?.lineNumber ??
          e.target?.range?.startLineNumber ??
          e.target?.detail?.viewPosition?.lineNumber
        if (lineNumber) {
          toggleBreakpointAtLine(activeFileId, lineNumber)
        }
      }
    })
    return () => disposable.dispose()
  }, [editorReady, toggleBreakpointAtLine, activeFileId])

  useEffect(() => {
    if (!editorReady) return
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const activeDecorations = breakpoints
      .filter(bp => bp.fileId === activeFileId)
      .map(bp => ({
        range: new monaco.Range(bp.line, 1, bp.line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: 'oc-breakpoint-glyph',
          linesDecorationsClassName: 'oc-breakpoint-line',
        },
      }))
    breakpointDecorationsRef.current = editor.deltaDecorations(
      breakpointDecorationsRef.current,
      activeDecorations,
    )
  }, [breakpoints, activeFileId, editorReady])
  const addBreakpointAtCursor = useCallback(() => {
    if (!activeFileId || !activeFile) return
    toggleBreakpointAtLine(activeFileId, cursorPos?.line || 1)
  }, [activeFileId, activeFile, cursorPos?.line, toggleBreakpointAtLine])
  const removeBreakpoint = (bpId) => setBreakpoints(prev => prev.filter(b => b.id !== bpId))
  const clearBreakpoints = () => setBreakpoints([])

  const [quickOpen, setQuickOpen] = useState(false)
  const quickTrapRef = useFocusTrap(quickOpen)
  const [quickQuery, setQuickQuery] = useState('')
  const quickList = files.filter(f => f.name.toLowerCase().includes(quickQuery.toLowerCase()))
  const chooseQuick = (id) => { setActiveFileId(id); setQuickOpen(false) }
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
      if (action) { await action.run(); triggerToast('Formatted'); return }
    } catch {}
    const model = ed.getModel()
    if (!model) return
    const original = model.getValue()
    const normalized = original.split('\n').map(line => line.replace(/\s+$/g, '').replace(/\t/g, '    ')).join('\n')
    if (normalized !== original) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: normalized }], () => null)
      triggerToast('Formatted')
    }
  }
  const onFind = () => { editorRef.current?.getAction('actions.find')?.run() }

  const toggleOutputCollapsed = () => setOutputCollapsed(v => !v)
  const editorBasisPx = Math.max(0, Math.round((outputCollapsed ? 1 : splitRatio) * workspaceW))
  const outputBasisPx = Math.max(0, Math.round((outputCollapsed ? 0 : (1 - splitRatio)) * workspaceW))
  const editorWidthStyle = workspaceW ? editorBasisPx : (outputCollapsed ? '100%' : `${Math.round(splitRatio * 100)}%`)
  const outputWidthStyle = workspaceW ? outputBasisPx : (outputCollapsed ? '0%' : `${Math.round((1 - splitRatio) * 100)}%`)
  const editorCompact = !outputCollapsed && splitRatio < 0.28

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFileId) return
    if (autoDetect) {
      startPollingForFile(activeFileId, () => editor.getModel()?.getValue() || '', 2000)
    } else {
      stopPollingForFile(activeFileId)
    }
    return () => { stopPollingForFile(activeFileId) }
  }, [autoDetect, monacoReady, activeFileId, startPollingForFile, stopPollingForFile, editorRef])

  function getActiveCode() {
    try {
      const ed = editorRef.current
      const model = ed?.getModel?.()
      if (model) return String(model.getValue() || '')
    } catch {}
    return String(activeFile?.content || '')
  }

  const getLiveContent = (file) => {
    const m = modelsRef.current.get(file.id)
    if (m && typeof m.getValue === 'function') {
      return String(m.getValue() ?? '')
    }
    return String(file.content ?? '')
  }

  const nameWithExt = (f, fallbackLang) => {
    const fl = getEffectiveLanguage(f.id) || fallbackLang || 'plaintext'
    const ext = extForLang(fl)
    return ext ? `${f.name}.${ext}` : f.name
  }

  const buildCfgRequest = () => {
    const entryId = activeFileId
    const entryFile = files.find(f => f.id === entryId) || activeFile
    const entryLang = getEffectiveLanguage(entryId) || 'plaintext'
    const entry = nameWithExt(entryFile, entryLang)
    const payloadFiles = files.map(f => ({
      name: nameWithExt(f, entryLang),
      content: getLiveContent(f),
    }))
    return { lang: entryLang, entry, files: payloadFiles }
  }

  const buildDebugRunRequest = () => ({ ...buildCfgRequest(), args: [] })

  const {
    outputLog,
    running,
    stdinLine,
    setStdinLine,
    waitingForInput,
    runProgram,
    stopDebugSession,
    onClearOutput,
    sendStdin,
  } = useDebugRunner({
    apiBase,
    getEffectiveLanguage,
    activeFileId,
    activeFile,
    editorRef,
    setFiles,
    buildDebugRunRequest,
    setDebugTab,
    triggerToast,
  })

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (running) { stopDebugSession() } else { runProgram() }
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p')) {
        e.preventDefault()
        setQuickOpen(true)
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f')) {
        const ed = editorRef.current
        if (ed) { e.preventDefault(); ed.getAction('actions.find')?.run() }
      }
      if (e.key === 'F9') { e.preventDefault(); addBreakpointAtCursor() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cursorPos, activeFileId, activeFile, running, editorRef, stopDebugSession, runProgram, addBreakpointAtCursor])

  const {
    executionTrace,
    currentStepIndex,
    traceStatus,
    traceMessage,
    traceBusy,
    traceWarnings,
    generateTrace,
    handleStepClick,
  } = useExecutionTrace({
    files,
    activeFile,
    activeFileId,
    effectiveLanguage,
    getEffectiveLanguage,
    setActiveFileId,
    apiBase,
    getActiveCode,
    buildCfgRequest,
    editorRef,
    nameWithExt,
    getLiveContent,
  })

  return (
    <div className="h-screen w-screen">
      <a
        href="#editor-pane"
        className="sr-only focus:not-sr-only absolute top-1 left-1 z-50 bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
      >
        Skip to editor
      </a>

      <DebugHeader settingsOpen={settingsOpen} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="relative h-[calc(100vh-56px)] w-full overflow-hidden">
        <FilesDrawer
          leftMounted={leftMounted}
          leftOpen={leftOpen}
          leftTrapRef={leftTrapRef}
          closeDrawer={closeDrawer}
          leftTab={leftTab}
          files={files}
          activeFileId={activeFileId}
          setActiveFileId={setActiveFileId}
          addFileInDrawer={addFileInDrawer}
          uploadInDrawerRef={uploadInDrawerRef}
          onDrawerUploadSelected={onDrawerUploadSelected}
          onDrawerUpload={onDrawerUpload}
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameFile={onRenameFile}
          setRenamingId={setRenamingId}
          setRenameValue={setRenameValue}
          onDeleteFile={onDeleteFile}
        />

        <div id="oc-workspace" className="absolute inset-0 flex">
          <EditorPane
            editorWidthStyle={editorWidthStyle}
            workspaceW={workspaceW}
            editorBasisPx={editorBasisPx}
            editorCompact={editorCompact}
            languageLabel={languageLabel}
            effectiveLanguage={effectiveLanguage}
            autoDetect={autoDetect}
            onFormat={onFormat}
            onFind={onFind}
            editorContainerRef={editorContainerRef}
            cursorPos={cursorPos}
            activeFileName={activeFile?.name}
            onToggleFilesDrawer={toggleFilesDrawer}
            filesDrawerOpen={leftOpen}
          />

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
              <DebugPanel
                workspaceW={workspaceW}
                outputWidthStyle={outputWidthStyle}
                outputBasisPx={outputBasisPx}
                debugTab={debugTab}
                setDebugTab={setDebugTab}
                running={running}
                stopDebugSession={stopDebugSession}
                runProgram={runProgram}
                clearBreakpoints={clearBreakpoints}
                toggleOutputCollapsed={toggleOutputCollapsed}
                breakpoints={breakpoints}
                removeBreakpoint={removeBreakpoint}
                effectiveLanguage={effectiveLanguage}
                languageLabel={languageLabel}
                generateTrace={generateTrace}
                traceBusy={traceBusy}
                traceStatus={traceStatus}
                traceMessage={traceMessage}
                traceWarnings={traceWarnings}
                executionTrace={executionTrace}
                currentStepIndex={currentStepIndex}
                onTraceStepClick={handleStepClick}
                typeLegend={typeLegend}
                typeColor={typeColor}
                outputLog={outputLog}
                onClearOutput={onClearOutput}
                stdinLine={stdinLine}
                setStdinLine={setStdinLine}
                sendStdin={sendStdin}
                waitingForInput={waitingForInput}
              />
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

      <SettingsModal
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        settingsTrapRef={settingsTrapRef}
        theme={theme}
        setTheme={setTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
        autoDetect={autoDetect}
        setAutoDetect={setAutoDetect}
        manualLanguage={manualLanguage}
        setManualLanguage={setManualLanguage}
        activeFileId={activeFileId}
      />

      <QuickOpenModal
        quickOpen={quickOpen}
        quickTrapRef={quickTrapRef}
        quickQuery={quickQuery}
        setQuickQuery={setQuickQuery}
        quickList={quickList}
        chooseQuick={chooseQuick}
        setQuickOpen={setQuickOpen}
      />

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
