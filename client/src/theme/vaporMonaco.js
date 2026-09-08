export const VAPOR_MONACO_THEME = 'oc-vaporwave'

let defined = false

export const ensureVaporMonacoTheme = (monaco) => {
  if (defined || !monaco?.editor?.defineTheme) return
  monaco.editor.defineTheme(VAPOR_MONACO_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'f6ecff', background: '1c1140' },
      { token: 'comment', foreground: '8f7ab8', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff8fe3', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: 'ff8fe3', fontStyle: 'bold' },
      { token: 'string', foreground: '7cf5c8' },
      { token: 'number', foreground: 'ffd98a' },
      { token: 'regexp', foreground: 'ff9db5' },
      { token: 'type', foreground: '6ae0ff' },
      { token: 'type.identifier', foreground: '6ae0ff' },
      { token: 'identifier', foreground: 'e8dcff' },
      { token: 'function', foreground: '6ae0ff' },
      { token: 'variable', foreground: 'e8dcff' },
      { token: 'variable.predefined', foreground: 'b39dff' },
      { token: 'constant', foreground: 'ffd98a' },
      { token: 'operator', foreground: 'ff8fe3' },
      { token: 'delimiter', foreground: 'b9a6dd' },
      { token: 'tag', foreground: 'ff8fe3' },
      { token: 'attribute.name', foreground: 'b39dff' },
      { token: 'attribute.value', foreground: '7cf5c8' },
    ],
    colors: {
      'editor.background': '#1c1140',
      'editor.foreground': '#f6ecff',
      'editorLineNumber.foreground': '#7c68a8',
      'editorLineNumber.activeForeground': '#ff8fe3',
      'editorCursor.foreground': '#ff8fe3',
      'editor.selectionBackground': '#4a2a7a',
      'editor.inactiveSelectionBackground': '#33205c',
      'editor.lineHighlightBackground': '#241650',
      'editorIndentGuide.background': '#33205c',
      'editorIndentGuide.activeBackground': '#6ae0ff',
      'editorWhitespace.foreground': '#3a2560',
      'editorGutter.background': '#1c1140',
      'editorBracketMatch.background': '#4a2a7a',
      'editorBracketMatch.border': '#6ae0ff',
      'editorWidget.background': '#241650',
      'editorWidget.border': '#ff8fe3',
      'editorSuggestWidget.background': '#241650',
      'editorSuggestWidget.selectedBackground': '#4a2a7a',
      'scrollbarSlider.background': '#4a2a7a80',
      'scrollbarSlider.hoverBackground': '#6a3f9ea0',
    },
  })
  defined = true
}
