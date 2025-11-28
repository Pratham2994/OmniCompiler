import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const DebugContext = createContext(null)

const DEFAULT_CONSOLE = [{ kind: 'log', text: 'Welcome to Debug Console.' }]
const BP_STORAGE_KEY = 'oc_debug_breakpoints_v2'
const MAX_BREAKPOINTS = 128

const nowTime = () => {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const canonicalizeDebuggerPath = (value = '') => {
  if (!value) return ''
  let normalized = value.replace(/\\/g, '/').trim()
  if (normalized.startsWith('/work/')) normalized = normalized.slice('/work/'.length)
  if (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (normalized.startsWith('../')) normalized = normalized.replace(/^\.\.\//, '')
  if (normalized.startsWith('/')) normalized = normalized.slice(1)
  return normalized
}

const shortName = (value = '') => {
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

const normalizeLf = (value = '') => String(value ?? '').replace(/\r\n?/g, '\n')

const buildMetaMaps = (fileMetas = []) => {
  const byId = new Map()
  const byPath = new Map()
  for (const meta of fileMetas) {
    if (!meta?.fileId) continue
    byId.set(meta.fileId, meta)
    if (!meta.filePath) continue
    const normalized = canonicalizeDebuggerPath(meta.filePath)
    const variants = new Set([
      meta.filePath,
      normalized,
      `/work/${normalized}`,
      `./${normalized}`,
      normalized.replace(/\\/g, '/'),
    ])
    variants.forEach((variant) => {
      const forward = variant.replace(/\\/g, '/')
      const backward = variant.replace(/\//g, '\\')
      byPath.set(forward, meta)
      byPath.set(backward, meta)
    })
  }
  return { byId, byPath }
}

const createBreakpointRecord = (fileId, line, metaLookup, condition = '') => {
  if (!fileId) return null
  const meta = metaLookup.get(fileId)
  if (!meta) return null
  const ln = Math.max(1, parseInt(line, 10) || 1)
  return {
    id: `${fileId}:${ln}`,
    fileId,
    fileName: meta.fileName,
    filePath: meta.filePath,
    line: ln,
    condition: condition || '',
  }
}

const loadStoredBreakpoints = (metaLookup) => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(BP_STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    const hydrated = []
    for (const entry of data) {
      const record = createBreakpointRecord(entry?.fileId, entry?.line, metaLookup, entry?.condition)
      if (record) hydrated.push(record)
      if (hydrated.length >= MAX_BREAKPOINTS) break
    }
    return hydrated
  } catch {
    return []
  }
}

const useLatestRef = (value) => {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

export function DebugProvider({
  children,
  apiBase,
  fileMetas = [],
  activeFileId,
  buildDebugRunRequest,
  persistModels,
  setDebugTab,
}) {
  const baseUrl = useMemo(() => {
    const fallback = apiBase || 'http://localhost:8000'
    return fallback.endsWith('/') ? fallback.slice(0, -1) : fallback
  }, [apiBase])

  const metaMaps = useMemo(() => buildMetaMaps(fileMetas), [fileMetas])
  const metaMapsRef = useLatestRef(metaMaps)

  const storedBreakpointsRef = useRef(loadStoredBreakpoints(metaMaps.byId))
  const [breakpoints, setBreakpoints] = useState(storedBreakpointsRef.current)
  const breakpointsRef = useLatestRef(breakpoints)
  const [outputLog, setOutputLog] = useState(DEFAULT_CONSOLE)
  const [stdinLine, setStdinLine] = useState('')
  const [waitingForInput, setWaitingForInput] = useState(false)
  const waitingForInputRef = useLatestRef(waitingForInput)
  const [running, setRunning] = useState(false)
  const [sessionPhase, setSessionPhase] = useState('idle')
  const [statusMessage, setStatusMessage] = useState('Idle')
  const [stackFrames, setStackFrames] = useState([])
  const [localsView, setLocalsView] = useState([])
  const [pausedLocation, setPausedLocation] = useState(null)
  const [exceptionInfo, setExceptionInfo] = useState(null)
  const [awaitingPrompt, setAwaitingPrompt] = useState('')
  const [autoBreakpointsBusy, setAutoBreakpointsBusy] = useState(false)
  const [autoBreakpointStatus, setAutoBreakpointStatus] = useState({ kind: 'idle', message: '' })

  const wsRef = useRef(null)
  const sessionSettledRef = useRef({ phase: 'idle', status: 'Idle' })
  const activeFileIdRef = useLatestRef(activeFileId)
  const buildDebugRunRequestRef = useLatestRef(buildDebugRunRequest)
  const persistModelsRef = useLatestRef(persistModels)
  const setDebugTabRef = useLatestRef(setDebugTab)
  const lastSyncedBreakpointsRef = useRef(new Map())
  const runningRef = useLatestRef(running)

  useEffect(() => {
    setBreakpoints((prev) =>
      prev
        .map((bp) => createBreakpointRecord(bp.fileId, bp.line, metaMaps.byId, bp.condition))
        .filter(Boolean)
        .slice(0, MAX_BREAKPOINTS),
    )
  }, [metaMaps])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const payload = breakpoints.map((bp) => ({ fileId: bp.fileId, line: bp.line, condition: bp.condition || '' }))
      window.localStorage.setItem(BP_STORAGE_KEY, JSON.stringify(payload))
    } catch {
    }
  }, [breakpoints])

  const appendLog = useCallback((kind, text) => {
    setOutputLog((prev) => [...prev, { kind, text }])
  }, [])

  const appendStatusLog = useCallback(
    (text) => {
      appendLog('log', `[${nowTime()}] ${text}`)
    },
    [appendLog],
  )

  const mapToCanonicalList = useCallback((list) => {
    const canonical = []
    for (const bp of list) {
      if (!bp?.filePath || !bp?.line) continue
      canonical.push({
        key: `${bp.filePath}:${bp.line}`,
        file: bp.filePath,
        line: bp.line,
      })
    }
    return canonical
  }, [])

  const canonicalBreakpointList = useMemo(() => mapToCanonicalList(breakpoints), [breakpoints, mapToCanonicalList])
  const getCanonicalBreakpoints = useCallback(
    () => mapToCanonicalList(breakpointsRef.current || []),
    [mapToCanonicalList],
  )

  const resolveMetaFromPath = useCallback((rawPath) => {
    if (!rawPath) return null
    const maps = metaMapsRef.current
    if (!maps) return null
    const normalized = canonicalizeDebuggerPath(rawPath)
    return (
      maps.byPath.get(rawPath) ||
      maps.byPath.get(rawPath.replace(/\\/g, '/')) ||
      maps.byPath.get(rawPath.replace(/\//g, '\\')) ||
      maps.byPath.get(normalized) ||
      null
    )
  }, [metaMapsRef])

  const recordFromCoords = useCallback(
    (fileId, line) => createBreakpointRecord(fileId, line, metaMapsRef.current?.byId || new Map()),
    [metaMapsRef],
  )

  const addBreakpoint = useCallback(
    (fileId, line, condition = '') => {
      if (!fileId) return
      setBreakpoints((prev) => {
        if (prev.length >= MAX_BREAKPOINTS) return prev
        const exists = prev.some((bp) => bp.fileId === fileId && bp.line === line)
        if (exists) return prev
        const record = recordFromCoords(fileId, line)
        if (!record) return prev
        const next = [...prev, { ...record, condition }]
        return next
      })
    },
    [recordFromCoords],
  )

  const removeBreakpoint = useCallback((target) => {
    setBreakpoints((prev) => prev.filter((bp) => bp.id !== target && !(target?.fileId && bp.fileId === target.fileId && bp.line === target.line)))
  }, [])

  const toggleBreakpoint = useCallback(
    (fileId, maybeLine) => {
      const targetFileId = fileId || activeFileIdRef.current
      if (!targetFileId) return
      const line = Math.max(1, Number(maybeLine) || 1)
      const id = `${targetFileId}:${line}`
      setBreakpoints((prev) => {
        const exists = prev.some((bp) => bp.id === id)
        if (exists) {
          return prev.filter((bp) => bp.id !== id)
        }
        if (prev.length >= MAX_BREAKPOINTS) return prev
        const record = recordFromCoords(targetFileId, line)
        if (!record) return prev
        return [...prev, record]
      })
    },
    [activeFileIdRef, recordFromCoords],
  )

  const clearBreakpoints = useCallback(() => {
    setBreakpoints([])
    lastSyncedBreakpointsRef.current = new Map()
  }, [])

  const generateAutoBreakpoints = useCallback(async () => {
    if (autoBreakpointsBusy) return

    const buildRequest = buildDebugRunRequestRef.current
    if (typeof buildRequest !== 'function') {
      setAutoBreakpointStatus({ kind: 'error', message: 'Debugger is not ready to build files.' })
      return
    }

    try {
      persistModelsRef.current?.()
    } catch {
    }

    const payload = buildRequest()
    if (!payload) {
      setAutoBreakpointStatus({ kind: 'error', message: 'Unable to collect files for analysis.' })
      return
    }

    const lang = String(payload.lang || '').toLowerCase()
    if (!lang || lang === 'plaintext') {
      setAutoBreakpointStatus({ kind: 'error', message: 'Select a supported language before generating breakpoints.' })
      return
    }

    const files = Array.isArray(payload.files) ? payload.files.slice(0, 5) : []
    if (!files.length) {
      setAutoBreakpointStatus({ kind: 'error', message: 'Add at least one file before requesting auto-breakpoints.' })
      return
    }

    setAutoBreakpointsBusy(true)
    setAutoBreakpointStatus({ kind: 'running', message: 'Predicting breakpoint candidates…' })
    setDebugTabRef.current?.('bpvars')

    const fileIdLookup = new Map()
    const registerMeta = (rawName) => {
      if (!rawName) return
      const trimmed = String(rawName).trim()
      if (!trimmed) return
      let meta = resolveMetaFromPath(trimmed)
      if (!meta) meta = resolveMetaFromPath(shortName(trimmed))
      if (!meta) {
        const maps = metaMapsRef.current
        if (maps) {
          for (const entry of maps.byId.values()) {
            if (entry?.fileName && entry.fileName === shortName(trimmed)) {
              meta = entry
              break
            }
          }
        }
      }
      if (meta?.fileId) {
        fileIdLookup.set(trimmed, meta.fileId)
        fileIdLookup.set(meta.filePath, meta.fileId)
        fileIdLookup.set(meta.fileName, meta.fileId)
      }
    }

    const requestFiles = files.map((file) => {
      const name = String(file?.name || '').trim()
      registerMeta(name)
      return {
        name,
        content: normalizeLf(String(file?.content || '')),
      }
    })

    try {
      const res = await fetch(`${baseUrl}/breakpoints/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, files: requestFiles }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const suggestions = Array.isArray(data?.breakpoints) ? data.breakpoints : []
      let inserted = 0
      const findFileId = (raw) => {
        if (!raw) return null
        const trimmed = String(raw).trim()
        if (!trimmed) return null
        const normalized = trimmed.replace(/\\/g, '/')
        const reversed = normalized.replace(/\//g, '\\')
        return (
          fileIdLookup.get(trimmed) ||
          fileIdLookup.get(normalized) ||
          fileIdLookup.get(reversed) ||
          fileIdLookup.get(shortName(trimmed))
        )
      }
      for (const suggestion of suggestions) {
        const fileId = findFileId(suggestion?.file)
        if (!fileId) continue
        const lineNo = Math.max(1, parseInt(suggestion?.line, 10) || 1)
        const exists = (breakpointsRef.current || []).some((bp) => bp.fileId === fileId && bp.line === lineNo)
        if (exists) continue
        addBreakpoint(fileId, lineNo)
        inserted += 1
      }
      if (inserted > 0) {
        setAutoBreakpointStatus({ kind: 'success', message: `Added ${inserted} breakpoint${inserted === 1 ? '' : 's'} from the model.` })
      } else if (suggestions.length === 0) {
        setAutoBreakpointStatus({ kind: 'empty', message: 'Model did not return confident breakpoint candidates.' })
      } else {
        setAutoBreakpointStatus({ kind: 'empty', message: 'All suggested breakpoints already existed.' })
      }
      appendStatusLog(`Auto-breakpoint generation completed (${inserted} new).`)
    } catch (err) {
      const message = err?.message || 'Auto-breakpoint request failed.'
      setAutoBreakpointStatus({ kind: 'error', message })
      appendStatusLog(`Auto-breakpoint error: ${message}`)
    } finally {
      setAutoBreakpointsBusy(false)
    }
  }, [addBreakpoint, appendStatusLog, autoBreakpointsBusy, baseUrl, breakpointsRef, buildDebugRunRequestRef, metaMapsRef, persistModelsRef, resolveMetaFromPath, setDebugTabRef])

  const onClearOutput = useCallback(() => setOutputLog([]), [])

  const sendDebugCommand = useCallback((command, payload = {}) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify({ type: 'debug_cmd', command, ...payload }))
      return true
    } catch {
      return false
    }
  }, [])

  const finalizeSession = useCallback((phase = 'idle', status = 'Idle') => {
    sessionSettledRef.current = { phase, status }
    setRunning(false)
    setWaitingForInput(false)
    setSessionPhase(phase)
    setStatusMessage(status)
    setPausedLocation(null)
    setStackFrames([])
    setLocalsView([])
    setExceptionInfo(null)
    setAwaitingPrompt('')
    lastSyncedBreakpointsRef.current = new Map()
  }, [])

  const handlePausedPayload = useCallback((payload) => {
    const meta = resolveMetaFromPath(payload?.file)
    const location = {
      file: meta?.filePath || canonicalizeDebuggerPath(payload?.file) || payload?.file || '',
      fileName: meta?.fileName || shortName(payload?.file),
      fileId: meta?.fileId || null,
      line: payload?.line || null,
      functionName: payload?.function || null,
    }
    const rawStack = Array.isArray(payload?.stack) ? payload.stack : []
    const normalizedStack = rawStack.map((frame) => {
      const frameMeta = resolveMetaFromPath(frame?.file)
      return {
        file: frameMeta?.filePath || canonicalizeDebuggerPath(frame?.file) || frame?.file || '',
        fileName: frameMeta?.fileName || shortName(frame?.file),
        fileId: frameMeta?.fileId || null,
        line: frame?.line || null,
        functionName: frame?.function || frame?.func || '',
      }
    })
    const localsPayload = payload?.locals || {}
    const localsEntries = Object.entries(localsPayload).map(([name, value]) => ({ name, value }))

    setPausedLocation(location)
    setStackFrames(normalizedStack)
    setLocalsView(localsEntries)
    setSessionPhase('paused')
    setStatusMessage('Paused')
    appendStatusLog(`Paused at ${location.fileName || location.file}:${location.line ?? '?'}${location.functionName ? ` (${location.functionName})` : ''}`)
  }, [appendStatusLog, resolveMetaFromPath])

  const runDebugSession = useCallback(async () => {
    if (running) {
      appendStatusLog('Debug session already running.')
      return
    }
    try {
      persistModelsRef.current?.()
    } catch {
    }
    const buildRequest = buildDebugRunRequestRef.current
    if (typeof buildRequest !== 'function') {
      appendStatusLog('Debug runner not ready.')
      return
    }
    const payload = buildRequest()
    if (!payload) {
      appendStatusLog('Unable to build debug payload.')
      return
    }
    const lang = String(payload.lang || '').toLowerCase()
    if (!lang || lang === 'plaintext') {
      appendStatusLog('Select a supported language before debugging.')
      return
    }

    payload.mode = 'debug'
    const initialBreakpoints = getCanonicalBreakpoints()
    payload.breakpoints = initialBreakpoints.map((bp) => ({ file: bp.file, line: bp.line }))

    setDebugTabRef.current?.('output')
    setWaitingForInput(false)
    setRunning(true)
    setSessionPhase('starting')
    setStatusMessage('Connecting…')
    sessionSettledRef.current = { phase: 'starting', status: 'Connecting…' }
    setStackFrames([])
    setLocalsView([])
    setPausedLocation(null)
    setExceptionInfo(null)
    appendStatusLog(`Starting debug run (lang=${payload.lang}, entry=${payload.entry})…`)

    try {
      const res = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const url = data?.ws_url
      if (!url) throw new Error('Missing ws_url in /run response')
      appendStatusLog(`Session ${data.session_id} created. Connecting WS…`)

      const snapshot = new Map()
      initialBreakpoints.forEach((bp) => {
        snapshot.set(bp.key, { file: bp.file, line: bp.line })
      })
      lastSyncedBreakpointsRef.current = snapshot

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        appendStatusLog('WebSocket connected.')
        setStatusMessage('Running')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (!msg) return
          if (msg.type === 'out' || msg.type === 'err') {
            const dataStr = String(msg.data ?? '')
            appendLog(msg.type === 'err' ? 'err' : 'out', dataStr.length ? dataStr : '(empty)')
            if (msg.type === 'out') {
              const seemsPrompt = dataStr.length > 0 && !dataStr.endsWith('\n')
              if (seemsPrompt) setWaitingForInput(true)
            }
            return
          }
          if (msg.type === 'status') {
            const phase = msg.phase || msg.data || 'status'
            setStatusMessage(phase)
            if (msg.phase) setSessionPhase(msg.phase)
            if (msg.data === 'exited') {
              appendStatusLog(`Status: ${phase}`)
              finalizeSession('terminated', 'Exited')
              try { wsRef.current?.close() } catch {}
              return
            }
            appendStatusLog(`Status: ${phase}`)
            return
          }
          if (msg.type === 'awaiting_input') {
            const awaiting = Boolean(msg.value)
            setWaitingForInput(awaiting)
            setAwaitingPrompt(awaiting ? (msg.prompt || '') : '')
            if (awaiting) {
              setSessionPhase('awaiting_input')
              setStatusMessage('Awaiting input')
            } else if (runningRef.current) {
              setSessionPhase('running')
            }
            return
          }
          if (msg.type === 'debug_event') {
            if (msg.event === 'paused') {
              setWaitingForInput(false)
              handlePausedPayload(msg.payload || {})
            } else if (msg.event === 'exception') {
              setExceptionInfo(msg.payload || {})
              setSessionPhase('paused')
              appendStatusLog(`Exception: ${msg.payload?.message || 'Unhandled exception'}`)
            } else if (msg.event === 'breakpoints' && msg.payload?.synced) {
              appendStatusLog('Breakpoints synced with debugger.')
            } else if (msg.event === 'evaluate_result') {
              appendLog('log', `[eval] ${msg.payload?.expr ?? ''} => ${msg.payload?.value ?? msg.payload?.error ?? ''}`)
            }
            return
          }
          if (msg.type === 'exit') {
            appendStatusLog(`Exit code: ${msg.code}`)
            finalizeSession('terminated', 'Exited')
            try { wsRef.current?.close() } catch {}
            return
          }
          appendLog('log', `[msg] ${JSON.stringify(msg)}`)
        } catch (err) {
          appendLog('err', `[parse-error] ${err?.message || err}`)
        }
      }

      ws.onerror = () => {
        appendStatusLog('WebSocket error')
      }

      ws.onclose = (event) => {
        if (runningRef.current) {
          appendStatusLog(`WebSocket closed (code=${event?.code ?? 'n/a'})`)
        }
        if (sessionSettledRef.current.phase !== 'terminated') {
          finalizeSession('idle', 'Idle')
        }
        wsRef.current = null
      }
    } catch (err) {
      appendStatusLog(`Run error: ${err?.message || String(err)}`)
      finalizeSession('idle', 'Idle')
      wsRef.current = null
    }
  }, [appendLog, appendStatusLog, baseUrl, finalizeSession, running])

  const stopDebugSession = useCallback(() => {
    setWaitingForInput(false)
    if (sendDebugCommand('stop')) {
      appendStatusLog('Stop requested')
      setStatusMessage('Stopping…')
    } else {
      finalizeSession('idle', 'Idle')
      try {
        wsRef.current?.close()
      } catch {
      }
      wsRef.current = null
    }
  }, [appendStatusLog, finalizeSession, sendDebugCommand])

  const continueExecution = useCallback(() => {
    if (sendDebugCommand('continue')) {
      setSessionPhase('running')
      setStatusMessage('Running')
      setWaitingForInput(false)
    }
  }, [sendDebugCommand])

  const stepOver = useCallback(() => {
    if (sendDebugCommand('next')) {
      setSessionPhase('running')
      setStatusMessage('Stepping over…')
    }
  }, [sendDebugCommand])

  const stepIn = useCallback(() => {
    if (sendDebugCommand('step_in')) {
      setSessionPhase('running')
      setStatusMessage('Stepping in…')
    }
  }, [sendDebugCommand])

  const stepOut = useCallback(() => {
    if (sendDebugCommand('step_out')) {
      setSessionPhase('running')
      setStatusMessage('Stepping out…')
    }
  }, [sendDebugCommand])

  const sendStdin = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!stdinLine || !waitingForInputRef.current) return
    const data = stdinLine.endsWith('\n') ? stdinLine : `${stdinLine}\n`
    try {
      ws.send(JSON.stringify({ type: 'stdin', data }))
      appendLog('in', data)
    } catch {
      appendLog('err', 'stdin send failed')
    }
    setStdinLine('')
    setWaitingForInput(false)
    setAwaitingPrompt('')
  }, [appendLog, stdinLine, waitingForInputRef])

  useEffect(() => () => {
    try {
      wsRef.current?.close()
    } catch {
    }
  }, [])

  useEffect(() => {
    const ws = wsRef.current
    if (!running || !ws || ws.readyState !== WebSocket.OPEN) {
      const snapshot = new Map()
      canonicalBreakpointList.forEach((bp) => snapshot.set(bp.key, { file: bp.file, line: bp.line }))
      lastSyncedBreakpointsRef.current = snapshot
      return
    }
    const prev = lastSyncedBreakpointsRef.current || new Map()
    const next = new Map()
    canonicalBreakpointList.forEach((bp) => next.set(bp.key, { file: bp.file, line: bp.line }))

    for (const [key, value] of next.entries()) {
      if (!prev.has(key)) sendDebugCommand('add_breakpoint', value)
    }
    for (const [key, value] of prev.entries()) {
      if (!next.has(key)) sendDebugCommand('remove_breakpoint', value)
    }

    lastSyncedBreakpointsRef.current = next
  }, [canonicalBreakpointList, running, sendDebugCommand])

  const value = useMemo(() => ({
    breakpoints,
    addBreakpoint,
    removeBreakpoint,
    toggleBreakpoint,
    clearBreakpoints,
    outputLog,
    running,
    waitingForInput,
    stdinLine,
    setStdinLine,
    runDebugSession,
    stopDebugSession,
    onClearOutput,
    sendStdin,
    continueExecution,
    stepOver,
    stepIn,
    stepOut,
    stackFrames,
    localsView,
    pausedLocation,
    sessionPhase,
    statusMessage,
    exceptionInfo,
    awaitingPrompt,
    autoBreakpointsBusy,
    autoBreakpointStatus,
    generateAutoBreakpoints,
  }), [
    addBreakpoint,
    autoBreakpointStatus,
    autoBreakpointsBusy,
    awaitingPrompt,
    breakpoints,
    clearBreakpoints,
    continueExecution,
    exceptionInfo,
    generateAutoBreakpoints,
    localsView,
    onClearOutput,
    outputLog,
    pausedLocation,
    removeBreakpoint,
    runDebugSession,
    running,
    sendStdin,
    sessionPhase,
    statusMessage,
    stepIn,
    stepOut,
    stepOver,
    stdinLine,
    stopDebugSession,
    toggleBreakpoint,
    waitingForInput,
    stackFrames,
  ])

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
}

export function useDebugContext() {
  const ctx = useContext(DebugContext)
  if (!ctx) throw new Error('useDebugContext must be used within a DebugProvider')
  return ctx
}
