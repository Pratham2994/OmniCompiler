export function parseCodeTree(lang, code) {
  const l = String(lang || '').toLowerCase()
  const src = String(code || '')
  switch (l) {
    case 'python': return parsePythonTree(src)
    case 'javascript': return parseJsTree(src)
    case 'java': return parseJavaTree(src)
    case 'go': return parseGoTree(src)
    case 'cpp': return parseCppTree(src)
    default: return []
  }
}

export function parsePythonTree(code = '') {
  const lines = String(code || '').replace(/\t/g, '    ').split(/\r?\n/)
  const roots = []
  const stack = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const m = raw.match(/^(\s*)(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/)
    if (!m) continue
    const indent = m[1].length
    const kind = m[2] === 'def' ? 'function' : 'class'
    const name = m[3]
    const node = { type: kind, name, line: i + 1, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) {
      stack[stack.length - 1].node.children.push(node)
    } else {
      roots.push(node)
    }
    stack.push({ indent, node })
  }
  return roots
}

export function parseJsTree(code = '') {
  const lines = String(code || '').split(/\r?\n/)
  const roots = []
  const classStack = []
  let depth = 0
  const pushRoot = (n) => roots.push(n)

  const isLikelyMethod = (s) => /^\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(s) && !/^\s*(if|for|while|switch|catch)\b/.test(s)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const open = (raw.match(/{/g) || []).length
    const close = (raw.match(/}/g) || []).length

    const cm = raw.match(/^\s*class\s+([A-Za-z_$][\w$]*)/)
    if (cm) {
      const node = { type: 'class', name: cm[1], line: i + 1, children: [] }
      pushRoot(node)
      classStack.push({ name: cm[1], node, depthAtOpen: depth + open - close })
    }

    const fm = raw.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    if (fm) {
      pushRoot({ type: 'function', name: fm[1], line: i + 1, children: [] })
    }

    const am = raw.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(.*\)\s*=>/)
    if (am) {
      pushRoot({ type: 'function', name: am[1], line: i + 1, children: [] })
    }

    if (classStack.length && isLikelyMethod(raw)) {
      const mm = raw.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/)
      if (mm) {
        classStack[classStack.length - 1].node.children.push({
          type: 'method',
          name: mm[1],
          line: i + 1,
          children: []
        })
      }
    }

    depth += open - close
    while (classStack.length && depth < classStack[classStack.length - 1].depthAtOpen) {
      classStack.pop()
    }
  }
  return roots
}

export function parseJavaTree(code = '') {
  const lines = String(code || '').split(/\r?\n/)
  const roots = []
  const classStack = []
  let depth = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const open = (raw.match(/{/g) || []).length
    const close = (raw.match(/}/g) || []).length

    const cls = raw.match(/^\s*(?:public|private|protected)?\s*(?:final|abstract)?\s*(class|interface|enum)\s+([A-Za-z_][\w]*)/)
    if (cls) {
      const node = { type: cls[1], name: cls[2], line: i + 1, children: [] }
      roots.push(node)
      classStack.push({ node, depthAtOpen: depth + open - close })
    }

    const meth = raw.match(/^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\],\s]+\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/)
    if (meth) {
      if (classStack.length) {
        classStack[classStack.length - 1].node.children.push({ type: 'method', name: meth[1], line: i + 1, children: [] })
      } else {
        roots.push({ type: 'function', name: meth[1], line: i + 1, children: [] })
      }
    }

    depth += open - close
    while (classStack.length && depth < classStack[classStack.length - 1].depthAtOpen) classStack.pop()
  }
  return roots
}

export function parseGoTree(code = '') {
  const lines = String(code || '').split(/\r?\n/)
  const roots = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const pkg = raw.match(/^\s*package\s+([A-Za-z_][\w]*)/)
    if (pkg) roots.push({ type: 'package', name: pkg[1], line: i + 1, children: [] })
    const typ = raw.match(/^\s*type\s+([A-Za-z_][\w]*)\s+(struct|interface)\b/)
    if (typ) roots.push({ type: typ[2], name: typ[1], line: i + 1, children: [] })
    const recv = raw.match(/^\s*func\s*\(\s*[^)]+\)\s*([A-Za-z_][\w]*)\s*\(/)
    if (recv) roots.push({ type: 'method', name: recv[1], line: i + 1, children: [] })
    const fn = raw.match(/^\s*func\s+([A-Za-z_][\w]*)\s*\(/)
    if (fn) roots.push({ type: 'function', name: fn[1], line: i + 1, children: [] })
  }
  return roots
}

export function parseCppTree(code = '') {
  const lines = String(code || '').split(/\r?\n/)
  const roots = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const cls = raw.match(/^\s*(class|struct)\s+([A-Za-z_][\w]*)\b/)
    if (cls) roots.push({ type: cls[1], name: cls[2], line: i + 1, children: [] })
    if (/^\s*(if|for|while|switch|catch)\b/.test(raw)) continue
    const fn = raw.match(/^\s*(?:template\s*<[^>]+>\s*)?[\w:\<\>\*&\s]+?\s+([~]?[A-Za-z_][\w:]*)\s*\([^;]*\)\s*\{/)
    if (fn) roots.push({ type: 'function', name: fn[1], line: i + 1, children: [] })
  }
  return roots
}

export const extForLang = (l) => {
  switch ((l || '').toLowerCase()) {
    case 'python': return 'py'
    case 'cpp': return 'cpp'
    case 'javascript': return 'js'
    case 'java': return 'java'
    case 'go': return 'go'
    default: return 'txt'
  }
}
