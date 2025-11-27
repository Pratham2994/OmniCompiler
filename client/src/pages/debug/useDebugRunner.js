import { useEffect, useRef, useState } from 'react'

const nowTime = () => {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function useDebugRunner({
  apiBase,
  getEffectiveLanguage,
  activeFileId,
  activeFile,
  editorRef,
  setFiles,
  buildDebugRunRequest,
  setDebugTab,
  triggerToast,
}) {
  const [outputLog, setOutputLog] = useState([{ kind: 'log', text: 'Welcome to Debug Console.' }])
  const [running, setRunning] = useState(false)
  const wsRef = useRef(null)
  const [stdinLine, setStdinLine] = useState('')
  const [waitingForInput, setWaitingForInput] = useState(false)

  const stopDebugSession = () => {
    if (!running) return
    try {
      wsRef.current?.send(JSON.stringify({ type: 'close' }))
    } catch {}
    setOutputLog(prev => [...prev, { kind: 'log', text: `[${nowTime()}] Stop requested` }])
    setWaitingForInput(false)
  }

  const runProgram = async () => {
    if (running) return
    setRunning(true)
    setWaitingForInput(false)
    setDebugTab('output')
    const ts = nowTime()

    const effLang = getEffectiveLanguage(activeFileId) || 'plaintext'
    if (effLang === 'plaintext') {
      setRunning(false)
      setOutputLog(prev => [...prev, { kind: 'log', text: `[${ts}] Language is Plain Text. Choose Python, JavaScript, Java, C++, or Go, then run.` }])
      try { triggerToast && triggerToast('Select a programming language first') } catch {}
      return
    }

    const ed = editorRef.current
    const model = ed?.getModel()
    if (model && activeFileId) {
      const val = model.getValue()
      setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, content: val } : f))
    }

    if (wsRef.current) {
      try { wsRef.current.close() } catch {}
      wsRef.current = null
    }

    try {
      const body = buildDebugRunRequest()
      setOutputLog(prev => [...prev, { kind: 'log', text: `[${ts}] Starting debug run (lang=${body.lang}, entry=${body.entry})...` }])

      const res = await fetch(`${apiBase}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const url = data?.ws_url
      if (!url) throw new Error('ws_url missing from /run response')
      setOutputLog(prev => [
        ...prev,
        { kind: 'log', text: `[${nowTime()}] Session ${data.session_id} created. Connecting...` },
        { kind: 'log', text: `[${nowTime()}] WS URL: ${url}` }
      ])

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setWaitingForInput(false)
        setOutputLog(prev => [...prev, { kind: 'log', text: `[${nowTime()}] WebSocket connected.` }])
      }
      ws.onmessage = (ev) => {
        const raw = ev?.data
        let msg = null
        try {
          msg = JSON.parse(raw)
        } catch {
          msg = null
        }

        if (!msg) {
          setOutputLog(prev => [...prev, { kind: 'log', text: `[raw] ${String(raw ?? '')}` }])
          return
        }

        try {
          if (msg?.type === 'out' || msg?.type === 'err') {
            const dataStr = String(msg.data ?? '')
            const finalStr = dataStr.length ? dataStr : '(empty)'
            setOutputLog(prev => [...prev, { kind: (msg.type === 'err' ? 'err' : 'out'), text: finalStr }])
            if (msg.type === 'out') {
              const seemsPrompt = dataStr.length > 0 && !dataStr.endsWith('\n')
              setWaitingForInput(seemsPrompt)
            }

            if (msg.type === 'err' && typeof msg.data === 'string' && /invalid session_id/i.test(msg.data)) {
              setOutputLog(prev => [
                ...prev,
                { kind: 'log', text: '[hint] Session was invalid. This can happen if the server restarted after creating the session. Try running again.' }
              ])
            }
          } else if (msg?.type === 'status') {
            setOutputLog(prev => [...prev, { kind: 'log', text: `[${nowTime()}] ${msg.phase || 'status'}` }])
          } else if (msg?.type === 'awaiting_input') {
            setWaitingForInput(Boolean(msg.value))
          } else if (msg?.type === 'exit') {
            setOutputLog(prev => [...prev, { kind: 'log', text: `[${nowTime()}] Exit code: ${msg.code}` }])
            setRunning(false)
            setWaitingForInput(false)
            try { ws.close() } catch {}
            wsRef.current = null
          } else {
            setOutputLog(prev => [...prev, { kind: 'log', text: `[msg] ${JSON.stringify(msg)}` }])
          }
        } catch (e) {
          setOutputLog(prev => [...prev, { kind: 'err', text: `[parse-error] ${String(e?.message || e)}` }])
        }
      }
      ws.onerror = () => {
        setOutputLog(prev => [...prev, { kind: 'log', text: `[${nowTime()}] WebSocket error` }])
        setWaitingForInput(false)
      }
      ws.onclose = (e) => {
        const code = e?.code != null ? e.code : 'n/a'
        const reason = e?.reason ? `, reason=${e.reason}` : ''
        setOutputLog(prev => [...prev, { kind: 'log', text: `[${nowTime()}] WebSocket closed (code=${code}${reason})` }])
        setRunning(false)
        setWaitingForInput(false)
        wsRef.current = null
      }
    } catch (e) {
      setOutputLog(prev => [...prev, { kind: 'err', text: `Run error: ${e?.message || String(e)}` }])
      setRunning(false)
    }
  }

  const onClearOutput = () => {
    setOutputLog([])
  }

  const sendStdin = () => {
    if (!(wsRef.current && running && waitingForInput)) return
    if (!stdinLine) return
    const data = stdinLine.endsWith('\n') ? stdinLine : (stdinLine + '\n')
    try { wsRef.current.send(JSON.stringify({ type: 'in', data })) } catch {}
    setOutputLog(prev => [...prev, { kind: 'in', text: data }])
    setStdinLine('')
    setWaitingForInput(false)
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close() } catch {}
        wsRef.current = null
      }
    }
  }, [])

  return {
    outputLog,
    running,
    stdinLine,
    setStdinLine,
    waitingForInput,
    runProgram,
    stopDebugSession,
    onClearOutput,
    sendStdin,
  }
}

