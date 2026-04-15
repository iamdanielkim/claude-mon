export const theme = {
  // Status icons — using ASCII-safe chars to avoid East Asian "Ambiguous" width
  // symbols like ●/◐/○ render as 2 columns in CJK locales but Ink counts them as 1,
  // causing cursor drift and garbled output after a few re-renders.
  icons: { running: '>', idle: '~', completed: '-', error: '!' },
  // Tree drawing characters
  treeChars: { branch: '├── ', last: '└── ', pipe: '│   ', noTool: '-' },
  // Colors (ink color names)
  colors: {
    running: 'green',
    idle: 'yellow',
    completed: 'gray',
    error: 'red',
    sessionHeader: 'white',
    treeLines: 'cyan',
    columnHeader: 'white',
    cost: 'yellow',
    modelName: 'cyan',
  },
}

export const COLUMN_WIDTHS = {
  icon: 2,
  name: 32,
  model: 14,
  tool: 20,
  status: 9,
  created: 8,
  elapsed: 8,
  tokens: 8,
  cost: 8,
}
