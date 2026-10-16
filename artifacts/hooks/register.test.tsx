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
    // An op hook refuses with { deny }; a hook that throws is skipped, and the write would go on beneath it.
    if (failWrites) return { deny: `EACCES: permission denied, open '${e.path}'` }
    files.set(e.path, { text: e.text, mtimeMs: NOW })
    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    const f = files.get(e.path)
    if (!f) return { deny: `ENOENT: no such file, open '${e.path}'` }
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
  on('tool.register', async (_$, e) => ({ value: { tool: `mcp__artifacts__${e.name}` } }))
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
