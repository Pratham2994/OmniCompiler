import { Icon } from '../../components/run/ui.jsx'

export default function FilesDrawer({
  leftMounted,
  leftOpen,
  leftTrapRef,
  closeDrawer,
  leftTab,
  files,
  activeFileId,
  setActiveFileId,
  addFileInDrawer,
  uploadInDrawerRef,
  onDrawerUploadSelected,
  onDrawerUpload,
  renamingId,
  renameValue,
  onRenameFile,
  setRenamingId,
  setRenameValue,
  onDeleteFile,
}) {
  if (!leftMounted) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="absolute inset-y-0 left-0 z-40 flex"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDrawer()
      }}
    >
      <div
        ref={leftTrapRef}
        className={`w-[300px] h-full bg-[var(--oc-surface)] border-r border-[var(--oc-border)] shadow-xl outline-none transform transition-transform duration-200 ${leftOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-12 px-3 border-b border-[var(--oc-border)] flex items-center justify-between">
          <div className="text-sm font-medium">Files</div>
          <button
            onClick={closeDrawer}
            className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
            aria-label="Close drawer"
            title="Close"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="p-3">
          {leftTab === 'files' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--oc-muted)]">Max 5 items</div>
                <div className="flex items-center gap-1">
                  <button
                    data-testid="tid-add-file"
                    className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
                    title="Add new file (name only)"
                    aria-label="Add new file"
                    onClick={addFileInDrawer}
                  >
                    <Icon name="plus" />
                  </button>
                  <input ref={uploadInDrawerRef} type="file" className="hidden" onChange={onDrawerUploadSelected} />
                  <button
                    data-testid="tid-upload-file"
                    className="p-2 rounded hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
                    title="Upload file (name shown without extension)"
                    aria-label="Upload file"
                    onClick={onDrawerUpload}
                  >
                    <Icon name="upload" />
                  </button>
                </div>
              </div>

              <ul
                data-testid="tid-files-list"
                className="space-y-1"
                role="listbox"
                aria-label="Files list"
              >
                {files.length === 0 && (
                  <li className="text-sm text-[var(--oc-muted)]">No files yet. Click + to add.</li>
                )}
                {files.map((f) => (
                  <li
                    key={f.id}
                    className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm cursor-pointer ${activeFileId === f.id ? 'oc-selected' : 'hover:bg-[var(--oc-surface-2)]'}`}
                    onClick={() => setActiveFileId(f.id)}
                    aria-selected={activeFileId === f.id ? 'true' : 'false'}
                    role="option"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name="file" />
                      {renamingId === f.id ? (
                        <form
                          className="flex-1 min-w-0"
                          onSubmit={(e) => {
                            e.preventDefault()
                            const ok = onRenameFile(f.id, renameValue)
                            if (ok) {
                              setRenamingId(null)
                              setRenameValue('')
                            }
                          }}
                        >
                          <input
                            className="w-full bg-transparent border-b border-[var(--oc-border)] focus:border-[var(--oc-primary-600)] outline-none"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => {
                              setRenamingId(null)
                              setRenameValue('')
                            }}
                            aria-label="Rename file"
                            autoFocus
                          />
                        </form>
                      ) : (
                        <span className="truncate">{f.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button
                        className="p-1 rounded hover:bg-[var(--oc-surface-2)]"
                        aria-label="Rename"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(f.id)
                          setRenameValue(f.name)
                        }}
                        title="Rename (inline)"
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-[var(--oc-surface-2)]"
                        aria-label="Delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteFile(f.id)
                        }}
                        title="Delete (confirm)"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-[var(--oc-muted)]">
                Static placeholder -- non-functional for now. Renders a simple list with add/remove disabled and a tooltip "Coming soon".
              </div>
              <ul className="text-sm list-disc pl-5 space-y-1">
                <li>python: requests</li>
                <li>node: lodash</li>
                <li>java: junit</li>
              </ul>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 rounded bg-[var(--oc-surface-2)] cursor-not-allowed" title="Coming soon" aria-disabled="true">Add</button>
                <button className="px-3 py-1.5 rounded bg-[var(--oc-surface-2)] cursor-not-allowed" title="Coming soon" aria-disabled="true">Remove</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="w-5 h-full" />
    </div>
  )
}

