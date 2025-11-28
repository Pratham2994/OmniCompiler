import { useEffect, useRef, useState } from 'react'

export default function useMonacoEditor({ activeFile, activeFileId, effectiveLanguage, theme, setFiles, filesLength }) {
  const editorContainerRef = useRef(null)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const modelsRef = useRef(new Map())
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 })
  const [monacoReady, setMonacoReady] = useState(Boolean(window.monaco))
  const [editorReady, setEditorReady] = useState(false)

  useEffect(() => {
    const handleReady = () => setMonacoReady(true)
    window.addEventListener('monaco_ready', handleReady)
    if (window.monaco) setMonacoReady(true)
    return () => {
      window.removeEventListener('monaco_ready', handleReady)
    }
  }, [])

  useEffect(() => {
    if (!monacoReady) return
    if (editorRef.current) return
    const el = editorContainerRef.current
    if (!el) return

    const monaco = window.monaco
    monacoRef.current = monaco

    const ensureModel = (file) => {
      let m = modelsRef.current.get(file.id)
      if (!m) {
        m = monaco.editor.createModel(file.content, 'plaintext')
        modelsRef.current.set(file.id, m)
        m.onDidChangeContent(() => {
          const value = m.getValue()
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, content: value } : f))
        })
      }
      return m
    }

    const themeName = {
      'vscode-dark-plus': 'vs-dark',
      'vscode-light-plus': 'vs',
      'vscode-high-contrast': 'hc-black',
    }[theme] || 'vs-dark'

    const editor = monaco.editor.create(el, {
      value: activeFile?.content ?? '',
      language: effectiveLanguage || 'plaintext',
      automaticLayout: true,
      minimap: { enabled: true },
      theme: themeName,
      fontSize: 14,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'all',
      glyphMargin: true,
      lineDecorationsWidth: 16,
      cursorBlinking: 'smooth',
      tabSize: 4,
      insertSpaces: true,
      roundedSelection: true,
      wordWrap: 'off',
      contextmenu: true,
      renderWhitespace: 'selection',
      renderIndentGuides: true,
      bracketPairColorization: { enabled: true },
    })

    editor.onDidChangeCursorPosition((ev) => {
      setCursorPos({ line: ev.position.lineNumber, column: ev.position.column })
    })

    if (activeFile) {
      const model = ensureModel(activeFile)
      editor.setModel(model)
      monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
    }

    editorRef.current = editor
    setEditorReady(true)

    return () => {
      editorRef.current = null
      editor.dispose()
      setEditorReady(false)
    }
  }, [monacoReady])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    const conf = {
      'vscode-dark-plus': 'vs-dark',
      'vscode-light-plus': 'vs',
      'vscode-high-contrast': 'hc-black',
    }[theme] || 'vs-dark'
    monaco.editor.setTheme(conf)
  }, [theme])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const model = editor.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
  }, [effectiveLanguage])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor || !activeFile) return

    let model = modelsRef.current.get(activeFile.id)
    if (!model) {
      model = monaco.editor.createModel(activeFile.content, 'plaintext')
      modelsRef.current.set(activeFile.id, model)
      model.onDidChangeContent(() => {
        const value = model.getValue()
        setFiles(prev => prev.map(f => f.id === activeFile.id ? { ...f, content: value } : f))
      })
    }
    editor.setModel(model)
    monaco.editor.setModelLanguage(model, effectiveLanguage || 'plaintext')
    const pos = editor.getPosition()
    if (pos) setCursorPos({ line: pos.lineNumber, column: pos.column })
  }, [activeFileId, filesLength, effectiveLanguage, activeFile?.id])

  return {
    editorContainerRef,
    editorRef,
    monacoRef,
    modelsRef,
    cursorPos,
    monacoReady,
    editorReady,
  }
}
