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
    case 'import': return 'var(--oc-trace-import)'
    default: return 'var(--oc-primary-500)'
  }
}

export const typeLegend = [
  { label: 'Class', type: 'class' },
  { label: 'Method', type: 'method' },
  { label: 'If/Else', type: 'if' },
  { label: 'Loop', type: 'for' },
  { label: 'Import', type: 'import' },
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

export const buildExecutionTrace = (cfgGroups = [], filesContent = [], langHint = 'plaintext') => {
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

  const matchWorkspaceFile = (candidates = []) => {
    for (const candidate of candidates) {
      if (!candidate) continue
      const normalized = candidate.toLowerCase()
      const baseNoExt = normalized.replace(/\.[^.]+$/, '')
      const match = indexedFiles.find(f => (
        f.__keys.loweredBase === normalized ||
        f.__keys.loweredBaseNoExt === baseNoExt
      ))
      if (match) return match
    }
    return null
  }

  const findFileForModule = (moduleName) => {
    if (!moduleName) return null
    const lastSegment = String(moduleName).split('.').pop()
    if (!lastSegment) return null
    return matchWorkspaceFile([`${lastSegment}.py`, lastSegment])
  }

  const findFileForModuleRef = (moduleRef) => {
    if (!moduleRef) return null
    const cleaned = String(moduleRef).replace(/['"]/g, '').replace(/^\.\//, '').replace(/^\.\//, '')
    const parts = cleaned.split(/[\\/]/)
    const lastSegment = parts.pop() || cleaned
    const normalized = lastSegment.toLowerCase()
    const baseNoExt = normalized.replace(/\.[^.]+$/, '')
    const candidates = new Set([normalized])
    if (!normalized.includes('.')) {
      ;['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.java', '.cpp', '.cc', '.hpp', '.h'].forEach(ext => candidates.add(`${baseNoExt}${ext}`))
      candidates.add(baseNoExt)
    }
    return matchWorkspaceFile([...candidates])
  }

  const inferLanguageFromFileName = (fileName = '', fallback = 'plaintext') => {
    const lower = String(fileName || '').toLowerCase()
    if (lower.endsWith('.py')) return 'python'
    if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'javascript'
    if (lower.endsWith('.java')) return 'java'
    if (lower.endsWith('.go')) return 'go'
    if (lower.endsWith('.cpp') || lower.endsWith('.hpp') || lower.endsWith('.cc')) return 'cpp'
    return fallback
  }

  const valueForLine = (step) => {
    if (step?.isEntry) return 0
    if (step?.isExit) return Number.POSITIVE_INFINITY
    return typeof step?.line === 'number' ? step.line : Number.POSITIVE_INFINITY
  }

  const insertStepByLine = (steps, step) => {
    for (let i = 0; i < steps.length; i += 1) {
      const existing = steps[i]
      if (existing.file !== step.file) continue
      if (valueForLine(existing) > valueForLine(step)) {
        return [...steps.slice(0, i), step, ...steps.slice(i)]
      }
    }
    const lastIndex = [...steps].reverse().findIndex(s => s.file === step.file)
    if (lastIndex === -1) return [...steps, step]
    const insertIndex = steps.length - lastIndex
    return [...steps.slice(0, insertIndex), step, ...steps.slice(insertIndex)]
  }

  const findPythonSymbolLine = (fileEntry, symbolName) => {
    if (!fileEntry) return 1
    const lines = (fileEntry.content || '').split(/\r?\n/)
    const regex = new RegExp(`^\\s*(?:async\\s+)?(def|class)\\s+${symbolName}\\b`)
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i])) return i + 1
    }
    return 1
  }

  const buildPythonImportAnnotations = (fileName) => {
    const src = resolveFileData(fileName)
    if (!src) return []
    const lines = (src.content || '').split(/\r?\n/)
    const annotations = []
    const moduleEntries = []
    const directEntries = []

    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return

      const importMatch = trimmed.match(/^import\s+([A-Za-z0-9_\.]+)(?:\s+as\s+([A-Za-z0-9_]+))?/i)
      if (importMatch) {
        const module = importMatch[1]
        const alias = importMatch[2] || module.split('.').slice(-1)[0]
        const targetFileEntry = findFileForModule(module)
        const targetFileName = targetFileEntry?.name || null
        const targetFileLabel = targetFileName ? formatFileLabel(targetFileName) : module
        annotations.push({
          type: 'import',
          module,
          alias,
          line: idx + 1,
          code: trimmed,
          targetFileName,
          targetFileLabel,
          jumpLine: targetFileEntry ? 1 : idx + 1,
        })
        moduleEntries.push({
          alias,
          module,
          targetFileEntry,
          targetFileName,
          targetFileLabel,
          declarationLine: idx + 1,
        })
        return
      }

      const fromMatch = trimmed.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+(.+)/i)
      if (fromMatch) {
        const module = fromMatch[1]
        const membersPart = fromMatch[2].split('#')[0]
        const targetFileEntry = findFileForModule(module)
        const targetFileName = targetFileEntry?.name || null
        const targetFileLabel = targetFileName ? formatFileLabel(targetFileName) : module
        annotations.push({
          type: 'import',
          module,
          alias: null,
          line: idx + 1,
          code: trimmed,
          targetFileName,
          targetFileLabel,
          jumpLine: targetFileEntry ? 1 : idx + 1,
        })

        membersPart.split(',').forEach(raw => {
          const segment = raw.trim()
          if (!segment) return
          const parts = segment.split(/\s+as\s+/i)
          const memberName = parts[0].trim()
          const alias = (parts[1] || parts[0]).trim()
          if (!alias) return
          directEntries.push({
            alias,
            module,
            member: memberName,
            targetFileEntry,
            targetFileName,
            targetFileLabel,
            declarationLine: idx + 1,
          })
        })
      }
    })

    const seenUsage = new Set()
    lines.forEach((line, idx) => {
      moduleEntries.forEach(entry => {
        if (idx + 1 === entry.declarationLine) return
        const regex = new RegExp(`\\b${entry.alias}\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`, 'g')
        let match
        while ((match = regex.exec(line))) {
          const memberName = match[1]
          const key = `${idx}-${entry.alias}-${memberName}`
          if (seenUsage.has(key)) continue
          seenUsage.add(key)
          annotations.push({
            type: 'import_usage',
            module: entry.module,
            alias: entry.alias,
            member: memberName,
            line: idx + 1,
            code: line.trim(),
            targetFileName: entry.targetFileName,
            targetFileLabel: entry.targetFileLabel,
            jumpLine: findPythonSymbolLine(entry.targetFileEntry, memberName),
          })
        }
      })

      directEntries.forEach(entry => {
        if (idx + 1 === entry.declarationLine) return
        const callRegex = new RegExp(`\\b${entry.alias}\\s*\\(`)
        if (!callRegex.test(line)) return
        const trimmed = line.trim()
        if (trimmed.startsWith(`def ${entry.alias}`) || trimmed.startsWith(`class ${entry.alias}`)) return
        const key = `${idx}-${entry.alias}-direct`
        if (seenUsage.has(key)) return
        seenUsage.add(key)
        annotations.push({
          type: 'import_usage',
          module: entry.module,
          alias: entry.alias,
          member: entry.member,
          line: idx + 1,
          code: trimmed,
          targetFileName: entry.targetFileName,
          targetFileLabel: entry.targetFileLabel,
          jumpLine: findPythonSymbolLine(entry.targetFileEntry, entry.member),
        })
      })
    })

    return annotations
  }

  const buildJsImportAnnotations = (fileName) => {
    const src = resolveFileData(fileName)
    if (!src) return []
    const lines = (src.content || '').split(/\r?\n/)
    const annotations = []
    const seen = new Set()
    const addAnnotation = (moduleRef, idx, code) => {
      if (!moduleRef) return
      const key = `${idx}:${moduleRef}`
      if (seen.has(key)) return
      seen.add(key)
      const targetFileEntry = findFileForModuleRef(moduleRef)
      const targetFileName = targetFileEntry?.name || null
      const targetFileLabel = targetFileName ? formatFileLabel(targetFileName) : moduleRef
      annotations.push({
        type: 'import',
        module: moduleRef,
        alias: null,
        line: idx + 1,
        code,
        targetFileName,
        targetFileLabel,
        jumpLine: targetFileEntry ? 1 : idx + 1,
      })
    }

    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//')) return
      let match = trimmed.match(/^import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/)
      if (match) {
        addAnnotation(match[1], idx, trimmed)
        return
      }
      match = trimmed.match(/require\(\s*['"]([^'"]+)['"]\s*\)/)
      if (match) {
        addAnnotation(match[1], idx, trimmed)
      }
    })

    return annotations
  }

  const buildCppImportAnnotations = (fileName) => {
    const src = resolveFileData(fileName)
    if (!src) return []
    const lines = (src.content || '').split(/\r?\n/)
    const annotations = []
    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      const match = trimmed.match(/^#include\s+"([^"]+)"/)
      if (match) {
        const moduleRef = match[1]
        const targetFileEntry = findFileForModuleRef(moduleRef)
        const targetFileName = targetFileEntry?.name || null
        const targetFileLabel = targetFileName ? formatFileLabel(targetFileName) : moduleRef
        annotations.push({
          type: 'import',
          module: moduleRef,
          alias: null,
          line: idx + 1,
          code: trimmed,
          targetFileName,
          targetFileLabel,
          jumpLine: targetFileEntry ? 1 : idx + 1,
        })
      }
    })
    return annotations
  }

  const buildGoImportAnnotations = (fileName) => {
    const src = resolveFileData(fileName)
    if (!src) return []
    const lines = (src.content || '').split(/\r?\n/)
    const annotations = []
    let inBlock = false

    const addAnnotation = (moduleRef, idx, code) => {
      if (!moduleRef) return
      const lastSegment = moduleRef.split('/').pop()
      const targetFileEntry = matchWorkspaceFile([lastSegment, `${lastSegment}.go`])
      const targetFileName = targetFileEntry?.name || null
      const targetFileLabel = targetFileName ? formatFileLabel(targetFileName) : moduleRef
      annotations.push({
        type: 'import',
        module: moduleRef,
        alias: null,
        line: idx + 1,
        code,
        targetFileName,
        targetFileLabel,
        jumpLine: targetFileEntry ? 1 : idx + 1,
      })
    }

    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//')) return
      if (trimmed.startsWith('import (')) {
        inBlock = true
        return
      }
      if (inBlock) {
        if (trimmed.startsWith(')')) {
          inBlock = false
          return
        }
        const match = trimmed.match(/^(?:[A-Za-z_][\w]*\s+)?"([^"]+)"/)
        if (match) addAnnotation(match[1], idx, trimmed)
        return
      }
      const match = trimmed.match(/^import\s+(?:[A-Za-z_][\w]*\s+)?"([^"]+)"/)
      if (match) addAnnotation(match[1], idx, trimmed)
    })

    return annotations
  }

  const buildJavaImportAnnotations = (fileName) => {
    const src = resolveFileData(fileName)
    if (!src) return []
    const lines = (src.content || '').split(/\r?\n/)
    const annotations = []
    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('import ')) return
      const match = trimmed.match(/^import\s+([A-Za-z0-9_\.]+);/)
      if (!match) return
      const moduleRef = match[1]
      const className = moduleRef.split('.').pop()
      const targetFileEntry = matchWorkspaceFile([`${className}.java`, className])
      const targetFileName = targetFileEntry?.name || null
      const targetFileLabel = targetFileName ? formatFileLabel(targetFileName) : moduleRef
      annotations.push({
        type: 'import',
        module: moduleRef,
        alias: className,
        line: idx + 1,
        code: trimmed,
        targetFileName,
        targetFileLabel,
        jumpLine: targetFileEntry ? 1 : idx + 1,
      })
    })
    return annotations
  }

  const detectImportAnnotationsForFile = (fileName) => {
    const lang = inferLanguageFromFileName(fileName, langHint)
    if (lang === 'python') {
      return buildPythonImportAnnotations(fileName)
    }
    if (lang === 'javascript') {
      return buildJsImportAnnotations(fileName)
    }
    if (lang === 'cpp') {
      return buildCppImportAnnotations(fileName)
    }
    if (lang === 'go') {
      return buildGoImportAnnotations(fileName)
    }
    if (lang === 'java') {
      return buildJavaImportAnnotations(fileName)
    }
    return []
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

      ;(node.children || []).forEach(child => {
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

    ;(group.nodes || []).forEach(node => {
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

    const importAnnotations = detectImportAnnotationsForFile(group.file)
    importAnnotations.forEach(annotation => {
      const jumpFile = annotation.targetFileName || group.file
      const jumpLine = annotation.targetFileName ? annotation.jumpLine : annotation.line
      const step = makeStep({
        type: annotation.type,
        kind: 'import',
        line: annotation.line,
        file: group.file,
        fileLabel,
        code: annotation.code,
        depth: 0,
        func: null,
        isImport: annotation.type === 'import',
        isImportUsage: annotation.type === 'import_usage',
        importModule: annotation.module,
        importAlias: annotation.alias,
        importMember: annotation.member,
        targetFileLabel: annotation.targetFileLabel,
        jumpFile,
        jumpLine,
      })
      stepsForFile = insertStepByLine(stepsForFile, step)
    })

    return stepsForFile
  })
}
