import { Icon, ManualLanguagePicker } from '../../components/run/ui.jsx'

export default function SettingsModal({
  settingsOpen,
  setSettingsOpen,
  settingsTrapRef,
  theme,
  setTheme,
  fontSize,
  setFontSize,
  autoDetect,
  setAutoDetect,
  manualLanguage,
  setManualLanguage,
  activeFileId,
}) {
  if (!settingsOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false)
      }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        ref={settingsTrapRef}
        className="relative z-10 w-[92vw] max-w-md rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Settings</h3>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
            aria-label="Close settings"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Theme</div>
                <div className="text-xs text-[var(--oc-muted)]">Applies to the entire UI and the editor</div>
              </div>
            </div>
            <fieldset className="grid grid-cols-1 gap-2" aria-label="Theme">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="oc-theme"
                  checked={theme === 'vscode-dark-plus'}
                  onChange={() => setTheme('vscode-dark-plus')}
                  aria-label="VS Code Dark+ theme"
                />
                <span>VS Code Dark+</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="oc-theme"
                  checked={theme === 'vscode-light-plus'}
                  onChange={() => setTheme('vscode-light-plus')}
                  aria-label="VS Code Light+ theme"
                />
                <span>VS Code Light+</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="oc-theme"
                  checked={theme === 'vscode-high-contrast'}
                  onChange={() => setTheme('vscode-high-contrast')}
                  aria-label="High Contrast theme"
                />
                <span>High Contrast</span>
              </label>
            </fieldset>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Font Size</div>
              <div className="text-xs text-[var(--oc-muted)]">{fontSize}px</div>
            </div>
            <input
              type="range"
              min={12}
              max={20}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              aria-label="Editor font size"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Language detection</div>
                <div className="text-xs text-[var(--oc-muted)]">Auto-detect enabled by default</div>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDetect}
                  onChange={(e) => setAutoDetect(e.target.checked)}
                  aria-label="Toggle language auto-detect"
                />
                <span>{autoDetect ? 'Auto' : 'Manual'}</span>
              </label>
            </div>
            {!autoDetect && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Manual language</div>
                  <div className="text-xs text-[var(--oc-muted)]">Choose when auto is off</div>
                </div>
                <ManualLanguagePicker value={manualLanguage} onChange={(id) => setManualLanguage(activeFileId, id)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
