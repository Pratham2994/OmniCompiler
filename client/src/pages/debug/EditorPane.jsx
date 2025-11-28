import { motion } from 'framer-motion'
import { Icon } from '../../components/run/ui.jsx'

export default function EditorPane({
  editorWidthStyle,
  workspaceW,
  editorBasisPx,
  editorCompact,
  languageLabel,
  effectiveLanguage,
  autoDetect,
  onFormat,
  onFind,
  editorContainerRef,
  cursorPos,
  activeFileName,
  onToggleFilesDrawer,
  filesDrawerOpen,
  pausedLocation,
  sessionPhase,
}) {
  return (
    <motion.section
      id="editor-pane"
      className="h-full border-r border-[var(--oc-border)] flex flex-col"
      style={{ width: editorWidthStyle }}
      animate={workspaceW ? { width: editorBasisPx } : undefined}
      transition={{ duration: 0.28, ease: [0.22, 0.8, 0.36, 1] }}
    >
      <div className="h-11 shrink-0 px-3 border-b border-[var(--oc-border)] flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs md:text-sm">
          <nav aria-label="Breadcrumbs" className="flex items-center gap-1 text-[var(--oc-muted)]">
            <span>workspace</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--oc-fg)] truncate">{activeFileName || 'main'}</span>
          </nav>
          {pausedLocation?.fileName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--oc-surface-2)] text-[var(--oc-warning-300)] text-xs font-medium">
              <Icon name="pause" className="size-3" />
              Paused {pausedLocation.fileName}:{pausedLocation.line}
            </span>
          )}
          <button
            type="button"
            onClick={() => onToggleFilesDrawer?.()}
            className="oc-icon-btn h-8 w-8 bg-[var(--oc-surface-2)]"
            aria-label={filesDrawerOpen ? 'Hide files panel' : 'Show files panel'}
            title={filesDrawerOpen ? 'Hide Files' : 'Show Files'}
            aria-pressed={filesDrawerOpen ? 'true' : 'false'}
          >
            <Icon name={filesDrawerOpen ? 'chevron-left' : 'chevron-right'} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {!editorCompact && (
            <span className="h-8 inline-flex items-center text-sm px-2 rounded bg-[var(--oc-surface-2)]">
              Language: {languageLabel(effectiveLanguage)} {autoDetect ? '(auto)' : '(manual)'}
            </span>
          )}
          <button
            id="formatBtn"
            onClick={onFormat}
            className={`h-8 ${editorCompact ? 'w-8 px-0' : 'px-3'} text-sm rounded bg-[var(--oc-surface-2)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center gap-1`}
            title="Format document"
            aria-label="Format document"
          >
            <Icon name="wand" />
            {!editorCompact && <span>Format</span>}
          </button>
          <button
            id="findBtn"
            onClick={onFind}
            className={`h-8 ${editorCompact ? 'w-8 px-0' : 'px-3'} text-sm rounded bg-[var(--oc-surface-2)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)] flex items-center justify-center gap-1`}
            title="Find"
            aria-label="Find in editor"
          >
            <Icon name="search" />
            {!editorCompact && <span>Find</span>}
          </button>
        </div>
      </div>

      <div ref={editorContainerRef} className="flex-1 min-h-0" aria-label="Code editor" />

      <div className="h-7 shrink-0 px-3 border-t border-[var(--oc-border)] text-[11px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span id="cursorPos">Ln {cursorPos.line}, Col {cursorPos.column}</span>
          {pausedLocation?.fileName && (
            <span className="text-[var(--oc-warning-300)]">↦ {pausedLocation.fileName}:{pausedLocation.line}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span id="modeIndicator">Mode: Debug</span>
          <span id="statusIndicator">Status: {sessionPhase || 'idle'}</span>
          <span id="langIndicator">{languageLabel(effectiveLanguage)} {autoDetect ? '(auto)' : '(manual)'}</span>
          <span id="encoding">UTF-8</span>
          <span id="indent">Spaces: 4</span>
        </div>
      </div>
    </motion.section>
  )
}
