import { useEffect, useRef, useState } from 'react'

export function Icon({ name, className = 'size-4', strokeWidth = 2, label }) {
  const props = {
    width: '1em',
    height: '1em',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': label ? 'false' : 'true',
    role: 'img',
    'aria-label': label || undefined,
    className,
  }
  switch (name) {
    case 'panel-left-open':
      return (<svg {...props}><rect x="3" y="4" width="6" height="16" /><rect x="9" y="4" width="12" height="16" opacity=".2"/><path d="M7 8l-2 4 2 4" /></svg>)
    case 'panel-right-close':
      return (<svg {...props}><rect x="3" y="4" width="18" height="16" opacity=".2"/><rect x="15" y="4" width="6" height="16" /><path d="M17 8l2 4-2 4" /></svg>)
    case 'plus':
      return (<svg {...props}><path d="M12 5v14M5 12h14" /></svg>)
    case 'upload':
      return (<svg {...props}><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></svg>)
    case 'settings':
      return (<svg {...props}><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 008.6 15a1.65 1.65 0 00-1.82-.33l-.06.06A2 2 0 017.04 4.29l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0015 8.6c.41 0 .8-.16 1.09-.46l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 15z" /></svg>)
    case 'search':
      return (<svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>)
    case 'wand':
      return (<svg {...props}><path d="M15 4V2M15 10v-2M19 6h2M11 6H9M17.5 8.5l1.5 1.5M12.5 3.5L11 2M3 21l9-9" /></svg>)
    case 'trash':
      return (<svg {...props}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>)
    case 'pencil':
      return (<svg {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>)
    case 'file':
      return (<svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>)
    case 'chevron-right':
      return (<svg {...props}><path d="M9 18l6-6-6-6" /></svg>)
    case 'chevron-left':
      return (<svg {...props}><path d="M15 18l-6-6 6-6" /></svg>)
    case 'x':
      return (<svg {...props}><path d="M18 6L6 18M6 6l12 12" /></svg>)
    case 'play':
      return (<svg {...props}><path d="M7 6v12l10-6-10-6z" /></svg>)
    case 'stop':
      return (<svg {...props}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>)
    case 'pause':
      return (<svg {...props}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>)
    default:
      return null
  }
}

export function ManualLanguagePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const options = [
    { id: '', label: 'Select language…' },
    { id: 'python', label: 'Python' },
    { id: 'javascript', label: 'JavaScript' },
    { id: 'java', label: 'Java' },
    { id: 'cpp', label: 'C++' },
    { id: 'go', label: 'Go' },
    { id: 'plaintext', label: 'Plain Text' },
  ]
  const current = options.find(o => o.id === value)?.label || 'Select language…'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="h-9 min-w-[12rem] px-3 inline-flex items-center justify-between rounded-md border border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-fg)] hover:bg-[var(--oc-surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--oc-ring)]"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen(v => !v)}
      >
        <span className="truncate">{current}</span>
        <span className="ml-2 opacity-80"><Icon name="chevron-right" className="size-3 rotate-90" /></span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-10 right-0 mt-1 w-48 max-h-60 overflow-auto rounded-md border border-[var(--oc-border)] bg-[var(--oc-surface)] text-[var(--oc-fg)] shadow-xl"
        >
          {options.map(opt => (
            <li key={opt.id}>
              <button
                role="option"
                aria-selected={value === opt.id}
                onClick={() => { onChange(opt.id); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--oc-surface-2)] ${value === opt.id ? 'bg-[var(--oc-surface-2)]' : ''}`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}