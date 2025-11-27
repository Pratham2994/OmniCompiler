import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '../../components/run/ui.jsx'
import ExecutionStepNode from './ExecutionStepNode.jsx'

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
  generateTrace,
  traceBusy,
  traceStatus,
  traceMessage,
  traceWarnings,
  typeLegend,
  typeColor,
  executionTrace,
  currentStepIndex,
  onTraceStepClick,
  outputLog,
  onClearOutput,
  stdinLine,
  setStdinLine,
  sendStdin,
  waitingForInput,
}) {
  const traceScrollRef = useRef(null)

  const renderTraceBody = () => {
    if (effectiveLanguage === 'plaintext') {
      return (
        <div className="text-[var(--oc-muted)]">
          Select or detect a language to generate the execution trace.
        </div>
      )
    }

    if (!executionTrace || executionTrace.length === 0) {
      return (
        <div className="oc-exec-empty">
          <Icon name="node-default" className="size-12 opacity-30 mb-3" />
          <p>No execution trace generated yet.</p>
          <p className="text-xs opacity-70">Click "Generate Trace" to analyze your code.</p>
        </div>
      )
    }

    return (
      <div className="oc-exec-trace" ref={traceScrollRef}>
        <div className="oc-exec-trace-header">
          <div className="flex items-center gap-2">
            <Icon name="play" className="size-4" />
            <span className="font-semibold">Execution Flow</span>
          </div>
          <span className="oc-exec-trace-count">
            {executionTrace.length} step{executionTrace.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="oc-exec-trace-steps">
          {executionTrace.map((step, index) => (
            <ExecutionStepNode
              key={step.id || `step-${index}`}
              step={step}
              index={index}
              isActive={index <= currentStepIndex}
              isCurrent={index === currentStepIndex}
              totalSteps={executionTrace.length}
              onClick={() => onTraceStepClick(step, index)}
            />
          ))}
        </div>
      </div>
    )
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
            aria-selected={debugTab === 'trace'}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${debugTab === 'trace' ? 'bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)] shadow-inner ring-1 ring-[var(--oc-border)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-2)]'}`}
            onClick={() => setDebugTab('trace')}
          >
            Execution Trace
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

        {debugTab === 'trace' && (
          <div className="flex-1 min-h-0 bg-[var(--oc-surface-2)] rounded p-2 text-sm overflow-hidden flex flex-col" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--oc-muted)]">Execution Trace</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-[var(--oc-muted)]">
                  Lang: {effectiveLanguage === 'plaintext' ? 'Not set' : languageLabel(effectiveLanguage)}
                </div>
                <button
                  className="oc-btn"
                  onClick={generateTrace}
                  disabled={traceBusy}
                  aria-label="Generate execution trace"
                  title="Generate execution trace"
                >
                  {traceBusy ? 'Analyzing...' : 'Generate Trace'}
                </button>
              </div>
            </div>
            <div className={`text-sm font-medium mb-3 ${traceStatus === 'error' ? 'text-[var(--oc-danger)]' : 'text-[var(--oc-muted)]'}`}>
              {traceMessage}
            </div>
            {traceWarnings.length > 0 && (
              <div className="text-xs text-[var(--oc-primary-300)] mb-3 space-y-1">
                {traceWarnings.map((w, i) => <div key={`trace-warn-${i}`}>⚠ {w}</div>)}
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
              {renderTraceBody()}
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
