export default function QuickOpenModal({
  quickOpen,
  quickTrapRef,
  quickQuery,
  setQuickQuery,
  quickList,
  chooseQuick,
  setQuickOpen,
}) {
  if (!quickOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) setQuickOpen(false)
      }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        ref={quickTrapRef}
        className="relative z-10 w-[92vw] max-w-lg rounded-lg border border-[var(--oc-border)] bg-[var(--oc-surface)] p-3 shadow-2xl outline-none"
      >
        <input
          autoFocus
          placeholder="Type a file name..."
          value={quickQuery}
          onChange={(e) => setQuickQuery(e.target.value)}
          className="oc-input"
          aria-label="Quick open query"
        />
        <ul className="mt-2 max-h-64 overflow-auto">
          {quickList.map((f) => (
            <li key={f.id}>
              <button
                className="w-full text-left px-3 py-2 rounded hover:bg-[var(--oc-surface-2)]"
                onClick={() => chooseQuick(f.id)}
              >
                {f.name}
              </button>
            </li>
          ))}
          {quickList.length === 0 && (
            <li className="px-3 py-2 text-sm text-[var(--oc-muted)]">No matches</li>
          )}
        </ul>
      </div>
    </div>
  )
}

