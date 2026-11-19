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

// Built things that are neither plans nor code, by family: each gets its family's file glyph.
const FAMILIES: [string[], Icon][] = [
  [['pptx', 'ppt', 'key', 'odp'], { glyph: '', color: '#d24726' }],
  [['docx', 'doc', 'pages', 'odt', 'rtf'], { glyph: '', color: '#2b579a' }],
  [['xlsx', 'xls', 'numbers', 'ods'], { glyph: '', color: '#217346' }],
  [['jpeg', 'gif', 'webp', 'heic', 'ico', 'bmp', 'tif', 'tiff', 'avif'], { glyph: '', color: '#a074c4' }],
  [['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'], { glyph: '', color: '#fd971f' }],
  [['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'aiff'], { glyph: '', color: '#ee82ee' }],
  [['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'dmg', 'pkg'], { glyph: '', color: '#eca517' }],
  [['ttf', 'otf', 'woff', 'woff2'], { glyph: '', color: '#c0c4cc' }],
]
for (const [exts, icon] of FAMILIES) for (const ext of exts) BY_EXT[ext] ??= icon

// Code: source, config and markup extensions. Everything not code or planning goes to misc.
const CODE_EXTS = new Set([
  'rs', 'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyi', 'go', 'rb', 'java', 'kt', 'kts', 'scala',
  'swift', 'm', 'mm', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'fs', 'php', 'pl', 'pm', 'lua', 'r', 'jl',
  'dart', 'ex', 'exs', 'erl', 'hs', 'ml', 'mli', 'clj', 'cljs', 'elm', 'nim', 'zig', 'vue', 'svelte', 'astro',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'nu', 'awk', 'sed',
  'json', 'jsonc', 'json5', 'jsonl', 'toml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'properties', 'env', 'plist',
  'lock', 'tf', 'hcl', 'nix', 'gradle', 'cmake', 'mk', 'kdl', 'proto', 'graphql', 'gql', 'sql', 'prisma',
  'html', 'htm', 'xml', 'xsl', 'css', 'scss', 'sass', 'less', 'tex', 'rst', 'adoc', 'org',
  'diff', 'patch', 'ipynb', 'd',
])
// Code files with no extension, by name.
const CODE_NAMES = new Set([
  'makefile', 'gnumakefile', 'dockerfile', 'containerfile', 'justfile', 'rakefile', 'gemfile', 'procfile',
  'vagrantfile', 'brewfile', 'podfile', 'jenkinsfile', 'caddyfile', 'license', 'licence', 'copying', 'readme',
  'codeowners', 'owners', 'notice', 'authors',
])

// A known source, config or markup extension, a known extensionless name, or a dotfile.
export const isCode = (path: string) => {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  if (CODE_NAMES.has(name) || name.startsWith('.')) return true
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return CODE_NAMES.has(name.replace(/[-_.].*$/, ''))

  return CODE_EXTS.has(name.slice(dot + 1))
}

export const iconFor = (path: string): Icon => {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  if (BY_NAME[name]) return BY_NAME[name]
  if (name.startsWith('readme')) return BY_EXT.md ?? FALLBACK
  const dot = name.lastIndexOf('.')

  return dot > 0 ? BY_EXT[name.slice(dot + 1)] ?? FALLBACK : FALLBACK
}
