import { memo } from 'react'

export const STEP_COLOR_MAP = {
  function: 'var(--oc-trace-function)',
  class: 'var(--oc-trace-class)',
  conditional: 'var(--oc-trace-conditional)',
  loop: 'var(--oc-trace-loop)',
  return: 'var(--oc-trace-return)',
  statement: 'var(--oc-trace-statement)',
  entry: 'var(--oc-trace-entry)',
  exit: 'var(--oc-trace-exit)',
  branch_true: 'var(--oc-trace-branch-true)',
  branch_false: 'var(--oc-trace-branch-false)',
  exception: 'var(--oc-trace-exception)',
  import: 'var(--oc-trace-import)',
  default: 'var(--oc-trace-default)',
}

export const getStepIcon = (type) => {
  const t = String(type || '').toLowerCase()
  switch (t) {
    case 'function_def':
    case 'function_call':
    case 'function': return 'node-function'
    case 'class': return 'node-class'
    case 'method': return 'node-method'
    case 'if':
    case 'else':
    case 'elif':
    case 'conditional': return 'node-if'
    case 'for':
    case 'while':
    case 'loop': return 'node-loop'
    case 'return': return 'node-return'
    case 'try':
    case 'catch':
    case 'except':
    case 'finally': return 'node-try'
    case 'entry':
    case 'start': return 'node-entry'
    case 'exit':
    case 'end': return 'node-exit'
    case 'call': return 'node-function'
    case 'assign':
    case 'expression':
    case 'stmt': return 'node-stmt'
    case 'import':
    case 'import_usage':
      return 'node-import'
    default: return 'node-default'
  }
}

export const canonicalStepType = (type = '') => {
  const t = String(type || '').toLowerCase()
  if (['function_def', 'function_call', 'function', 'call', 'method'].includes(t)) return 'function'
  if (t === 'class') return 'class'
  if (['if', 'else', 'elif', 'conditional', 'switch'].includes(t)) return 'conditional'
  if (['for', 'while', 'loop'].includes(t)) return 'loop'
  if (t === 'return') return 'return'
  if (['entry', 'start'].includes(t)) return 'entry'
  if (['exit', 'end'].includes(t)) return 'exit'
  if (t === 'branch_true' || t === 'branch-true') return 'branch_true'
  if (t === 'branch_false' || t === 'branch-false') return 'branch_false'
  if (['try', 'catch', 'except', 'finally'].includes(t)) return 'exception'
  if (['import', 'import_usage', 'from_import'].includes(t)) return 'import'
  return 'statement'
}

export const getStepColor = (type) => STEP_COLOR_MAP[canonicalStepType(type)] || STEP_COLOR_MAP.default
export const isLoopLikeType = (type) => canonicalStepType(type) === 'loop'

export const stripExtension = (name) => {
  const idx = name.lastIndexOf('.')
  if (idx > 0) return name.slice(0, idx)
  return name
}

export const normalizeFileReference = (name = '') => {
  const sanitized = String(name || '').replace(/\\/g, '/').trim()
  if (!sanitized) {
    return { loweredFull: '', loweredBase: '', loweredBaseNoExt: '', displayName: '' }
  }
  const parts = sanitized.split('/')
  const displayName = parts[parts.length - 1] || sanitized
  const loweredDisplay = displayName.toLowerCase()
  return {
    loweredFull: sanitized.toLowerCase(),
    loweredBase: loweredDisplay,
    loweredBaseNoExt: stripExtension(loweredDisplay),
    displayName,
  }
}

export const formatFileLabel = (name = '') => normalizeFileReference(name).displayName || ''

export const formatStepFunctionLabel = (value) => {
  if (!value) return ''
  const raw = String(value).trim()
  const cleaned = raw.replace(/^(function|method)\s*:\s*/i, '').trim()
  return cleaned || raw
}

// Memo helper for external consumers that want to re-export memo without importing React.
export const memoized = (component) => memo(component)
