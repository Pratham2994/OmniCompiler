import { Link } from 'react-router-dom'
import { Icon } from '../../components/run/ui.jsx'

export default function DebugHeader({ settingsOpen, onOpenSettings }) {
  return (
    <header className="h-14 border-b border-[var(--oc-border)] flex items-center justify-between px-3 gap-3">
      <div className="flex items-center gap-3">
        <Link
          to="/run"
          className="flex items-center gap-2 text-sm font-semibold px-2 py-1 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
          aria-label="Omni Compiler Home"
        >
          <Icon name="file" className="size-4" />
          <span>Omni Compiler</span>
        </Link>

        <span aria-hidden="true" className="h-5 w-px bg-[var(--oc-border)]" />

        <nav className="flex items-center gap-2" aria-label="Primary">
          <Link
            to="/run"
            className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-surface-2)]"
          >
            Run
          </Link>
          <Link
            to="/debug"
            className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-primary-600)] text-[var(--oc-on-primary)]"
          >
            Debug
          </Link>
          <Link
            to="/translate"
            className="px-3 py-1.5 text-sm rounded border border-[var(--oc-border)] bg-[var(--oc-surface-2)]"
          >
            Translate
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-1">
        <button
          id="settingsBtn"
          onClick={onOpenSettings}
          className="oc-btn oc-btn-primary"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen ? 'true' : 'false'}
        >
          <Icon name="settings" />
          Settings
        </button>
      </div>
    </header>
  )
}
