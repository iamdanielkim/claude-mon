export const theme = {
  // Status icons
  icons: {
    running: '●',
    idle: '◐',
    completed: '○',
    error: '✕',
  },
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
  elapsed: 8,
  tokens: 8,
  cost: 8,
}
