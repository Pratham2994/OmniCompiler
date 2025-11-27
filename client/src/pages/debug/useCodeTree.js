import { useEffect, useState } from 'react'
import { materializeCfgTree } from './executionTrace.js'
import { extForLang } from './parseTrees.js'
import { normalizeFileReference } from './traceUtils.js'

export default function useCodeTree({
  files,
  activeFile,
  activeFileId,
  effectiveLanguage,
  getEffectiveLanguage,
  setActiveFileId,
  apiBase,
  getActiveCode,
  languageLabel,
  buildCfgRequest,
  editorRef,
  nameWithExt,
}) {
  const [treeNodes, setTreeNodes] = useState([])
  const [treeStatus, setTreeStatus] = useState('idle')
  const [treeMessage, setTreeMessage] = useState(
    effectiveLanguage === 'plaintext' ? 'Select or detect a language before generating a tree.' : 'Tree not generated yet. Use "Generate Tree" when you are ready.'
  )
  const [treeBusy, setTreeBusy] = useState(false)
  const [treeWarnings, setTreeWarnings] = useState([])

  useEffect(() => {
    setTreeNodes([])
    setTreeStatus('idle')
    setTreeBusy(false)
    setTreeMessage(effectiveLanguage === 'plaintext'
      ? 'Select or detect a language before generating a tree.'
      : 'Tree not generated yet. Use "Generate Tree" when you are ready.')
    setTreeWarnings([])
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

  const generateTree = async () => {
    const langId = (effectiveLanguage || '').toLowerCase()
    if (!activeFileId || !activeFile) {
      setTreeStatus('error')
      setTreeNodes([])
      setTreeMessage('Add a file before generating a tree.')
      return
    }
    if (!langId || langId === 'plaintext') {
      setTreeStatus('error')
      setTreeNodes([])
      setTreeMessage('Select or detect a language before generating a tree.')
      return
    }
    const src = getActiveCode()
    if (!src.trim()) {
      setTreeStatus('error')
      setTreeNodes([])
      setTreeMessage('Add some code to the active file before generating a tree.')
      return
    }

    setTreeBusy(true)
    setTreeWarnings([])
    setTreeStatus('loading')
    setTreeMessage('Generating tree from backend...')
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

      const tree = materializeCfgTree(data.nodes || [])
      setTreeNodes(tree)
      setTreeWarnings(Array.isArray(data.warnings) ? data.warnings : [])

      if (!tree.length || tree.every(g => !g.nodes || g.nodes.length === 0)) {
        setTreeStatus('empty')
        setTreeMessage(`No symbols found in ${activeFile.name}.${extForLang(langId)}. Add functions or classes, then try again.`)
      } else {
        setTreeStatus('ready')
        const langLabel = languageLabel(langId)
        const entryName = data.entry || `${activeFile.name}.${extForLang(langId)}`
        setTreeMessage(`Generated (${langLabel}) for ${entryName}. Click a node to jump to its file and line.`)
      }
    } catch (err) {
      setTreeStatus('error')
      setTreeNodes([])
      setTreeWarnings([])
      setTreeMessage(err?.message ? `Tree error: ${err.message}` : 'Failed to build the tree.')
    } finally {
      setTreeBusy(false)
    }
  }

  return {
    treeNodes,
    treeStatus,
    treeMessage,
    treeBusy,
    treeWarnings,
    generateTree,
    jumpToFileAndLine,
  }
}
