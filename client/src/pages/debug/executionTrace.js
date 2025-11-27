import { canonicalStepType, formatFileLabel, normalizeFileReference } from './traceUtils.js'

export const typeColor = (t) => {
  switch (String(t || '').toLowerCase()) {
    case 'function': return 'var(--oc-primary-400)'
    case 'class': return '#eab308'
    case 'method': return '#22d3ee'
    case 'if': return '#f97316'
    case 'for':
    case 'while': return '#a855f7'
    case 'stmt': return '#6b7280'
    default: return 'var(--oc-primary-500)'
  }
}

export const typeLegend = [
  { label: 'Function', type: 'function' },
  { label: 'Class', type: 'class' },
  { label: 'Method', type: 'method' },
  { label: 'If/Else', type: 'if' },
  { label: 'Loop', type: 'for' },
  { label: 'Statement', type: 'stmt' },
]

export const materializeCfgTree = (nodes = []) => {
  const byId = new Map()
  nodes.forEach(n => {
    byId.set(n.id, { ...n, children: [] })
  })
  nodes.forEach(n => {
    const parent = byId.get(n.id)
    if (!parent) return
    (n.children || []).forEach(cid => {
      const child = byId.get(cid)
      if (child) parent.children.push(child)
    })
  })
  const hasParent = new Set()
  nodes.forEach(n => (n.children || []).forEach(cid => hasParent.add(cid)))

  const filesMap = new Map()
  byId.forEach(node => {
    const fname = node.file || 'unknown'
    if (!filesMap.has(fname)) filesMap.set(fname, { file: fname, nodes: [] })
  })
  byId.forEach(node => {
    const fname = node.file || 'unknown'
    if (!hasParent.has(node.id)) {
      const bucket = filesMap.get(fname)
      if (bucket) bucket.nodes.push(node)
    }
  })
  return Array.from(filesMap.values())
    .map(g => ({
      ...g,
      nodes: (g.nodes || []).sort((a, b) => (a.start_line || 0) - (b.start_line || 0)),
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

export const buildExecutionTrace = (cfgGroups = [], filesContent = []) => {
  let stepId = 0

  const indexedFiles = filesContent.map(f => ({
    ...f,
    __keys: normalizeFileReference(f.name),
  }))

  const resolveFileData = (fileName) => {
    if (!fileName) return null
    const keys = normalizeFileReference(fileName)
    return indexedFiles.find(f => (
      f.__keys.loweredFull === keys.loweredFull ||
      f.__keys.loweredBase === keys.loweredBase ||
      f.__keys.loweredBaseNoExt === keys.loweredBaseNoExt
    ))
  }

  const readCodeLine = (fileName, lineNum) => {
    const fileData = resolveFileData(fileName)
    if (!fileData) return ''
    const lines = (fileData.content || '').split(/\r?\n/)
    const idx = Math.max(0, Number(lineNum || 1) - 1)
    const line = lines[idx]
    return line ? line.trim() : ''
  }

  const labelForFile = (fileName, fallback) => {
    const label = formatFileLabel(fileName)
    if (label) return label
    return fallback ? formatFileLabel(fallback) : ''
  }

  const makeStep = (payload) => ({
    ...payload,
    id: `step-${stepId++}`,
  })

  const processNode = (node, depth = 0, currentFunc = null, inheritedFile = null) => {
    if (!node) return []

    const nodeType = String(node.type || 'stmt').toLowerCase()
    const canonicalType = canonicalStepType(nodeType)
    const isCall = nodeType === 'function_call' || nodeType === 'call'
    const isReturn = nodeType === 'return'
    const targetLine = node.start_line || node.line || 1
    const resolvedFile = node.file || inheritedFile
    const fileLabel = labelForFile(resolvedFile, inheritedFile)

    let result = []

    const emit = (payload) => {
      result = [...result, makeStep(payload)]
    }

    if (canonicalType === 'function' && ['function_def', 'function', 'method'].includes(nodeType)) {
      emit({
        type: 'function_def',
        kind: 'function',
        line: targetLine,
        file: resolvedFile,
        fileLabel,
        code: readCodeLine(resolvedFile, targetLine),
        depth,
        func: node.label || node.name,
        isCall: false,
        isReturn: false,
        isLoop: false,
      })

      (node.children || []).forEach(child => {
        result = [...result, ...processNode(child, depth + 1, node.label || node.name, resolvedFile || inheritedFile)]
      })
      return result
    }

    emit({
      type: nodeType,
      kind: canonicalType,
      line: targetLine,
      file: resolvedFile,
      fileLabel,
      code: readCodeLine(resolvedFile, targetLine),
      depth,
      func: currentFunc,
      isCall,
      isReturn,
      isLoop: canonicalType === 'loop',
    })

    if (node.children && node.children.length > 0) {
      const isDecision = ['if', 'else', 'elif', 'switch', 'conditional'].includes(nodeType)

      node.children.forEach((child, idx) => {
        if (isDecision && node.children.length > 1) {
          const branchType = idx === 0 ? 'branch_true' : 'branch_false'
          emit({
            type: branchType,
            kind: canonicalStepType(branchType),
            line: child.start_line || child.line || 1,
            file: child.file || resolvedFile,
            fileLabel: labelForFile(child.file, resolvedFile),
            code: idx === 0 ? '-> True branch' : '-> False branch',
            depth: depth + 1,
            func: currentFunc,
            isCall: false,
            isReturn: false,
            isBranch: true,
            isLoop: false,
          })
        }
        result = [...result, ...processNode(child, depth + 1, currentFunc, resolvedFile || inheritedFile)]
      })
    }

    return result
  }

  return cfgGroups.flatMap(group => {
    const fileLabel = labelForFile(group.file)
    let stepsForFile = [makeStep({
      type: 'entry',
      kind: 'entry',
      line: 1,
      file: group.file,
      fileLabel,
      code: `-> Enter ${fileLabel || group.file}`,
      depth: 0,
      func: null,
      isCall: false,
      isReturn: false,
      isEntry: true,
      isLoop: false,
    })]

    (group.nodes || []).forEach(node => {
      stepsForFile = [...stepsForFile, ...processNode(node, 0, null, group.file)]
    })

    stepsForFile = [...stepsForFile, makeStep({
      type: 'exit',
      kind: 'exit',
      line: 0,
      file: group.file,
      fileLabel,
      code: `-> Exit ${fileLabel || group.file}`,
      depth: 0,
      func: null,
      isCall: false,
      isReturn: false,
      isExit: true,
      isLoop: false,
    })]

    return stepsForFile
  })
}
