// Nerd Font glyphs and colors in the spirit of eza --icons.
export type Icon = { glyph: string; color: string }

const FALLBACK: Icon = { glyph: '', color: '#8a8f98' }

const BY_NAME: Record<string, Icon> = {
  'cargo.toml': { glyph: '', color: '#dea584' },
  'cargo.lock': { glyph: '', color: '#9a7b62' },
  'dockerfile': { glyph: '', color: '#0db7ed' },
  '.gitignore': { glyph: '', color: '#f14e32' },
  'makefile': { glyph: '', color: '#a0a6b0' },
  'justfile': { glyph: '', color: '#a0a6b0' },
  'license': { glyph: '', color: '#d0bf41' },
}

const BY_EXT: Record<string, Icon> = {
  md: { glyph: '', color: '#5fa8d3' },
  mdx: { glyph: '', color: '#5fa8d3' },
  rs: { glyph: '', color: '#dea584' },
  ts: { glyph: '', color: '#3b8eea' },
  tsx: { glyph: '', color: '#61dafb' },
  js: { glyph: '', color: '#e8d44d' },
  jsx: { glyph: '', color: '#61dafb' },
  mjs: { glyph: '', color: '#e8d44d' },
  json: { glyph: '', color: '#cbcb41' },
  toml: { glyph: '', color: '#c07a52' },
  yaml: { glyph: '', color: '#e06c75' },
  yml: { glyph: '', color: '#e06c75' },
  sh: { glyph: '', color: '#89e051' },
  bash: { glyph: '', color: '#89e051' },
  zsh: { glyph: '', color: '#89e051' },
  fish: { glyph: '', color: '#89e051' },
  py: { glyph: '', color: '#4b8bbe' },
  go: { glyph: '', color: '#00add8' },
  html: { glyph: '', color: '#e34c26' },
  css: { glyph: '', color: '#7d5fc2' },
  sql: { glyph: '', color: '#dad8d8' },
  lock: { glyph: '', color: '#7a7f88' },
  txt: { glyph: '', color: '#a0a6b0' },
  log: { glyph: '', color: '#7a7f88' },
  csv: { glyph: '', color: '#89e051' },
  svg: { glyph: '', color: '#ffb13b' },
  png: { glyph: '', color: '#a074c4' },
  jpg: { glyph: '', color: '#a074c4' },
  pdf: { glyph: '', color: '#e06c75' },
}

export const iconFor = (path: string): Icon => {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  if (BY_NAME[name]) return BY_NAME[name]
  if (name.startsWith('readme')) return BY_EXT.md ?? FALLBACK
  const dot = name.lastIndexOf('.')

  return dot > 0 ? BY_EXT[name.slice(dot + 1)] ?? FALLBACK : FALLBACK
}
