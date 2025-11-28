import { useEffect, useState } from 'react'
import { buildExecutionTrace, materializeCfgTree } from './executionTrace.js'
import { extForLang } from './parseTrees.js'
import { normalizeFileReference } from './traceUtils.js'

const TRACE_LANG_MESSAGE = 'Select or detect a language before generating an execution trace.'
const TRACE_DEFAULT_MESSAGE = 'Execution trace not generated yet. Use "Generate Trace" when you are ready.'

export default function useExecutionTrace({
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
}) {
  const [executionTrace, setExecutionTrace] = useState([])
  const [traceStatus, setTraceStatus] = useState('idle')
  const [traceMessage, setTraceMessage] = useState(
    effectiveLanguage === 'plaintext' ? TRACE_LANG_MESSAGE : TRACE_DEFAULT_MESSAGE
  )
  const [traceBusy, setTraceBusy] = useState(false)
  const [traceWarnings, setTraceWarnings] = useState([])
  const [currentStepIndex, setCurrentStepIndex] = useState(-1)

  useEffect(() => {
    setExecutionTrace([])
    setTraceStatus('idle')
    setTraceBusy(false)
    setTraceWarnings([])
    setCurrentStepIndex(-1)
    setTraceMessage(effectiveLanguage === 'plaintext' ? TRACE_LANG_MESSAGE : TRACE_DEFAULT_MESSAGE)
  }, [effectiveLanguage])

  const jumpToLine = (ln) => {
    try {
      const ed = editorRef.current
      if (!ed) return
      const lineNumber = Math.max(1, Number(ln || 1))
      ed.revealLineInCenter(lineNumber)
      ed.setPosition({ lineNumber, column: 1 })
      ed.focus()
    } catch {}
  }

  const findFileIdForName = (fullName = '') => {
    const entryLang = getEffectiveLanguage(activeFileId) || 'plaintext'
    const targetKeys = normalizeFileReference(fullName)
    if (!targetKeys.loweredBase && !targetKeys.loweredFull) return null

    for (const f of files) {
      const candidateNames = [nameWithExt(f, entryLang), f.name]
      const matches = candidateNames.some(name => {
        const keys = normalizeFileReference(name)
        return (
          keys.loweredFull === targetKeys.loweredFull ||
          keys.loweredBase === targetKeys.loweredBase ||
          keys.loweredBaseNoExt === targetKeys.loweredBaseNoExt
        )
      })
      if (matches) {
        return f.id
      }
    }
    return null
  }

  const jumpToFileAndLine = (fileName, ln) => {
    const targetId = findFileIdForName(fileName)
    if (targetId && targetId !== activeFileId) {
      setActiveFileId(targetId)
      setTimeout(() => jumpToLine(ln), 40)
    } else {
      jumpToLine(ln)
    }
  }

  const generateTrace = async () => {
    const langId = (effectiveLanguage || '').toLowerCase()
    if (!activeFileId || !activeFile) {
      setTraceStatus('error')
      setExecutionTrace([])
      setTraceMessage('Add a file before generating an execution trace.')
      return
    }
    if (!langId || langId === 'plaintext') {
      setTraceStatus('error')
      setExecutionTrace([])
      setTraceMessage(TRACE_LANG_MESSAGE)
      return
    }
    const src = getActiveCode()
    if (!src.trim()) {
      setTraceStatus('error')
      setExecutionTrace([])
      setTraceMessage('Add some code to the active file before generating an execution trace.')
      return
    }

    setTraceBusy(true)
    setTraceWarnings([])
    setTraceStatus('loading')
    setTraceMessage('Analyzing code and building execution trace...')
    try {
      const body = buildCfgRequest()
      const res = await fetch(`${apiBase}/cfg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (!data || !Array.isArray(data.nodes)) {
        throw new Error('Malformed /cfg response')
      }

      const cfgGroups = materializeCfgTree(data.nodes || [])
      setTraceWarnings(Array.isArray(data.warnings) ? data.warnings : [])

      const filesContent = files.map(f => ({
        name: nameWithExt(f, langId),
        content: getLiveContent(f),
      }))

      const trace = buildExecutionTrace(cfgGroups, filesContent, langId)
      setExecutionTrace(trace)
      setCurrentStepIndex(-1)

      if (!trace.length) {
        setTraceStatus('empty')
        setTraceMessage(`No execution trace generated. Ensure ${activeFile.name}.${extForLang(langId)} contains executable code.`)
      } else {
        setTraceStatus('ready')
        const entryName = data.entry || `${activeFile.name}.${extForLang(langId)}`
        setTraceMessage(`Generated ${trace.length} execution steps for ${entryName}. Click a step to jump to that line.`)
      }
    } catch (err) {
      setTraceStatus('error')
      setExecutionTrace([])
      setTraceWarnings([])
      setTraceMessage(err?.message ? `Trace error: ${err.message}` : 'Failed to build the execution trace.')
    } finally {
      setTraceBusy(false)
    }
  }

  const handleStepClick = (step, index) => {
    setCurrentStepIndex(index)
    const targetFile = step?.jumpFile || step?.file
    const targetLine = step?.jumpLine || step?.line
    if (targetFile && targetLine && targetLine > 0) {
      jumpToFileAndLine(targetFile, targetLine)
    }
  }

  return {
    executionTrace,
    currentStepIndex,
    traceStatus,
    traceMessage,
    traceBusy,
    traceWarnings,
    generateTrace,
    handleStepClick,
  }
}
