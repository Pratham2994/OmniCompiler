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
import useExecutionTrace from './debug/useCodeTree.js'
import useMonacoEditor from './debug/useMonacoEditor.js'
import { typeColor, typeLegend } from './debug/executionTrace.js'
import { stripExtension } from './debug/traceUtils.js'
import { extForLang } from './debug/parseTrees.js'
import { DebugProvider, useDebugContext } from '../context/DebugContext.jsx'

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
      const id = String(f?.id || `f_restored_${idx}_${Math.random().toString(36).slice(2,8)}`)
      return {
        id,
        name: String(f?.name || `file_${idx+1}`),
        language: 'plaintext',
        content: normalizeNewlines(String(f?.content || '')),
      }
    })
    const activeId = (data.activeId && files.find(x => x.id === data.activeId)) ? data.activeId : (files[0]?.id || null)
    return { files, activeId }
  } catch {
    return null
  }
}

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
    version: languageVersion,
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

  const flushSnapshot = useCallback(() => {
    if (!hydrated) return
    try {
      const filesToSave = (files || []).map(f => {
        let content = f.content
        try {
          const m = modelsRef.current?.get(f.id)
          if (m && typeof m.getValue === 'function') content = String(m.getValue() ?? f.content ?? '')
        } catch {}
        const normalizedContent = normalizeNewlines(String(content ?? ''))
        return { id: f.id, name: f.name, content: normalizedContent }
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

  const persistEditorModels = useCallback(() => {
    setFiles(prev => prev.map(file => {
      const model = modelsRef.current?.get(file.id)
      if (!model || typeof model.getValue !== 'function') return file
      const nextContent = normalizeNewlines(String(model.getValue() ?? ''))
      const currentContent = normalizeNewlines(String(file.content ?? ''))
      if (nextContent === currentContent) return file
      return { ...file, content: nextContent }
    }))
  }, [setFiles])

  const nameWithExt = useCallback((f, fallbackLang) => {
    const resolvedLang = getEffectiveLanguage(f.id) || fallbackLang || 'plaintext'
    const ext = extForLang(resolvedLang)
    return ext ? `${f.name}.${ext}` : f.name
  }, [getEffectiveLanguage])



  const fileMetas = useMemo(() => (
    files.map(file => {
      const lang = getEffectiveLanguage(file.id)
      return {
        fileId: file.id,
        fileName: file.name,
        filePath: nameWithExt(file, effectiveLanguage),
        language: lang,
      }
    })
  ), [files, languageVersion, nameWithExt, effectiveLanguage])

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
    if (!monacoReady) return
    const editor = editorRef.current
    if (!editor || !activeFileId) return
    if (autoDetect) {
      startPollingForFile(activeFileId, () => editor.getModel()?.getValue() || '', 2000)
    } else {
      stopPollingForFile(activeFileId)
    }
    return () => { stopPollingForFile(activeFileId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetect, monacoReady, activeFileId])

  function getActiveCode() {
    try {
      const ed = editorRef.current
      const model = ed?.getModel?.()
      if (model) return normalizeNewlines(String(model.getValue() || ''))
    } catch {}
    return normalizeNewlines(String(activeFile?.content || ''))
  }

  const getLiveContent = (file) => {
    const m = modelsRef.current.get(file.id)
    if (m && typeof m.getValue === 'function') {
      return normalizeNewlines(String(m.getValue() ?? ''))
    }
    return normalizeNewlines(String(file.content ?? ''))
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
    <DebugProvider
      apiBase={apiBase}
      fileMetas={fileMetas}
      activeFileId={activeFileId}
      buildDebugRunRequest={buildDebugRunRequest}
      persistModels={persistEditorModels}
      setDebugTab={setDebugTab}
    >
      <DebugHotkeys
        activeFileId={activeFileId}
        cursorLine={cursorPos?.line}
        editorRef={editorRef}
        setQuickOpen={setQuickOpen}
      />
      <BreakpointGutterBinding
        editorRef={editorRef}
        monacoRef={monacoRef}
        editorReady={editorReady}
        activeFileId={activeFileId}
      />
      <BreakpointDecorations
        editorRef={editorRef}
        monacoRef={monacoRef}
        editorReady={editorReady}
        activeFileId={activeFileId}
      />

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
          <EditorPaneContainer
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
              <DebugPanelContainer
                workspaceW={workspaceW}
                outputWidthStyle={outputWidthStyle}
                outputBasisPx={outputBasisPx}
                debugTab={debugTab}
                setDebugTab={setDebugTab}
                toggleOutputCollapsed={toggleOutputCollapsed}
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
    </DebugProvider>
  )
}


function DebugHotkeys({ activeFileId, cursorLine, editorRef, setQuickOpen }) {
  const { running, runDebugSession, stopDebugSession, toggleBreakpoint } = useDebugContext()
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (running) {
          stopDebugSession()
        } else {
          runDebugSession()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setQuickOpen(true)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const ed = editorRef.current
        if (ed) {
          e.preventDefault()
          ed.getAction('actions.find')?.run()
        }
        return
      }
      if (e.key === 'F9') {
        e.preventDefault()
        toggleBreakpoint(activeFileId, cursorLine || 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFileId, cursorLine, editorRef, running, runDebugSession, stopDebugSession, toggleBreakpoint, setQuickOpen])
  return null
}

function BreakpointGutterBinding({ editorRef, monacoRef, editorReady, activeFileId }) {
  const { toggleBreakpoint } = useDebugContext()
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
        if (lineNumber) toggleBreakpoint(activeFileId, lineNumber)
      }
    })
    return () => disposable.dispose()
  }, [editorReady, editorRef, monacoRef, activeFileId, toggleBreakpoint])
  return null
}

function BreakpointDecorations({ editorRef, monacoRef, editorReady, activeFileId }) {
  const { breakpoints, pausedLocation } = useDebugContext()
  const bpDecorRef = useRef([])
  const pausedDecorRef = useRef([])

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
    bpDecorRef.current = editor.deltaDecorations(bpDecorRef.current, activeDecorations)
  }, [breakpoints, activeFileId, editorReady, editorRef, monacoRef])

  useEffect(() => {
    if (!editorReady) return
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const sameFile = pausedLocation?.fileId && pausedLocation.fileId === activeFileId
    if (!pausedLocation || !sameFile) {
      pausedDecorRef.current = editor.deltaDecorations(pausedDecorRef.current, [])
      return
    }
    const decorations = [{
      range: new monaco.Range(pausedLocation.line, 1, pausedLocation.line, 1),
      options: {
        isWholeLine: true,
        className: 'oc-editor-line-paused',
        glyphMarginClassName: 'oc-editor-glyph-paused',
      },
    }]
    pausedDecorRef.current = editor.deltaDecorations(pausedDecorRef.current, decorations)
  }, [pausedLocation, activeFileId, editorReady, editorRef, monacoRef])

  return null
}

function EditorPaneContainer(props) {
  const { pausedLocation, sessionPhase } = useDebugContext()
  return (
    <EditorPane
      {...props}
      pausedLocation={pausedLocation}
      sessionPhase={sessionPhase}
    />
  )
}

function DebugPanelContainer(props) {
  const {
    breakpoints,
    clearBreakpoints,
    removeBreakpoint,
    running,
    stopDebugSession,
    runDebugSession,
    continueExecution,
    stepOver,
    stepIn,
    stepOut,
    outputLog,
    onClearOutput,
    stdinLine,
    setStdinLine,
    sendStdin,
    waitingForInput,
    stackFrames,
    localsView,
    pausedLocation,
    sessionPhase,
    statusMessage,
    exceptionInfo,
    awaitingPrompt,
  } = useDebugContext()

  return (
    <DebugPanel
      {...props}
      running={running}
      stopDebugSession={stopDebugSession}
      runProgram={runDebugSession}
      clearBreakpoints={clearBreakpoints}
      toggleOutputCollapsed={props.toggleOutputCollapsed}
      breakpoints={breakpoints}
      removeBreakpoint={removeBreakpoint}
      outputLog={outputLog}
      onClearOutput={onClearOutput}
      stdinLine={stdinLine}
      setStdinLine={setStdinLine}
      sendStdin={sendStdin}
      waitingForInput={waitingForInput}
      onContinue={continueExecution}
      onStepOver={stepOver}
      onStepIn={stepIn}
      onStepOut={stepOut}
      stackFrames={stackFrames}
      localsView={localsView}
      pausedLocation={pausedLocation}
      sessionPhase={sessionPhase}
      statusMessage={statusMessage}
      exceptionInfo={exceptionInfo}
      awaitingPrompt={awaitingPrompt}
    />
  )
}
