import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from '../../components/run/ui.jsx'

export default function DebugPanel({
  workspaceW,
  outputWidthStyle,
  outputBasisPx,
  debugTab,
  setDebugTab,
  running,
  stopDebugSession,
  runProgram,
  clearBreakpoints,
  toggleOutputCollapsed,
  breakpoints,
  addBreakpointAtCursor,
  removeBreakpoint,
  effectiveLanguage,
  languageLabel,
  generateTree,
  treeNodes,
  treeBusy,
  treeStatus,
  treeMessage,
  treeWarnings,
  typeLegend,
  typeColor,
  jumpToFileAndLine,
  outputLog,
  onClearOutput,
  stdinLine,
  setStdinLine,
  sendStdin,
  waitingForInput,
}) {
  const [fileExpanded, setFileExpanded] = useState({})
  const [nodeExpanded, setNodeExpanded] = useState({})

  useEffect(() => {
    setFileExpanded((treeNodes || []).reduce((acc, g) => ({ ...acc, [g.file]: true }), {}))
    setNodeExpanded({})
  }, [treeNodes])

  const toggleNodeExpanded = (id) => {
    setNodeExpanded(prev => ({ ...prev, [id]: !(prev[id] ?? true) }))
  }

  const toggleFileExpanded = (fileName) => {
    setFileExpanded(prev => ({ ...prev, [fileName]: !(prev[fileName] ?? true) }))
  }

  const renderTree = (nodes, depth = 0) => {
    return (nodes || []).map((n, idx) => {
      const hasChildren = n.children && n.children.length > 0
      const expanded = nodeExpanded[n.id] ?? true
      const lineLabel = (n.start_line === n.end_line || !n.end_line)
        ? `:${n.start_line}`
        : `:${n.start_line}-${n.end_line}`
      return (
        <li
          key={`${n.id}:${depth}:${idx}`}
          className="oc-cfg-item"
          style={{ marginLeft: depth ? depth * 6 : 0 }}
        >
          <div className="oc-cfg-row">
            {hasChildren ? (
              <button
                className="oc-cfg-toggle"
                onClick={() => toggleNodeExpanded(n.id)}
                aria-label={expanded ? 'Collapse node' : 'Expand node'}
              >
                <Icon
                  name="chevron-right"
                  className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
              </button>
            ) : (
              <span
                className="oc-cfg-dot"
                aria-hidden="true"
                style={{ background: typeColor(n.type) }}
              />
            )}
            <div className="oc-cfg-arrow" aria-hidden="true" />
            <button
              className="oc-cfg-node"
              style={{ borderColor: typeColor(n.type), boxShadow: `0 10px 30px ${typeColor(n.type)}22` }}
              onClick={() => jumpToFileAndLine(n.file, n.start_line)}
              aria-label={`Jump to ${n.file || 'file'} ${lineLabel}`}
            >
              <div className="oc-cfg-node-top">
                <span
                  className="oc-cfg-pill"
                  style={{ background: `${typeColor(n.type)}22`, color: typeColor(n.type), borderColor: typeColor(n.type) }}
                >
                  {n.type || 'node'}
                </span>
                <span className="oc-cfg-title">{n.label || n.name || '(unnamed)'}</span>
                <span className="oc-cfg-lines">{lineLabel}</span>
              </div>
              {n.file ? (
                <div className="oc-cfg-meta">File: {n.file}</div>
              ) : null}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {hasChildren && expanded && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="oc-cfg-branch space-y-2"
              >
                {renderTree(n.children, depth + 1)}
              </motion.ul>
            )}
          </AnimatePresence>
        </li>
      )
    })
  }

  return (
    <motion.section
      className="h-full flex flex-col"
      style={{ width: outputWidthStyle, willChange: 'width, transform, opacity' }}
      initial={{ opacity: 0, x: 12, width: 0 }}
      animate={workspaceW ? { opacity: 1, x: 0, width: outputBasisPx } : { opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, width: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.8, 0.36, 1] }}
    >
      <div className="h-11 shrink-0 px-3 border-b border-[var(--oc-border)] flex items-center justify-between">
        <div role="tablist" aria-label="Debug tabs" className="flex items-center gap-1">
          <button
            role="tab"
            aria-selected={debugTab === 'bpvars'}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${debugTab === 'bpvars' ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] shadow-inner ring-1 ring-[var(--oc-border)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-2)]'}`}
            onClick={() => setDebugTab('bpvars')}
          >
            Breakpoints / Variables
          </button>
          <button
            role="tab"
            aria-selected={debugTab === 'tree'}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${debugTab === 'tree' ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] shadow-inner ring-1 ring-[var(--oc-border)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-2)]'}`}
            onClick={() => setDebugTab('tree')}
          >
            Tree
          </button>
          <button
            role="tab"
            aria-selected={debugTab === 'output'}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${debugTab === 'output' ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] shadow-inner ring-1 ring-[var(--oc-border)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-2)]'}`}
            onClick={() => setDebugTab('output')}
          >
            Output
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            data-testid="tid-run-debug"
            onClick={() => {
              if (running) {
                stopDebugSession()
              } else {
                runProgram()
              }
            }}
            className="oc-btn-cta h-9 w-9 rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center"
            aria-label={running ? 'Stop debugging session' : 'Run debugging session'}
            title={running ? 'Stop' : 'Run'}
            aria-busy={running ? 'true' : 'false'}
          >
            <Icon name={running ? 'stop' : 'play'} />
            <span className="sr-only">{running ? 'Stop' : 'Run'}</span>
          </button>

          <button
            onClick={clearBreakpoints}
            className="oc-icon-btn"
            aria-label="Clear all breakpoints"
            title="Clear all breakpoints"
          >
            <Icon name="trash" />
          </button>

          <button
            data-testid="tid-collapse-output"
            className="oc-icon-btn"
            aria-label="Collapse Panel"
            title="Collapse Panel"
            onClick={toggleOutputCollapsed}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 flex flex-col">
        {debugTab === 'bpvars' && (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col min-h-0 bg-[var(--oc-surface-2)] rounded p-2" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Breakpoints</div>
                <div className="flex items-center gap-2">
                  <button className="oc-btn" onClick={addBreakpointAtCursor} aria-label="Add breakpoint at cursor">
                    <Icon name="plus" /> <span className="ml-1">Add</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                {breakpoints.length === 0 ? (
                  <div className="text-[var(--oc-muted)]">No breakpoints. Use F9 or the Add button to create one at the current cursor.</div>
                ) : (
                  <ul className="space-y-1">
                    {breakpoints.map(bp => (
                      <li key={bp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-[var(--oc-surface)]">
                        <div className="min-w-0 truncate">
                          <span className="font-medium">{bp.fileName}</span>
                          <span className="opacity-70"> :{bp.line}</span>
                          {bp.condition ? <span className="ml-2 text-[var(--oc-muted)]">if {bp.condition}</span> : null}
                        </div>
                        <button
                          className="oc-icon-btn"
                          onClick={() => removeBreakpoint(bp.id)}
                          aria-label={`Remove breakpoint at ${bp.fileName}:${bp.line}`}
                          title="Remove"
                        >
                          <Icon name="trash" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-col min-h-0 bg-[var(--oc-surface-2)] rounded p-2" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Variables</div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <div className="text-[var(--oc-muted)]">
                  No active debug session. Variables will appear here when you start debugging.
                </div>
                <ul className="mt-2 font-mono text-xs space-y-1">
                  <li>// locals: --</li>
                  <li>// globals: --</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {debugTab === 'tree' && (
          <div className="flex-1 min-h-0 bg-[var(--oc-surface-2)] rounded p-2 text-sm overflow-hidden flex flex-col" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Code Tree</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-[var(--oc-muted)]">
                  Lang: {effectiveLanguage === 'plaintext' ? 'Not set' : languageLabel(effectiveLanguage)}
                </div>
                <button
                  className="oc-btn"
                  onClick={generateTree}
                  disabled={treeBusy}
                  aria-label="Generate code tree"
                  title="Generate code tree"
                >
                  {treeBusy ? 'Generating Tree...' : 'Generate Tree'}
                </button>
              </div>
            </div>
            <div className={`text-sm font-medium mb-3 ${treeStatus === 'error' ? 'text-[var(--oc-danger)]' : 'text-[var(--oc-muted)]'}`}>
              {treeMessage}
            </div>
            {treeWarnings.length > 0 && (
              <div className="text-xs text-[var(--oc-primary-300)] mb-3 space-y-1">
                {treeWarnings.map((w, i) => <div key={'warn-' + i}>! {w}</div>)}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--oc-muted)] mb-2">
              {typeLegend.map((t) => (
                <span key={t.type} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--oc-surface-2)] border border-[var(--oc-border)]">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: typeColor(t.type) }} />
                  <span>{t.label}</span>
                </span>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-auto pr-1 pb-8">
              {effectiveLanguage === 'plaintext' ? (
                <div className="text-[var(--oc-muted)]">Tree output will appear here after generation.</div>
              ) : treeNodes && treeNodes.length > 0 ? (
                <div className="space-y-2">
                  {treeNodes.map(group => {
                    const expanded = fileExpanded[group.file] ?? true
                    return (
                      <div key={group.file} className="rounded border border-[var(--oc-border)] bg-[var(--oc-surface)]">
                        <button
                          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-[var(--oc-surface-2)]"
                          onClick={() => toggleFileExpanded(group.file)}
                          aria-expanded={expanded ? 'true' : 'false'}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Icon
                              name="chevron-right"
                              className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                            />
                            <span className="font-semibold truncate">{group.file}</span>
                          </span>
                          <span className="text-xs text-[var(--oc-muted)]">
                            {group.nodes?.length || 0} root node{(group.nodes?.length || 0) === 1 ? '' : 's'}
                          </span>
                        </button>
                        <AnimatePresence initial={false}>
                          {expanded && (
                            <motion.ul
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="p-2 space-y-1"
                              style={{ maxHeight: '60vh', overflow: 'auto' }}
                            >
                              {renderTree(group.nodes, 0)}
                            </motion.ul>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-[var(--oc-muted)]">Run Generate Tree to visualize the control flow.</div>
              )}
            </div>
          </div>
        )}

        {debugTab === 'output' && (
          <div className="flex-1 min-h-0 flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Program Output</div>
              <button
                className="oc-icon-btn"
                onClick={onClearOutput}
                aria-label="Clear output"
                title="Clear output"
              >
                <Icon name="trash" />
              </button>
            </div>
            <div
              data-testid="tid-debug-stdout"
              role="log"
              aria-live="polite"
              className="w-full flex-1 min-h-0 oc-console rounded p-2 font-mono text-xs overflow-auto whitespace-pre-wrap"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
            >
              {outputLog.length === 0 ? (
                <div className="opacity-60">Output will appear here</div>
              ) : (
                outputLog.map((line, i) => {
                  const item = typeof line === 'string' ? { kind: 'out', text: line } : line
                  const kind = item?.kind || 'out'
                  const cls = kind === 'log' ? 'oc-line-log' : (kind === 'err' ? 'oc-line-err' : (kind === 'in' ? 'oc-line-in' : 'oc-line-out'))
                  return <div key={`${kind}-${i}`} className={`whitespace-pre-wrap break-words ${cls}`}>{item?.text ?? ''}</div>
                })
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={stdinLine}
                onChange={(e) => setStdinLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    sendStdin()
                  }
                }}
                placeholder="Type input and press Enter..."
                className="flex-1 oc-input font-mono text-xs"
                disabled={!running || !waitingForInput}
                aria-label="Program input"
              />
              <button
                className="oc-btn"
                disabled={!running || !stdinLine || !waitingForInput}
                onClick={sendStdin}
                aria-label="Send input"
                title="Send to stdin"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}

