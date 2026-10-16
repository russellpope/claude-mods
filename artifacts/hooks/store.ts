import type { ArtifactMeta } from '../types'

export const MAX_BODY = 60_000
export const DEFAULT_KIND = 'notes'
const SLUG_MAX = 48

/** A title as an id's tail: lowercase letters, digits and single hyphens, at most 48 characters. */
export function slugify(title: string): string {
  const s = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, SLUG_MAX).replace(/-+$/, '') || 'artifact'
}

/** The local calendar date of `ms`: YYYY-MM-DD. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A new artifact's id: its date and slug, then -2, -3 and on past the ids already taken. */
export function newId(title: string, now: number, taken: ReadonlySet<string>): string {
  const base = `${localDate(now)}-${slugify(title)}`
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

const FIELDS = ['title', 'kind', 'version', 'created', 'updated', 'branch', 'session'] as const

/** The file: its header, a blank line, then the body, ending in a newline. */
export function renderFile(meta: ArtifactMeta, body: string): string {
  const line = (k: (typeof FIELDS)[number]) => `${k}: ${String(meta[k]).replace(/\s*\n\s*/g, ' ')}`
  return ['---', ...FIELDS.map(line), '---', '', body.endsWith('\n') ? body : `${body}\n`].join('\n')
}

/** A file read back: its header, or for a file without one, its name, kind `?`, version 1 and its time. */
export function parseFile(id: string, text: string, mtimeMs: number): { meta: ArtifactMeta; body: string } {
  const at = new Date(mtimeMs).toISOString()
  const fallback: ArtifactMeta = { id, title: id, kind: '?', version: 1, created: at, updated: at, branch: '', session: '' }
  const head = /^---\n([\s\S]*?)\n---\n\n?/.exec(text)
  if (!head) return { meta: fallback, body: text }
  const fields: Record<string, string> = {}
  for (const line of (head[1] ?? '').split('\n')) {
    const cut = line.indexOf(': ')
    if (cut > 0) fields[line.slice(0, cut)] = line.slice(cut + 2)
    else if (line.endsWith(':')) fields[line.slice(0, -1)] = ''
  }
  const version = Number.parseInt(fields.version ?? '', 10)
  return {
    meta: {
      id,
      title: fields.title || id,
      kind: fields.kind || '?',
      version: version > 0 ? version : 1,
      created: fields.created || at,
      updated: fields.updated || fields.created || at,
      branch: fields.branch ?? '',
      session: fields.session ?? '',
    },
    body: text.slice(head[0].length),
  }
}

/** The history folder's name for a project root: its base name and the first 8 hex digits of the root's SHA-256. */
export async function projectKey(root: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(root))
  const hex = [...new Uint8Array(digest)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${root.replace(/\/+$/, '').split('/').pop() || 'root'}-${hex}`
}

export const newestFirst = (items: ArtifactMeta[]): ArtifactMeta[] =>
  [...items].sort((a, b) => b.updated.localeCompare(a.updated) || b.id.localeCompare(a.id))

/** The filter: title, kind or id holds the query, ignoring case; a blank query matches all. */
export function matchesQuery(m: ArtifactMeta, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || [m.title, m.kind, m.id].some(s => s.toLowerCase().includes(q))
}

/** What the list tool answers: the folder, then `id · kind · v<N> · updated · title`, newest first. */
export function listText(dir: string, items: ArtifactMeta[], query: string, limit: number): string {
  const hits = newestFirst(items).filter(m => matchesQuery(m, query))
  if (!hits.length) return `no artifacts${query.trim() ? ` matching "${query.trim()}"` : ''} in ${dir}`
  return [
    `${Math.min(hits.length, limit)} of ${items.length} in ${dir} (each <id>.md):`,
    ...hits.slice(0, limit).map(m => `${m.id} · ${m.kind} · v${m.version} · ${m.updated} · ${m.title}`),
  ].join('\n')
}

export type ShowArgs = { title: string; body: string; kind?: string; id?: string }

/** The show tool's input checked: trimmed, one-line title and kind; refusals in words the model can act on. */
export function checkShow(input: Record<string, unknown>): ShowArgs | { error: string } {
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  const title = text(input.title).replace(/\s+/g, ' ').trim()
  const body = text(input.body)
  const kind = text(input.kind).replace(/\s+/g, ' ').trim()
  const id = text(input.id).trim()
  if (!title) return { error: 'title is empty' }
  if (!body.trim()) return { error: 'body is empty' }
  if (body.length > MAX_BODY) return { error: `body is ${body.length.toLocaleString('en-US')} characters, over 60,000 characters: split it into several artifacts` }
  return { title, body, ...(kind ? { kind } : {}), ...(id ? { id } : {}) }
}

/** How long ago, in its largest whole unit: 5s, 2m, 3h, 2d. */
export function fmtAge(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}
