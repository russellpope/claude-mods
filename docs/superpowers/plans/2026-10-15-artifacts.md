# artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod, `artifacts/`. Its tools let Claude post designs, plans and diagrams to a pane, and each project keeps a versioned history in `~/.claude/artifacts/<project>/`.

**Architecture:**
- `store.ts`: pure functions for ids, file headers and the project folder name.
- `history.ts`: everything that touches `$.fs`, `$.session` and git.
- `pane.tsx`: draws the list and the reader from a plain model.
- `register.tsx`: wires the tools, the `/artifacts` command, the 5 s refresh and the render hook.

State lives in atoms, as kintsugi-runs keeps its own.

**Tech Stack:** Claude Code function-hooks mods (types written by Claude Code 2.1.300), TSX against the surface's element table, `claude-code/testing` (`claude plugin test`).

**Spec:** `docs/superpowers/specs/2026-10-15-artifacts-design.md` (read it first). Terms are as in `GLOSSARY.md`.

## Global Constraints

- **History:** `~/.claude/artifacts/<project>/`, outside every repo. `<project>` is the root's base name, `-`, and the first 8 hex digits of the SHA-256 of the root path. The root is `$.session.repo()?.root` ("the main working tree's for a worktree"), else `$.session.root()`.
- **Tools:**
  - `mcp__artifacts__show` `{ title, body, kind?, id? }` and `mcp__artifacts__list` `{ query?, limit? }`.
  - Both are registered with `isDeferred: false`.
  - The `list` limit defaults to 20.
- **Body limit:** at most 60,000 characters. The description asks for diagrams within 64 columns.
- **The `show` result line:** `posted <id> v<N> · <path with ~ for HOME>`.
- **ids:** `<local YYYY-MM-DD>-<slug>`, where the slug is lowercase letters, digits and hyphens, at most 48 characters. Then `-2`, `-3`, … when the id is taken. An id never changes.
- **Versions:** a new version copies the current file to `.versions/<id>/v<N>.md`, then overwrites `<id>.md`.
- **Header fields, in order:** `title, kind, version, created, updated, branch, session`. The default kind is `notes`.
- **Reader width:** `ui.open({ columns: min(100, floor(viewportColumns / 2)) })` once a render has reported `viewport.columns`. Before that, no `columns`.
- **Refresh:** every 5 s while the pane is open. A session that never opens it reads nothing on a timer.
- **Keep in repo:** writes `<$.session.root()>/docs/artifacts/<id>.md`. Never commits.
- **Editor:** the `editor` setting, default `zed`, as in outputs-pane.
- **Repo rules:**
  - Stage explicit paths only.
  - Write commit messages to a scratch file and use `git commit -F`.
  - End each message with the session's attribution lines.

## Review Focus

1. **A title with no letters or digits** (`❓ → ✓`) still gets a valid id (`<date>-artifact`), never `<date>-`. *Test in Task 1.*
2. **A hand-edited header** whose title holds `: ` (`title: Plan: phase 2`) reads back as `Plan: phase 2`. *Test in Task 1.*
3. **The same title posted three times in a day** gets `…-2`, then `…-3`, never overwriting. *Test in Task 2.*
4. **HOME unset, or a write that fails:** `show` refuses with the reason, and the pane shows the error line instead of failing to draw. *Test in Tasks 2 and 3.*
5. **A version file is byte-for-byte the version it replaced,** including a body with no trailing newline. *Test in Task 2.*

---

## File Structure

```
artifacts/
  .claude-plugin/plugin.json   manifest: name, version, editor setting, types
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/store.ts               pure: slugify, newId, renderFile, parseFile, projectKey, sorting, list text, input checks, ages
  hooks/history.ts             $-facing: historyDir, readHistory, readArtifact, post, currentBranch, keepInRepo
  hooks/pane.tsx               drawPane(ui, model): list and reader
  hooks/register.tsx           tools, /artifacts, timers, render hook
  hooks/store.test.ts          unit tests for store.ts
  hooks/register.test.tsx      kit tests through tools, command, mount
  types/index.d.ts             ArtifactMeta, HistoryView, PaneView, Shown, PluginState
  README.md
README.md (root)               a row in the mod table
```

---

### Task 1: Scaffold and the pure store

**Files:**
- Create: `artifacts/.claude-plugin/plugin.json`, `artifacts/hooks/hooks.json`, `artifacts/types/index.d.ts`, `artifacts/hooks/store.ts`, `artifacts/hooks/store.test.ts`, `artifacts/hooks/register.tsx` (an empty register, so the module loads)

**Interfaces:**
- Produces (from `store.ts`):
  - **Constants:** `MAX_BODY = 60_000`, `DEFAULT_KIND = 'notes'`.
  - **ids and headers:**
    - `slugify(title: string): string`
    - `localDate(ms: number): string`
    - `newId(title: string, now: number, taken: ReadonlySet<string>): string`
    - `renderFile(meta: ArtifactMeta, body: string): string`
    - `parseFile(id: string, text: string, mtimeMs: number): { meta: ArtifactMeta; body: string }`
  - **Project folder:** `projectKey(root: string): Promise<string>`
  - **Lists:**
    - `newestFirst(items: ArtifactMeta[]): ArtifactMeta[]`
    - `matchesQuery(m: ArtifactMeta, query: string): boolean`
    - `listText(dir: string, items: ArtifactMeta[], query: string, limit: number): string`
  - **Tool input:** `checkShow(input: Record<string, unknown>): ShowArgs | { error: string }`, where `ShowArgs = { title: string; body: string; kind?: string; id?: string }`
  - **Ages:** `fmtAge(ms: number): string`
- Produces (from `types/index.d.ts`): `ArtifactMeta`, `HistoryView`, `PaneView`, `Shown`, and `PluginState['artifacts']`.

- [ ] **Step 1: Write the scaffold files**

`artifacts/.claude-plugin/plugin.json`:

```json
{
  "name": "artifacts",
  "version": "0.1.0",
  "description": "Claude posts designs, plans and diagrams to a pane; each project keeps a versioned history in ~/.claude/artifacts/",
  "author": { "name": "Russell Pope", "url": "https://github.com/russellpope" },
  "homepage": "https://github.com/russellpope/claude-mods/tree/main/artifacts",
  "repository": "https://github.com/russellpope/claude-mods",
  "license": "Apache-2.0",
  "types": "./types/index.d.ts",
  "userConfig": {
    "editor": {
      "type": "string",
      "title": "Editor command",
      "description": "Command that opens an artifact's file; the path is added as the last argument (e.g. zed, code -r, subl)",
      "default": "zed"
    }
  }
}
```

`artifacts/hooks/hooks.json`:

```json
{ "modules": ["./register.tsx"] }
```

`artifacts/types/index.d.ts`:

```ts
/** One artifact's header: the file's frontmatter, its id the file name without `.md`. */
export type ArtifactMeta = {
  id: string
  title: string
  /** design, plan, diagram, comparison, summary, notes, exploration, or `?` for a file without a header */
  kind: string
  version: number
  /** ISO 8601, UTC */
  created: string
  updated: string
  /** The posting session's branch; empty when unknown. */
  branch: string
  /** The posting session's id. */
  session: string
}

/** This session's project history, as the pane draws it. */
export type HistoryView = {
  /** The history folder, absolute; empty before the first read. */
  dir: string
  /** The project's name for the header: the root's base name. */
  project: string
  items: ArtifactMeta[]
  /** The last read's or post's failure, in words; empty when none. */
  error: string
}

/** Which view the pane shows. */
export type PaneView = { view: 'list' } | { view: 'reader'; id: string }

/** The artifact the reader shows: one version's header and body. */
export type Shown = { meta: ArtifactMeta; body: string; latest: number; path: string }

declare module 'claude-code' {
  interface PluginState {
    artifacts: {
      history: HistoryView
      pane: PaneView
      query: string
      /** ids this session posted, for the list's marker. */
      mine: string[]
      shown: Shown | null
    }
  }
}
```

`artifacts/hooks/register.tsx` (filled in from Task 2 on):

```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 2: Write the failing tests**

`artifacts/hooks/store.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import type { ArtifactMeta } from '../types'
import { checkShow, fmtAge, listText, localDate, matchesQuery, newId, newestFirst, parseFile, projectKey, renderFile, slugify } from './store'

// 2026-10-15 14:02:11 local time.
const NOW = new Date(2026, 9, 15, 14, 2, 11).getTime()
const META: ArtifactMeta = {
  id: '2026-10-15-auth-flow', title: 'Auth flow', kind: 'diagram', version: 2,
  created: '2026-10-15T21:02:11.000Z', updated: '2026-10-15T22:40:00.000Z', branch: 'artifacts', session: 's-1',
}

describe('ids', () => {
  test('a title becomes lowercase letters, digits and single hyphens', () => {
    expect(slugify('Auth flow: v2 (draft)')).toBe('auth-flow-v2-draft')
    expect(slugify('  Queue vs. running  ')).toBe('queue-vs-running')
  })

  test('a slug is at most 48 characters and never ends in a hyphen', () => {
    const s = slugify('a'.repeat(47) + ' bcd')
    expect(s.length).toBeLessThanOrEqual(48)
    expect(s.endsWith('-')).toBe(false)
  })

  test('a title with no letters or digits still makes an id', () => {
    expect(slugify('❓ → ✓')).toBe('artifact')
    expect(newId('❓ → ✓', NOW, new Set())).toBe('2026-10-15-artifact')
  })

  test('the date is the local calendar date', () => {
    expect(localDate(NOW)).toBe('2026-10-15')
  })

  test('a taken id gets -2, then -3', () => {
    expect(newId('Auth flow', NOW, new Set())).toBe('2026-10-15-auth-flow')
    expect(newId('Auth flow', NOW, new Set(['2026-10-15-auth-flow']))).toBe('2026-10-15-auth-flow-2')
    expect(newId('Auth flow', NOW, new Set(['2026-10-15-auth-flow', '2026-10-15-auth-flow-2']))).toBe('2026-10-15-auth-flow-3')
  })
})

describe('files', () => {
  test('a file is its header, a blank line, then the body', () => {
    expect(renderFile(META, 'A → B')).toBe(
      '---\ntitle: Auth flow\nkind: diagram\nversion: 2\ncreated: 2026-10-15T21:02:11.000Z\nupdated: 2026-10-15T22:40:00.000Z\nbranch: artifacts\nsession: s-1\n---\n\nA → B\n',
    )
  })

  test('a header value keeps to one line', () => {
    expect(renderFile({ ...META, title: 'two\nlines' }, 'x')).toContain('title: two lines\n')
  })

  test('what renderFile writes, parseFile reads back', () => {
    const body = '```\n┌──┐\n└──┘\n```\n'
    expect(parseFile(META.id, renderFile(META, body), 0)).toEqual({ meta: META, body })
  })

  test("a title holding ': ' reads back whole", () => {
    const text = renderFile({ ...META, title: 'Plan: phase 2' }, 'x')
    expect(parseFile(META.id, text, 0).meta.title).toBe('Plan: phase 2')
  })

  test('an empty branch reads back empty', () => {
    expect(parseFile(META.id, renderFile({ ...META, branch: '' }, 'x'), 0).meta.branch).toBe('')
  })

  test('a file without a header: its name for a title, kind ?, version 1, its time for dates', () => {
    const { meta, body } = parseFile('notes-by-hand', '# Hand notes\n', Date.UTC(2026, 9, 1))
    expect(meta).toEqual({
      id: 'notes-by-hand', title: 'notes-by-hand', kind: '?', version: 1,
      created: '2026-10-01T00:00:00.000Z', updated: '2026-10-01T00:00:00.000Z', branch: '', session: '',
    })
    expect(body).toBe('# Hand notes\n')
  })
})

describe('the project folder', () => {
  test("the root's base name and 8 hex digits of its path's hash", async () => {
    const key = await projectKey('/Users/me/Projects/kintsugi')
    expect(key).toMatch(/^kintsugi-[0-9a-f]{8}$/)
    expect(await projectKey('/Users/me/Projects/kintsugi')).toBe(key)
  })

  test('two repos with one base name get different folders', async () => {
    expect(await projectKey('/a/kintsugi')).not.toBe(await projectKey('/b/kintsugi'))
  })
})

describe('lists', () => {
  const at = (id: string, updated: string, title = id, kind = 'notes'): ArtifactMeta => ({ ...META, id, title, kind, updated })
  const items = [at('a', '2026-10-14T10:00:00.000Z', 'Release plan', 'plan'), at('b', '2026-10-15T10:00:00.000Z', 'Auth flow', 'diagram')]

  test('newest update first', () => {
    expect(newestFirst(items).map(m => m.id)).toEqual(['b', 'a'])
  })

  test('the query matches title, kind or id, ignoring case; blank matches all', () => {
    expect(items.filter(m => matchesQuery(m, 'AUTH')).map(m => m.id)).toEqual(['b'])
    expect(items.filter(m => matchesQuery(m, 'plan')).map(m => m.id)).toEqual(['a'])
    expect(items.filter(m => matchesQuery(m, ' ')).length).toBe(2)
  })

  test('the list text names the folder, then one line per artifact', () => {
    expect(listText('~/.claude/artifacts/k-1', items, '', 20)).toBe(
      [
        '2 of 2 in ~/.claude/artifacts/k-1 (each <id>.md):',
        'b · diagram · v2 · 2026-10-15T10:00:00.000Z · Auth flow',
        'a · plan · v2 · 2026-10-14T10:00:00.000Z · Release plan',
      ].join('\n'),
    )
    expect(listText('~/x', items, 'zzz', 20)).toBe('no artifacts matching "zzz" in ~/x')
    expect(listText('~/x', items, '', 1).split('\n')).toHaveLength(2)
  })
})

describe('the show tool input', () => {
  test('title and body are required and trimmed; kind and id are optional', () => {
    expect(checkShow({ title: ' Auth flow ', body: 'x' })).toEqual({ title: 'Auth flow', body: 'x' })
    expect(checkShow({ title: 'T', body: 'x', kind: ' diagram ', id: 'i' })).toEqual({ title: 'T', body: 'x', kind: 'diagram', id: 'i' })
    expect(checkShow({ title: '', body: 'x' })).toEqual({ error: 'title is empty' })
    expect(checkShow({ title: 'T', body: '  ' })).toEqual({ error: 'body is empty' })
  })

  test('a body over 60,000 characters is refused, asking for a split', () => {
    const r = checkShow({ title: 'T', body: 'x'.repeat(60_001) })
    expect('error' in r && r.error).toMatch(/60,000 characters.*split/)
    expect(checkShow({ title: 'T', body: 'x'.repeat(60_000) })).not.toHaveProperty('error')
  })
})

describe('ages', () => {
  test('seconds, minutes, hours, then days', () => {
    expect(fmtAge(5_000)).toBe('5s')
    expect(fmtAge(125_000)).toBe('2m')
    expect(fmtAge(3 * 3_600_000)).toBe('3h')
    expect(fmtAge(50 * 3_600_000)).toBe('2d')
  })
})
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd artifacts && claude plugin test .`
Expected: `hooks/store.test.ts` fails to load: `Export named 'slugify' not found` (or the module isn't found).

- [ ] **Step 4: Write `store.ts`**

```ts
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
  if (body.length > MAX_BODY) return { error: `body is ${body.length.toLocaleString('en-US')} characters, over 60,000: split it into several artifacts` }
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
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd artifacts && claude plugin test .`
Expected: all `store.test.ts` tests pass. Then `claude plugin validate .`: passes.

- [ ] **Step 6: Commit**

```bash
git add artifacts/.claude-plugin/plugin.json artifacts/hooks/hooks.json artifacts/types/index.d.ts artifacts/hooks/store.ts artifacts/hooks/store.test.ts artifacts/hooks/register.tsx
git commit -F <scratch>/msg.txt   # "artifacts: ids, file headers and the project folder"
```

---

### Task 2: The history on disk, and the two tools

**Files:**
- Create: `artifacts/hooks/history.ts`, `artifacts/hooks/register.test.tsx`
- Modify: `artifacts/hooks/register.tsx`

**Interfaces:**
- Consumes: everything in `store.ts` from Task 1.
- Produces (from `history.ts`):
  - **Where:**
    - `historyDir($): Promise<{ dir: string; project: string; home: string }>` (it throws `Error('HOME is not set')`)
    - `tilde(path: string, home: string): string`
  - **Reading:**
    - `readHistory($, dir: string): Promise<ArtifactMeta[]>`
    - `readArtifact($, dir: string, id: string, version?: number): Promise<Shown>`
  - **Writing:**
    - `post($, dir: string, args: ShowArgs, now: number): Promise<ArtifactMeta>` (it throws `ShowError` with a reason for the model)
    - `keepInRepo($, dir: string, id: string): Promise<string>` (returns the path written)
  - **Git:** `currentBranch($): Promise<string>`
- Produces (from `register.tsx`):
  - **Exports:** `PANE = 'artifacts'`, and the atoms `history`, `pane`, `query`, `mine`, `shown`.
  - **Tools:** `mcp__artifacts__show` and `mcp__artifacts__list`, served.

- [ ] **Step 1: Write the failing tests**

`artifacts/hooks/register.test.tsx`:

```tsx
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type E = Parameters<TestBody>[0]

const HOME = '/Users/me'
const REPO = '/Users/me/Projects/kintsugi'
const WORKTREE = '/Users/me/worktrees/kintsugi-x'
// 2026-10-15 14:02:11 local time.
const NOW = new Date(2026, 9, 15, 14, 2, 11).getTime()

type Files = Map<string, { text: string; mtimeMs: number }>

/** An in-memory disk under the fs ops: write, read, exists, list (files and the folders they imply). */
const disk = (on: On, files: Files, failWrites = false) => {
  on('fs.write', async (_$, e) => {
    if (failWrites) throw new Error(`EACCES: permission denied, open '${e.path}'`)
    files.set(e.path, { text: e.text, mtimeMs: NOW })
    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    const f = files.get(e.path)
    if (!f) throw new Error(`ENOENT: no such file, open '${e.path}'`)
    return { value: f.text }
  })
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) || [...files.keys()].some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.list', async (_$, e) => {
    const prefix = `${e.path.replace(/\/$/, '')}/`
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, f] of files) {
      if (!path.startsWith(prefix)) continue
      const [name = '', ...rest] = path.slice(prefix.length).split('/')
      seen.set(name, rest.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })
    }
    return { value: [...seen.values()] }
  })
}

/** A session in a worktree of kintsugi, on branch `artifacts`, at NOW; returns the toasts it shows. */
const session = (on: On, opts: { home?: string | null; repo?: string | null; placed?: boolean; clock?: boolean } = {}) => {
  mock.env(on, opts.home === null ? {} : { HOME: opts.home ?? HOME })
  // A test driving mock.clock passes clock: false, so this hook doesn't answer clock.now beneath it.
  if (opts.clock !== false) on('clock.now', async () => ({ value: NOW }))
  on('session.repo', async () => ({ value: opts.repo === null ? null : { root: opts.repo ?? REPO, remote: null, internal: false, name: null } }))
  on('session.root', async () => ({ value: WORKTREE }))
  on('session.cwd', async () => ({ value: WORKTREE }))
  on('session.id', async () => ({ value: 's-1' }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'artifacts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  let isOpen = false
  on('ui.open', async () => {
    if (opts.placed === false) return { value: { isPlaced: false, reason: 'narrow' } }
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({ value: isOpen ? [{ id: 'artifacts', title: 'artifacts', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.close', async () => {
    isOpen = false
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  return { toasts }
}

const start = ($: E) => $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
const show = ($: E, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__artifacts__show', ...input })
const list = ($: E, input: Record<string, unknown> = {}) => $.tool.call({ tool: 'mcp__artifacts__list', ...input })

/** The project folder for REPO, found the way the mod finds it. */
const folder = (files: Files) => [...files.keys()].map(p => p.match(/^\/Users\/me\/\.claude\/artifacts\/[^/]+/)?.[0]).find(Boolean) ?? ''

describe('the show tool', () => {
  test('writes the artifact with its header and answers one line', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    const r = await show($, { title: 'Auth flow', body: '┌─┐\n└─┘', kind: 'diagram' })
    const dir = folder(files)
    expect(dir).toMatch(/^\/Users\/me\/\.claude\/artifacts\/kintsugi-[0-9a-f]{8}$/)
    expect(r.result).toBe(`posted 2026-10-15-auth-flow v1 · ${dir.replace(HOME, '~')}/2026-10-15-auth-flow.md`)
    expect(files.get(`${dir}/2026-10-15-auth-flow.md`)?.text).toBe(
      `---\ntitle: Auth flow\nkind: diagram\nversion: 1\ncreated: ${new Date(NOW).toISOString()}\nupdated: ${new Date(NOW).toISOString()}\nbranch: artifacts\nsession: s-1\n---\n\n┌─┐\n└─┘\n`,
    )
  })

  test('kind defaults to notes', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'T', body: 'x' })
    expect(files.get(`${folder(files)}/2026-10-15-t.md`)?.text).toContain('\nkind: notes\n')
  })

  test('the same title three times in a day: -2, then -3, none overwritten', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    for (const body of ['one', 'two', 'three']) await show($, { title: 'Auth flow', body })
    const dir = folder(files)
    expect(files.get(`${dir}/2026-10-15-auth-flow.md`)?.text).toContain('\n\none\n')
    expect(files.get(`${dir}/2026-10-15-auth-flow-2.md`)?.text).toContain('\n\ntwo\n')
    expect(files.get(`${dir}/2026-10-15-auth-flow-3.md`)?.text).toContain('\n\nthree\n')
  })

  test("an id adds a version: the old file kept byte for byte under .versions, the new one in its place", async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'Auth flow', body: 'first, no newline', kind: 'diagram' })
    const dir = folder(files)
    const v1 = files.get(`${dir}/2026-10-15-auth-flow.md`)?.text
    const r = await show($, { id: '2026-10-15-auth-flow', title: 'Auth flow, revised', body: 'second' })
    expect(r.result).toMatch(/^posted 2026-10-15-auth-flow v2 · /)
    expect(files.get(`${dir}/.versions/2026-10-15-auth-flow/v1.md`)?.text).toBe(v1)
    const v2 = files.get(`${dir}/2026-10-15-auth-flow.md`)?.text ?? ''
    expect(v2).toContain('\ntitle: Auth flow, revised\n')
    expect(v2).toContain('\nkind: diagram\n') // kept when not given
    expect(v2).toContain('\nversion: 2\n')
  })

  test('refuses an unknown id, pointing at list', async ($, on) => {
    disk(on, new Map())
    session(on)
    await start($)
    const r = await show($, { id: 'nope', title: 'T', body: 'x' })
    expect(r.deny).toMatch(/no artifact "nope".*mcp__artifacts__list/)
  })

  test('refuses an empty body and an oversized one', async ($, on) => {
    disk(on, new Map())
    session(on)
    await start($)
    expect((await show($, { title: 'T', body: '' })).deny).toBe('body is empty')
    expect((await show($, { title: 'T', body: 'x'.repeat(60_001) })).deny).toMatch(/over 60,000/)
  })

  test('refuses with the reason when the write fails', async ($, on) => {
    disk(on, new Map(), true)
    session(on)
    await start($)
    expect((await show($, { title: 'T', body: 'x' })).deny).toMatch(/EACCES/)
  })

  test('HOME not set: refused, saying so', async ($, on) => {
    disk(on, new Map())
    session(on, { home: null })
    await start($)
    expect((await show($, { title: 'T', body: 'x' })).deny).toMatch(/HOME is not set/)
  })
})

describe('the project', () => {
  // Inside a repo the folder is the main working tree's (the first show test: kintsugi-<hash>, though the session runs in kintsugi-x).
  test('outside a repo, the session root keys the folder', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on, { repo: null })
    await start($)
    await show($, { title: 'T', body: 'x' })
    expect(folder(files)).toMatch(/\/kintsugi-x-[0-9a-f]{8}$/)
  })
})

describe('the list tool', () => {
  test('newest first, with the folder named first; query and limit', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'Release plan', body: 'x', kind: 'plan' })
    await show($, { title: 'Auth flow', body: 'y', kind: 'diagram' })
    // Same NOW for both: the id breaks the tie, newest-looking first.
    const all = (await list($)).result as string
    expect(all.split('\n')[0]).toMatch(/^2 of 2 in ~\/\.claude\/artifacts\/kintsugi-[0-9a-f]{8} \(each <id>\.md\):$/)
    expect((await list($, { query: 'plan' })).result).toMatch(/release-plan · plan · v1/)
    expect(((await list($, { limit: 1 })).result as string).split('\n')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd artifacts && claude plugin test .`
Expected: the `register.test.tsx` tests fail. With an empty register, `$.tool.call` rejects or answers nothing: "no tool named mcp__artifacts__show", or `r.result` is undefined.

If the kit refuses `$.tool.call` for a tool no `tool.register` op answered, add `on('tool.register', async (_$, e) => ({ value: { tool: \`mcp__artifacts__${e.name}\` } }))` to `session()` and note that in the commit.

- [ ] **Step 3: Write `history.ts`**

```ts
import type { EngineInterface } from 'claude-code'

import type { ArtifactMeta, Shown } from '../types'
import { DEFAULT_KIND, newId, parseFile, projectKey, renderFile } from './store'
import type { ShowArgs } from './store'

/** A refusal the show tool passes to the model as it is. */
export class ShowError extends Error {}

/** The project's history folder: `~/.claude/artifacts/<base name>-<hash>`, keyed by the main working tree. */
export async function historyDir($: EngineInterface): Promise<{ dir: string; project: string; home: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  if (!home) throw new ShowError('HOME is not set, so there is no ~/.claude/artifacts to keep the history in')
  const root = (await $.session.repo())?.root ?? (await $.session.root())
  return { dir: `${home}/.claude/artifacts/${await projectKey(root)}`, project: root.split('/').pop() || root, home }
}

export const tilde = (path: string, home: string): string => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

// Headers read once per file and time: the 5 s refresh re-reads only what changed.
const cache = new Map<string, { mtimeMs: number; meta: ArtifactMeta }>()

/** Every artifact in the folder, by its header; none when the folder doesn't exist yet. */
export async function readHistory($: EngineInterface, dir: string): Promise<ArtifactMeta[]> {
  if (!(await $.fs.exists(dir))) return []
  const entries = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
  return Promise.all(
    entries.map(async f => {
      const path = `${dir}/${f.name}`
      const hit = cache.get(path)
      if (hit && hit.mtimeMs === f.mtimeMs) return hit.meta
      const { meta } = parseFile(f.name.slice(0, -3), await $.fs.read(path), f.mtimeMs)
      cache.set(path, { mtimeMs: f.mtimeMs, meta })
      return meta
    }),
  )
}

/** One artifact for the reader: the latest version, or an earlier one from `.versions`. */
export async function readArtifact($: EngineInterface, dir: string, id: string, version?: number): Promise<Shown> {
  const latestPath = `${dir}/${id}.md`
  const latest = parseFile(id, await $.fs.read(latestPath), 0)
  if (version === undefined || version === latest.meta.version) return { ...latest, latest: latest.meta.version, path: latestPath }
  const path = `${dir}/.versions/${id}/v${version}.md`
  const old = parseFile(id, await $.fs.read(path), 0)
  return { ...old, latest: latest.meta.version, path }
}

/** The session checkout's branch; empty when git fails or HEAD is detached. */
export async function currentBranch($: EngineInterface): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', await $.session.root(), 'branch', '--show-current'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

/** Posts a new artifact, or with `args.id` a new version of one; answers its header. */
export async function post($: EngineInterface, dir: string, args: ShowArgs, now: number): Promise<ArtifactMeta> {
  const items = await readHistory($, dir)
  const iso = new Date(now).toISOString()
  const stamp = { updated: iso, branch: await currentBranch($), session: await $.session.id() }
  let meta: ArtifactMeta
  if (args.id) {
    const cur = items.find(m => m.id === args.id)
    if (!cur) throw new ShowError(`no artifact "${args.id}" in this project; mcp__artifacts__list shows the ids`)
    // fs has no rename: the version it replaces is copied as it stands, then overwritten.
    await $.fs.write(`${dir}/.versions/${cur.id}/v${cur.version}.md`, await $.fs.read(`${dir}/${cur.id}.md`))
    meta = { ...cur, ...stamp, title: args.title, kind: args.kind ?? cur.kind, version: cur.version + 1 }
  } else {
    const id = newId(args.title, now, new Set(items.map(m => m.id)))
    meta = { id, title: args.title, kind: args.kind ?? DEFAULT_KIND, version: 1, created: iso, ...stamp }
  }
  await $.fs.write(`${dir}/${meta.id}.md`, renderFile(meta, args.body))
  return meta
}

/** Copies the latest version into the session checkout's docs/artifacts/; answers the path written. */
export async function keepInRepo($: EngineInterface, dir: string, id: string): Promise<string> {
  const path = `${await $.session.root()}/docs/artifacts/${id}.md`
  await $.fs.write(path, await $.fs.read(`${dir}/${id}.md`))
  return path
}
```

- [ ] **Step 4: Write `register.tsx` with the tools**

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HistoryView, PaneView, Shown } from '../types'
import { ShowError, historyDir, post, readHistory, tilde } from './history'
import { checkShow, listText } from './store'

export const PANE = 'artifacts'

export const EMPTY_HISTORY: HistoryView = { dir: '', project: '', items: [], error: '' }
export const history = atom({ plugin: 'artifacts', key: 'history' } as const, EMPTY_HISTORY)
export const pane = atom({ plugin: 'artifacts', key: 'pane' } as const, { view: 'list' } as PaneView)
export const query = atom({ plugin: 'artifacts', key: 'query' } as const, '')
export const mine = atom({ plugin: 'artifacts', key: 'mine' } as const, [] as string[])
export const shown = atom({ plugin: 'artifacts', key: 'shown' } as const, null as Shown | null)

const SHOW_DESCRIPTION = [
  "Post an artifact to the owner's artifacts pane and this project's history, kept across sessions in ~/.claude/artifacts/.",
  'Post without being asked when it helps: a design, a plan, a flow or architecture diagram, a comparison of options, or a map of what you built after a substantial change.',
  "Don't post small edits or answers that fit in chat. Always post when the owner asks to see something.",
  'Write `body` in markdown. Draw diagrams with box-drawing characters, at most 64 columns wide.',
  'To revise an earlier artifact, pass its `id` (from this tool\'s result or mcp__artifacts__list): that adds a version instead of a near-duplicate.',
].join(' ')

const LIST_DESCRIPTION =
  "List this project's artifacts, newest first: id, kind, version, when updated, title. Use it to find one to revise (pass its id to mcp__artifacts__show) or to read in full (Read <folder>/<id>.md)."

/** Reads the history into the atom; a failure is kept as the pane's error line. */
export async function refresh($: EngineInterface): Promise<HistoryView> {
  try {
    const { dir, project } = await historyDir($)
    const next: HistoryView = { dir, project, items: await readHistory($, dir), error: '' }
    await update($, history, () => next)
    return next
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, history, h => ({ ...h, error }))
    return { ...(await read($, history)), error }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'show',
      description: SHOW_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short title, as the pane lists it' },
          body: { type: 'string', description: 'The artifact, in markdown' },
          kind: { type: 'string', description: 'design, plan, diagram, comparison, summary, notes or exploration' },
          id: { type: 'string', description: 'An earlier artifact to add a version to' },
        },
        required: ['title', 'body'],
      },
    })
    await $.tool.register({
      name: 'list',
      description: LIST_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Matches title, kind or id, ignoring case' },
          limit: { type: 'number', description: 'How many to list; default 20' },
        },
      },
    })
    return started
  })

  on('tool.call', { tool: 'mcp__artifacts__show' }, async ($, e) => {
    const args = checkShow(e as unknown as Record<string, unknown>)
    if ('error' in args) return { deny: args.error }
    try {
      const { dir, home } = await historyDir($)
      const meta = await post($, dir, args, await $.clock.now())
      await update($, mine, ids => (ids.includes(meta.id) ? ids : [...ids, meta.id]))
      await refresh($)
      return { result: `posted ${meta.id} v${meta.version} · ${tilde(`${dir}/${meta.id}.md`, home)}` }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!(err instanceof ShowError)) await update($, history, h => ({ ...h, error: reason }))
      return { deny: reason }
    }
  })

  on('tool.call', { tool: 'mcp__artifacts__list' }, async ($, e) => {
    const input = e as unknown as { query?: unknown; limit?: unknown }
    try {
      const { dir, home } = await historyDir($)
      const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.floor(input.limit) : 20
      return { result: listText(tilde(dir, home), await readHistory($, dir), typeof input.query === 'string' ? input.query : '', limit) }
    } catch (err) {
      return { deny: err instanceof Error ? err.message : String(err) }
    }
  })
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd artifacts && claude plugin test .`
Expected: all pass. If `e` on a plugin tool's `tool.call` carries the input under a different key than the top level (check `ToolCallInput` in `.claude-plugin/types/claude-code/index.d.ts`), adjust how `checkShow` gets `e` and note it.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hooks/history.ts artifacts/hooks/register.tsx artifacts/hooks/register.test.tsx
git commit -F <scratch>/msg.txt   # "artifacts: the show and list tools, and the history on disk"
```

---

### Task 3: The pane's list, `/artifacts`, and the 5 s refresh

**Files:**
- Create: `artifacts/hooks/pane.tsx`
- Modify: `artifacts/hooks/register.tsx`, `artifacts/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `refresh`, `history`, `pane`, `query`, `mine`, `shown` (Task 2), `fmtAge`, `matchesQuery`, `newestFirst` (Task 1).
- Produces:
  - `drawPane(ui, m: PaneModel)`, where `PaneModel = { history; pane; query; mine; shown; now; cols; surface; editor; act: PaneActions }`.
  - `PaneActions = { filter(text): void; openFirst(text): void; open(id): void; back(): void; version(n): void; editor(): void; keep(): void }`.
  - `listColumns(cols: number, kindWidth: number): { kind: number; version: number }`.
  - **Element keys:**
    - The header: `head`, `error`, `filter` (an Input).
    - Each row: `row-<id>` (a Box) and `open-<id>` (a Button).
    - When the list is empty: `empty`.

- [ ] **Step 1: Write the failing tests** (add to `register.test.tsx`)

```tsx
const PANE_PROPS = (bodyColumns: number) => ({ title: 'artifacts', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} })
const mount = ($: E, cols = 60) =>
  $.ui.mount({ plugin: 'artifacts', surface: 'terminal', component: 'Pane', requestId: 'artifacts', props: PANE_PROPS(cols), viewport: { columns: 140, rows: 50 } })
const toggle = ($: E) => $.command.run({ command: 'artifacts', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

describe('the list', () => {
  test('/artifacts opens the list: project, count, newest first, this session marked', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'Release plan', body: 'x', kind: 'plan' })
    await show($, { title: 'Auth flow', body: 'y', kind: 'diagram' })
    // One written by another session: same folder, no marker.
    const dir = folder(files)
    const threeDaysAgo = new Date(NOW - 3 * 86_400_000).toISOString()
    files.set(`${dir}/2026-10-12-old.md`, { text: `---\ntitle: Old one\nkind: notes\nversion: 3\ncreated: ${threeDaysAgo}\nupdated: ${threeDaysAgo}\nbranch: \nsession: s-0\n---\n\nz\n`, mtimeMs: NOW })
    expect((await toggle($)).text).toBe('artifacts opened.')
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'head' }))?.text).toMatch(/^artifacts · kintsugi\s*3$/)
    const rows = await ui.findAll({ type: 'Box', key: /^row-/ })
    expect(rows.map(r => r.key)).toEqual(['row-2026-10-15-release-plan', 'row-2026-10-15-auth-flow', 'row-2026-10-12-old'])
    expect((await ui.find({ type: 'Box', key: 'row-2026-10-15-auth-flow' }))?.text).toMatch(/^●\s*Auth flow\s*diagram\s*0s$/)
    expect((await ui.find({ type: 'Box', key: 'row-2026-10-12-old' }))?.text).toMatch(/^\s*Old one\s*notes\s*v3\s*3d$/)
    await ui.unmount()
  })

  test('the filter narrows by title, kind or id, and the header counts the matches', async ($, on) => {
    disk(on, new Map())
    session(on)
    await start($)
    await show($, { title: 'Release plan', body: 'x', kind: 'plan' })
    await show($, { title: 'Auth flow', body: 'y', kind: 'diagram' })
    await toggle($)
    const ui = await mount($)
    await ui.input({ key: 'filter', text: 'DIAG', kind: 'change' })
    expect((await ui.findAll({ type: 'Box', key: /^row-/ })).map(r => r.key)).toEqual(['row-2026-10-15-auth-flow'])
    expect((await ui.find({ type: 'Box', key: 'head' }))?.text).toMatch(/1 of 2$/)
    await ui.unmount()
  })

  test('a narrow dock drops the kind first, then the version; the age stays', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'Auth flow', body: 'y', kind: 'comparison' })
    await show($, { id: '2026-10-15-auth-flow', title: 'Auth flow', body: 'z' })
    await toggle($)
    for (const [cols, re] of [
      [44, /^●\s*Auth flow\s*comparison\s*v2\s*0s$/],
      [32, /^●\s*Auth flow\s*v2\s*0s$/],
      [24, /^●\s*Auth flow\s*0s$/],
    ] as const) {
      const ui = await mount($, cols)
      expect((await ui.find({ type: 'Box', key: 'row-2026-10-15-auth-flow' }))?.text).toMatch(re)
      await ui.unmount()
    }
  })

  test('nothing posted yet: a plain line', async ($, on) => {
    disk(on, new Map())
    session(on)
    await start($)
    await toggle($)
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'empty' }))?.text).toBe('nothing posted yet for kintsugi')
    await ui.unmount()
  })

  test('a failed read shows its error under the header, and the pane still draws', async ($, on) => {
    disk(on, new Map())
    session(on, { home: null })
    await start($)
    await toggle($)
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'error' }))?.text).toMatch(/HOME is not set/)
    await ui.unmount()
  })

  test('/artifacts again closes it', async ($, on) => {
    disk(on, new Map())
    session(on)
    await start($)
    await toggle($)
    expect((await toggle($)).text).toBe('artifacts closed.')
  })
})

describe('refreshing', () => {
  test('while open, the folder is read every 5 s; closed, not at all', async ($, on) => {
    const clock = mock.clock(on)
    const files: Files = new Map()
    disk(on, files)
    let lists = 0
    on('fs.list', async (_$, e, next) => {
      lists++
      return next(e)
    })
    session(on, { clock: false })
    await start($)
    await show($, { title: 'T', body: 'x' })
    lists = 0
    await clock.advance(10_000)
    expect(lists).toBe(0) // never opened
    await toggle($)
    lists = 0
    await clock.advance(10_000)
    expect(lists).toBe(2)
    await toggle($)
    lists = 0
    await clock.advance(10_000)
    expect(lists).toBe(0)
  })
})
```

`mock.clock(on)` answers `clock.now` from memory, so the refreshing test passes `{ clock: false }`, and `session()` doesn't answer it too.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd artifacts && claude plugin test .`
Expected: the new tests fail. `/artifacts` is unknown (`command.run` answers nothing), and nothing is drawn.

- [ ] **Step 3: Write `pane.tsx`'s list half**

```tsx
import type { ArtifactMeta, HistoryView, PaneView, Shown } from '../types'
import { fmtAge, matchesQuery, newestFirst } from './store'

export type PaneActions = {
  filter: (text: string) => void
  openFirst: (text: string) => void
  open: (id: string) => void
  back: () => void
  version: (n: number) => void
  editor: () => void
  keep: () => void
}

export type PaneModel = {
  history: HistoryView
  pane: PaneView
  query: string
  mine: string[]
  shown: Shown | null
  now: number
  cols: number
  surface: string
  /** The editor's program name, for the open button. */
  editor: string
  act: PaneActions
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

const MARK = 2
const MIN_TITLE = 12
const VERSION_W = 3 // 'v12'
const AGE_W = 3 // '59m'

/** As the dock narrows the kind goes first, then the version; the title takes the rest, the age stays. */
export function listColumns(cols: number, kindWidth: number): { kind: number; version: number } {
  const row = (kind: number, version: number) => MARK + MIN_TITLE + (kind ? kind + 1 : 0) + (version ? version + 1 : 0) + 1 + AGE_W
  if (row(kindWidth, VERSION_W) <= cols) return { kind: kindWidth, version: VERSION_W }
  if (row(0, VERSION_W) <= cols) return { kind: 0, version: VERSION_W }
  return { kind: 0, version: 0 }
}

export function drawPane(ui: UI, m: PaneModel) {
  return m.pane.view === 'reader' && m.shown ? drawReader(ui, m, m.shown) : drawList(ui, m)
}

function drawList(ui: UI, m: PaneModel) {
  const { Box, Text, Button } = ui
  const Input = 'Input' in ui ? ui.Input : undefined
  const fixed = (width: number) => (m.surface === 'terminal' ? { width, flexShrink: 0 } : {})
  const items = newestFirst(m.history.items)
  const hits = items.filter(a => matchesQuery(a, m.query))
  const c = listColumns(m.cols, Math.max(4, ...items.map(a => a.kind.length)))
  const row = (a: ArtifactMeta) => (
    <Box key={`row-${a.id}`} flexDirection="row" gap={1}>
      <Box {...fixed(MARK - 1)}>
        <Text color="success">{m.mine.includes(a.id) ? '●' : ' '}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Button plain key={`open-${a.id}`} label={a.title} onPress={() => m.act.open(a.id)} />
      </Box>
      {c.kind ? (
        <Box {...fixed(c.kind)}>
          <Text dimColor>{a.kind}</Text>
        </Box>
      ) : null}
      {c.version ? (
        <Box {...fixed(c.version)} justifyContent="flex-end">
          <Text dimColor>{a.version > 1 ? `v${a.version}` : ''}</Text>
        </Box>
      ) : null}
      <Box {...fixed(AGE_W)} justifyContent="flex-end">
        <Text dimColor>{fmtAge(m.now - Date.parse(a.updated))}</Text>
      </Box>
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box key="head" flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold wrap="truncate-end">{`artifacts${m.history.project ? ` · ${m.history.project}` : ''}`}</Text>
        <Text dimColor>{m.query.trim() ? `${hits.length} of ${items.length}` : String(items.length)}</Text>
      </Box>
      {m.history.error ? (
        <Box key="error">
          <Text color="error">{m.history.error}</Text>
        </Box>
      ) : null}
      {items.length && Input ? (
        <Input key="filter" label=" " placeholder="filter" value={m.query} submitLabel="open" onInput={m.act.filter} onSubmit={m.act.openFirst} />
      ) : null}
      {items.length ? (
        <Box key="rows" flexDirection="column">
          {hits.map(row)}
        </Box>
      ) : m.history.error ? null : (
        <Box key="empty">
          <Text dimColor>{`nothing posted yet${m.history.project ? ` for ${m.history.project}` : ''}`}</Text>
        </Box>
      )}
    </Box>
  )
}

// Task 4 replaces this with the reader.
function drawReader(ui: UI, m: PaneModel, _shown: Shown) {
  return drawList(ui, m)
}
```

The marker cell is `MARK - 1` wide plus the row's gap of 1, which makes the two cells `MARK` counts.

- [ ] **Step 4: Wire `/artifacts`, the refresh timer and the render hook in `register.tsx`**

Add these imports and helpers:

```tsx
import { drawPane } from './pane'
import type { PaneActions } from './pane'
import { matchesQuery, newestFirst } from './store'

const TITLE = 'artifacts'
const POLL_MS = 5000
const DEFAULT_EDITOR = 'zed'

// The editor setting is a command line: the first word is the program, the rest come before the file.
export const editorArgv = (setting: unknown, path: string): string[] => {
  const words = (typeof setting === 'string' ? setting : '').trim().split(/\s+/).filter(Boolean)
  return [...(words.length ? words : [DEFAULT_EDITOR]), path]
}

// True from the moment this session opens the pane until ui.panes says it is gone.
let mayBeOpen = false

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  if (!mayBeOpen) return false
  mayBeOpen = (await $.ui.panes()).some(p => p.id === PANE)
  return mayBeOpen
}

// The terminal's width, from the last render that reported it; 0 before one has.
let viewportColumns = 0

/** Opens the pane, asking the dock for half the terminal (at most 100) once the width is known. */
export async function openPane($: EngineInterface) {
  mayBeOpen = true
  const columns = viewportColumns ? Math.min(100, Math.floor(viewportColumns / 2)) : undefined
  return $.ui.open({ id: PANE, title: TITLE, ...(columns ? { columns } : {}) })
}
```

Inside `register`, take `options` (`export const register: Register = (on, options) => {`) and add:

```tsx
  // In session.start, after the tools are registered:
  //   mayBeOpen = true
  //   await isPaneOpen($).catch(() => false)
  //   $.clock.every(POLL_MS, () => {
  //     void (async () => {
  //       if (await isPaneOpen($)) await refresh($)
  //     })().catch(() => undefined)
  //   })

  on('command.run', { command: 'artifacts' }, async $ => {
    mayBeOpen = true
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE })
      return { text: 'artifacts closed.' }
    }
    await update($, pane, () => ({ view: 'list' }) as PaneView)
    await openPane($)
    await refresh($)
    return { text: 'artifacts opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.viewport?.columns) viewportColumns = e.viewport.columns
    const h = await read($, history)
    const act: PaneActions = {
      filter: text => void update($, query, () => text).catch(() => undefined),
      openFirst: text =>
        void (async () => {
          await update($, query, () => text)
          const first = newestFirst(h.items).find(a => matchesQuery(a, text))
          if (first) await openReader($, first.id)
          else $.ui.toast(`no artifact matches ${text.trim()}`)
        })().catch(() => undefined),
      open: id => void openReader($, id).catch(() => undefined),
      back: () => void update($, pane, () => ({ view: 'list' }) as PaneView).catch(() => undefined),
      version: () => undefined, // Task 4
      editor: () => undefined, // Task 4
      keep: () => undefined, // Task 4
    }
    return drawPane($.ui.resolve(e), {
      history: h,
      pane: await read($, pane),
      query: await read($, query),
      mine: await read($, mine),
      shown: await read($, shown),
      now: await $.clock.now(),
      cols: e.props.bodyColumns || 60,
      surface: e.surface,
      editor: editorArgv(options.editor, '')[0]?.split('/').pop() ?? DEFAULT_EDITOR,
      act,
    })
  })
```

Add `openReader` now, so Enter and clicks switch the view. Task 4 fills in the reader's drawing:

```tsx
/** Shows one artifact in the reader: its latest version, or `version`. */
export async function openReader($: EngineInterface, id: string, version?: number) {
  const { dir } = await historyDir($)
  const s = await readArtifact($, dir, id, version)
  await update($, shown, () => s)
  await update($, pane, () => ({ view: 'reader', id }) as PaneView)
}
```

(Import `readArtifact` from `./history`.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd artifacts && claude plugin test .`
Expected: all pass. (Enter opening the reader is tested in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add artifacts/hooks/pane.tsx artifacts/hooks/register.tsx artifacts/hooks/register.test.tsx
git commit -F <scratch>/msg.txt   # "artifacts: the list, /artifacts and the 5 s refresh"
```

---

### Task 4: The reader, versions, editor, keep in repo, and opening on post

**Files:**
- Modify: `artifacts/hooks/pane.tsx`, `artifacts/hooks/register.tsx`, `artifacts/hooks/register.test.tsx`

**Interfaces:**
- Consumes:
  - `openReader`, `openPane`, `editorArgv`, `refresh` (Task 3).
  - `readArtifact`, `keepInRepo`, `historyDir`, `tilde` (Task 2).
- Produces:
  - **Reader keys:** `back` (a Button), `title`, `meta`, `body` (Boxes), `version-<n>` (Buttons), `editor` and `keep` (Buttons).
  - **Opening on post:** `show` opens the pane on the new artifact, or shows a toast.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('the reader', () => {
  const posted = async ($: E, on: On, opts: { placed?: boolean } = {}) => {
    const files: Files = new Map()
    disk(on, files)
    const s = session(on, opts)
    await start($)
    return { files, toasts: s.toasts }
  }

  test('a post opens the reader on it: title, kind, version, age, branch, body', async ($, on) => {
    await posted($, on)
    await show($, { title: 'Auth flow', body: '## Flow\n\nA → B', kind: 'diagram' })
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'title' }))?.text).toBe('Auth flow')
    expect((await ui.find({ type: 'Box', key: 'meta' }))?.text).toBe('diagram · v1 of 1 · 0s ago · artifacts')
    expect((await ui.find({ type: 'Box', key: 'body' }))?.text).toContain('A → B')
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Box', key: 'head' })).toBeDefined()
    await ui.unmount()
  })

  test('the filter: Enter opens the first match in the reader', async ($, on) => {
    await posted($, on)
    await show($, { title: 'Release plan', body: 'x', kind: 'plan' })
    await toggle($) // to the list
    await toggle($)
    const ui = await mount($)
    await ui.input({ key: 'filter', text: 'plan' })
    expect((await ui.find({ type: 'Box', key: 'title' }))?.text).toBe('Release plan')
    await ui.unmount()
  })

  test('earlier versions: one button each; pressing one shows it, saying which of how many', async ($, on) => {
    await posted($, on)
    await show($, { title: 'Auth flow', body: 'first' })
    await show($, { id: '2026-10-15-auth-flow', title: 'Auth flow', body: 'second' })
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'body' }))?.text).toContain('second')
    await ui.press({ key: 'version-1' })
    expect((await ui.find({ type: 'Box', key: 'meta' }))?.text).toMatch(/^notes · v1 of 2 · /)
    expect((await ui.find({ type: 'Box', key: 'body' }))?.text).toContain('first')
    await ui.unmount()
  })

  test('open runs the editor on the version shown', async ($, on) => {
    const { files } = await posted($, on)
    const runs: string[][] = []
    on('process.run', async (_$, e, next) => {
      if (e.argv[0] !== 'git') runs.push([...e.argv])
      return e.argv[0] === 'git' ? next(e) : { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    await show($, { title: 'Auth flow', body: 'x' })
    const ui = await mount($)
    await ui.press({ key: 'editor' })
    expect(runs).toEqual([['zed', `${folder(files)}/2026-10-15-auth-flow.md`]])
    await ui.unmount()
  })

  test('keep in repo writes docs/artifacts/<id>.md in the session checkout, and says where', async ($, on) => {
    const { files, toasts } = await posted($, on)
    await show($, { title: 'Auth flow', body: 'x' })
    const ui = await mount($)
    await ui.press({ key: 'keep' })
    expect(files.get(`${WORKTREE}/docs/artifacts/2026-10-15-auth-flow.md`)?.text).toBe(files.get(`${folder(files)}/2026-10-15-auth-flow.md`)?.text)
    expect(toasts.at(-1)).toBe('kept · docs/artifacts/2026-10-15-auth-flow.md')
    await ui.unmount()
  })

  test('the reader asks the dock for half the terminal, at most 100', async ($, on) => {
    await posted($, on)
    const opens: { columns?: number }[] = []
    on('ui.open', async (_$, e, next) => {
      opens.push({ columns: e.columns })
      return next(e)
    })
    await show($, { title: 'A', body: 'x' })
    const ui = await mount($) // a render reports viewport.columns 140
    await show($, { title: 'B', body: 'y' })
    expect(opens.map(o => o.columns)).toEqual([undefined, 70])
    await ui.unmount()
  })

  test('a post the engine will not place unasked becomes a toast', async ($, on) => {
    const { toasts } = await posted($, on, { placed: false })
    await show($, { title: 'Auth flow', body: 'x' })
    expect(toasts.at(-1)).toBe('posted Auth flow · /artifacts')
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd artifacts && claude plugin test .`
Expected: the reader tests fail, with no `title`, `meta` or `body` Boxes (the reader still draws the list), and no toast.

- [ ] **Step 3: Write the reader in `pane.tsx`** (replace the `drawReader` placeholder)

```tsx
function drawReader(ui: UI, m: PaneModel, s: Shown) {
  const { Box, Text, Button, Markdown } = ui
  const meta = [s.meta.kind, `v${s.meta.version} of ${s.latest}`, `${fmtAge(m.now - Date.parse(s.meta.updated))} ago`, s.meta.branch].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Button plain key="back" label="← list" onPress={m.act.back} />
        <Box key="title">
          <Text bold wrap="truncate-end">{s.meta.title}</Text>
        </Box>
        <Box key="meta">
          <Text dimColor wrap="truncate-end">{meta}</Text>
        </Box>
      </Box>
      <Box key="body" flexDirection="column">
        <Markdown text={s.body} />
      </Box>
      <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={2}>
        {s.latest > 1
          ? Array.from({ length: s.latest }, (_, i) => i + 1).map(n => (
              <Button key={`version-${n}`} plain label={`v${n}`} {...(n === s.meta.version ? { bold: true } : { dimColor: true })} onPress={() => m.act.version(n)} />
            ))
          : null}
        <Button key="editor" plain label={`open in ${m.editor}`} onPress={m.act.editor} />
        <Button key="keep" plain label="keep in repo" onPress={m.act.keep} />
      </Box>
    </Box>
  )
}
```

If the terminal Button rejects `bold` or `dimColor` (check `ButtonProps`), mark the current version by its label instead: `[v2]`.

- [ ] **Step 4: Wire the actions and open-on-post in `register.tsx`**

In the render hook's `act`:

```tsx
      version: n => {
        const s0 = sNow
        if (s0) void openReader($, s0.meta.id, n).catch(() => undefined)
      },
      editor: () => {
        const s0 = sNow
        if (!s0) return
        void (async () => {
          const ran = await $.process.run(editorArgv(options.editor, s0.path)).catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
          if (ran.exitCode !== 0) $.ui.toast(`${editorName} failed: ${ran.stderr.slice(0, 80)}`)
        })()
      },
      keep: () => {
        const s0 = sNow
        if (!s0) return
        void (async () => {
          try {
            const { dir } = await historyDir($)
            const path = await keepInRepo($, dir, s0.meta.id)
            const root = await $.session.root()
            $.ui.toast(`kept · ${path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path}`)
          } catch (err) {
            $.ui.toast(`keep in repo failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        })()
      },
```

Here `const sNow = await read($, shown)` and `const editorName = editorArgv(options.editor, '')[0]?.split('/').pop() ?? DEFAULT_EDITOR` are read at the top of the render hook. Pass `sNow` as `shown` in the model.

In the `mcp__artifacts__show` hook, after `refresh($)`:

```tsx
      await openReader($, meta.id)
      const placed = await openPane($).catch(() => ({ isPlaced: false as const }))
      if (!placed.isPlaced) $.ui.toast(`posted ${meta.title} · /artifacts`)
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd artifacts && claude plugin test .`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hooks/pane.tsx artifacts/hooks/register.tsx artifacts/hooks/register.test.tsx
git commit -F <scratch>/msg.txt   # "artifacts: the reader, versions, keep in repo, and opening on post"
```

---

### Task 5: README, the mod table, gates, breakages and a live check

**Files:**
- Create: `artifacts/README.md`
- Modify: `README.md` (root: the mod table)

- [ ] **Step 1: Write `artifacts/README.md`**

Use the shape of `kintsugi-runs/README.md`:
- An opening paragraph.
- A diagram of the list and the reader.
- Bullets: Posting, History, The list, The reader, Keep in repo, Opening, Settings.
- "How it stores artifacts": the folder layout from the spec.
- Install, as in [Installing a mod](../README.md#installing-a-mod), with the folder `artifacts`.

Also say that the first post in a session on a terminal narrower than 144 columns shows a toast. After `/artifacts` has been opened once, later posts open the pane at 110 columns and up.

- [ ] **Step 2: Add the row to the root `README.md` table**

```markdown
| [artifacts](artifacts/) | Pane of the designs, plans and diagrams Claude posts with its `show` tool, and each project's history of them in `~/.claude/artifacts/`, with versions and a "keep in repo" button. `/artifacts` toggles it. |
```

- [ ] **Step 3: Run every gate**

Run, from the worktree root:

```bash
for d in artifacts agent-tree outputs-pane kintsugi-runs; do (cd $d && claude plugin test . 2>&1 | tail -2); npx -y -p typescript tsc -p $d; echo "$d tsc $?"; claude plugin validate $d | tail -1; done
```

Expected: every suite passes, every `tsc` exits 0, and every validate passes.

- [ ] **Step 4: Deliberate breakages**

Write `<scratch>/mutate_artifacts.py`, following the earlier `mutate_timing.py`. It applies one change, runs `claude plugin test .` in `artifacts`, and restores the file. These breakages, each of which must fail at least one test:
- `slugify`'s `|| 'artifact'` removed.
- `newId`'s `-${n}` loop returning `base`.
- `parseFile` splitting at `':'` instead of `': '`.
- `post` skipping the `.versions` write.
- `post` keeping `args.kind` absent as `DEFAULT_KIND` on a version.
- `checkShow`'s `> MAX_BODY` changed to `>=`.
- The list `listColumns` dropping the version before the kind.
- `openPane` always omitting `columns`.
- The `!placed.isPlaced` toast removed.
- `isPaneOpen` in the poll replaced by `true`.
- `keepInRepo` writing under `dir` instead of `session.root()`.

A survivor means a missing test: add one, and run the script again.

- [ ] **Step 5: Live check in a herdr test session**

1. Write `<scratch>/artifacts-settings.json` with `{"env": {"CLAUDE_CODE_PLUGIN_DIRS": "<worktree>/outputs-pane:<worktree>/artifacts"}}`.
2. Start a test session: `herdr workspace create --no-focus`, then `herdr agent start artifacts-live --kind claude --pane <pane> -- --settings <file> --model haiku`, with its cwd in a scratch git repo.
3. Prompt it: "Post a diagram of a three-step login flow as an artifact." Then `herdr pane read`.
   - Confirm the toast, or that the pane opened.
   - Confirm `~/.claude/artifacts/<repo>-<hash>/<date>-*.md` exists with its header.
4. Run `/artifacts`, then read the pane at about 50, 100 and 160 terminal columns (`herdr pane split`/`resize`, never `zoom`).
5. Prompt it: "Revise that diagram to add 2FA" (a version), and press `v1`.
6. Press keep in repo, and confirm `docs/artifacts/<id>.md` in the scratch repo.
7. Never commit in the scratch repo.

Record the commands and output for the report.

- [ ] **Step 6: Commit**

```bash
git add artifacts/README.md README.md
git commit -F <scratch>/msg.txt   # "artifacts: README and a row in the mod table"
```
