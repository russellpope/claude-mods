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

/** An in-memory disk under the fs ops: write, read, exists, list (files and the folders they imply); counts the lists. */
const disk = (on: On, files: Files, failWrites = false, unreadable: ReadonlySet<string> = new Set()) => {
  const io = { lists: 0 }
  on('fs.write', async (_$, e) => {
    // An op hook refuses with { deny }; a hook that throws is skipped, and the write would go on beneath it.
    if (failWrites) return { deny: `EACCES: permission denied, open '${e.path}'` }
    files.set(e.path, { text: e.text, mtimeMs: NOW })
    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    if (unreadable.has(e.path)) return { deny: `EACCES: permission denied, open '${e.path}'` }
    const f = files.get(e.path)
    if (!f) return { deny: `ENOENT: no such file, open '${e.path}'` }
    return { value: f.text }
  })
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) || [...files.keys()].some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.list', async (_$, e) => {
    io.lists++
    const prefix = `${e.path.replace(/\/$/, '')}/`
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, f] of files) {
      if (!path.startsWith(prefix)) continue
      const [name = '', ...rest] = path.slice(prefix.length).split('/')
      seen.set(name, rest.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })
    }
    return { value: [...seen.values()] }
  })
  return io
}

/** A session in a worktree of kintsugi, on branch `artifacts`, at NOW; returns the toasts it shows, the commands it runs and the opens it asks. */
const session = (on: On, opts: { home?: string | null; repo?: string | null; placed?: boolean; waitsUndrawn?: boolean; clock?: boolean } = {}) => {
  mock.env(on, opts.home === null ? {} : { HOME: opts.home ?? HOME })
  // A test driving mock.clock passes clock: false, so this hook doesn't answer clock.now beneath it.
  if (opts.clock !== false) on('clock.now', async () => ({ value: NOW }))
  on('session.repo', async () => ({ value: opts.repo === null ? null : { root: opts.repo ?? REPO, remote: null, internal: false, name: null } }))
  on('session.root', async () => ({ value: WORKTREE }))
  on('session.cwd', async () => ({ value: WORKTREE }))
  on('session.id', async () => ({ value: 's-1' }))
  const runs: string[][] = []
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[0] === 'git' ? 'artifacts\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // placed: false refuses every open; waitsUndrawn refuses only the first, as the engine does a post's before the person asks.
  let pane: 'none' | 'undrawn' | 'shown' = 'none'
  const opens: { columns?: number }[] = []
  on('ui.open', async (_$, e) => {
    opens.push({ columns: e.columns })
    if (opts.placed === false || (opts.waitsUndrawn && pane === 'none')) {
      pane = 'undrawn'
      return { value: { isPlaced: false, reason: 'narrow' } }
    }
    pane = 'shown'
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({
    value: pane === 'none' ? [] : [{ id: 'artifacts', title: 'artifacts', isShown: pane === 'shown', isFocused: false, isPlaced: pane === 'shown' }],
  }))
  on('ui.close', async () => {
    pane = 'none'
    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const registered: { tools: { name: string; isDeferred?: unknown }[]; commands: string[] } = { tools: [], commands: [] }
  on('tool.register', async (_$, e) => {
    registered.tools.push({ name: e.name, isDeferred: e.isDeferred })
    return { value: { tool: `mcp__artifacts__${e.name}` } }
  })
  on('command.register', async (_$, e) => {
    registered.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  return { toasts, runs, opens, registered }
}

const start = ($: E) => $.session.start({ cwd: WORKTREE, surface: 'terminal', isInteractive: true })
const show = ($: E, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__artifacts__show', ...input })
const list = ($: E, input: Record<string, unknown> = {}) => $.tool.call({ tool: 'mcp__artifacts__list', ...input })

/** The project folder for REPO, found the way the mod finds it. */
const folder = (files: Files) => [...files.keys()].map(p => p.match(/^\/Users\/me\/\.claude\/artifacts\/[^/]+/)?.[0]).find(Boolean) ?? ''

describe('the session start', () => {
  test('registers /artifacts-pane (Claude Code has a built-in /artifacts) and both tools, neither deferred', async ($, on) => {
    disk(on, new Map())
    const { registered } = session(on)
    await start($)
    expect(registered.commands).toEqual(['artifacts-pane'])
    expect(registered.tools).toEqual([
      { name: 'show', isDeferred: false },
      { name: 'list', isDeferred: false },
    ])
  })
})

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

  test('three versions in a row: each kept once under .versions, none overwritten', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'Auth flow', body: 'one' })
    const dir = folder(files)
    const v1 = files.get(`${dir}/2026-10-15-auth-flow.md`)?.text
    await show($, { id: '2026-10-15-auth-flow', title: 'Auth flow', body: 'two' })
    const v2 = files.get(`${dir}/2026-10-15-auth-flow.md`)?.text
    const r = await show($, { id: '2026-10-15-auth-flow', title: 'Auth flow', body: 'three' })
    expect(r.result).toMatch(/^posted 2026-10-15-auth-flow v3 · /)
    expect(files.get(`${dir}/.versions/2026-10-15-auth-flow/v1.md`)?.text).toBe(v1)
    expect(files.get(`${dir}/.versions/2026-10-15-auth-flow/v2.md`)?.text).toBe(v2)
    expect(files.get(`${dir}/2026-10-15-auth-flow.md`)?.text).toContain('\nversion: 3\n')
  })

  test('a version another session added within the same mtime is read from the file, not a cached header', async ($, on) => {
    const files: Files = new Map()
    disk(on, files)
    session(on)
    await start($)
    await show($, { title: 'Auth flow', body: 'one' })
    const dir = folder(files)
    const latest = `${dir}/2026-10-15-auth-flow.md`
    const v1 = files.get(latest)?.text ?? ''
    // Another session's v2: v1 moved under .versions, v2 written in place, at the same mtime this session cached.
    const v2 = v1.replace('\nversion: 1\n', '\nversion: 2\n').replace('\n\none\n', '\n\ntwo\n')
    files.set(`${dir}/.versions/2026-10-15-auth-flow/v1.md`, { text: v1, mtimeMs: NOW })
    files.set(latest, { text: v2, mtimeMs: NOW })
    const r = await show($, { id: '2026-10-15-auth-flow', title: 'Auth flow', body: 'three' })
    expect(r.result).toMatch(/^posted 2026-10-15-auth-flow v3 · /)
    expect(files.get(`${dir}/.versions/2026-10-15-auth-flow/v1.md`)?.text).toBe(v1)
    expect(files.get(`${dir}/.versions/2026-10-15-auth-flow/v2.md`)?.text).toBe(v2)
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
  test('an unreadable file is listed by its name, kind ?, and the rest still list', async ($, on) => {
    const files: Files = new Map()
    const unreadable = new Set<string>()
    disk(on, files, false, unreadable)
    session(on)
    await start($)
    await show($, { title: 'Auth flow', body: 'y', kind: 'diagram' })
    const locked = `${folder(files)}/2026-10-12-locked.md`
    files.set(locked, { text: 'secret', mtimeMs: NOW })
    unreadable.add(locked)
    const r = (await list($)).result as string
    expect(r).toMatch(/^2026-10-15-auth-flow · diagram · v1 · /m)
    expect(r).toMatch(/^2026-10-12-locked · \? · v1 · .* · 2026-10-12-locked$/m)
  })

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

const PANE_PROPS = (bodyColumns: number) => ({ title: 'artifacts', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} })
const mount = ($: E, cols = 60) =>
  $.ui.mount({ plugin: 'artifacts', surface: 'terminal', component: 'Pane', requestId: 'artifacts', props: PANE_PROPS(cols), viewport: { columns: 140, rows: 50 } })
const rowsOf = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Box' })).filter(r => r.key?.startsWith('row-'))
const toggle = ($: E) => $.command.run({ command: 'artifacts-pane', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

describe('the list', () => {
  test('/artifacts-pane opens the list: project, count, newest first, this session marked', async ($, on) => {
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
    expect((await toggle($)).text).toBe('artifacts closed.') // the post opened it on the reader
    expect((await toggle($)).text).toBe('artifacts opened.')
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'head' }))?.text).toMatch(/^artifacts · kintsugi\s*3$/)
    const rows = await rowsOf(ui)
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
    await toggle($) // closes the reader the post opened
    await toggle($)
    const ui = await mount($)
    await ui.input({ key: 'filter', text: 'DIAG', kind: 'change' })
    expect((await rowsOf(ui)).map(r => r.key)).toEqual(['row-2026-10-15-auth-flow'])
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
    await toggle($) // closes the reader the post opened
    await toggle($)
    for (const [cols, re] of [
      [44, /^●\s*Auth flow\s*comparison\s*v2\s*0s$/],
      [32, /^●\s*Auth flow\s*v2\s*0s$/],
      [20, /^●\s*Auth flow\s*0s$/],
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

  test("a failed post's error stays under the header after the folder is read again", async ($, on) => {
    disk(on, new Map(), true)
    session(on)
    await start($)
    expect((await show($, { title: 'T', body: 'x' })).deny).toMatch(/EACCES/)
    await toggle($) // reads the folder: nothing there, and no read error
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'error' }))?.text).toMatch(/EACCES/)
    await ui.unmount()
  })

  test('/artifacts-pane again closes it', async ($, on) => {
    disk(on, new Map())
    session(on)
    await start($)
    await toggle($)
    expect((await toggle($)).text).toBe('artifacts closed.')
  })
})

describe('refreshing', () => {
  test('a pane waiting undrawn is not read on the timer', async ($, on) => {
    const clock = mock.clock(on)
    const files: Files = new Map()
    const io = disk(on, files)
    session(on, { clock: false, placed: false })
    await start($)
    await show($, { title: 'T', body: 'x' })
    io.lists = 0
    await clock.advance(10_000)
    expect(io.lists).toBe(0)
  })

  test('while open, the folder is read every 5 s; closed, not at all', async ($, on) => {
    const clock = mock.clock(on)
    const files: Files = new Map()
    const io = disk(on, files)
    session(on, { clock: false })
    await start($)
    io.lists = 0
    await clock.advance(10_000)
    expect(io.lists).toBe(0) // never opened
    await show($, { title: 'T', body: 'x' }) // opens the pane on it
    io.lists = 0
    await clock.advance(10_000)
    expect(io.lists).toBe(2)
    await toggle($)
    io.lists = 0
    await clock.advance(10_000)
    expect(io.lists).toBe(0)
  })
})

describe('the reader', () => {
  const posted = async ($: E, on: On, opts: { placed?: boolean; waitsUndrawn?: boolean } = {}) => {
    const files: Files = new Map()
    disk(on, files)
    const s = session(on, opts)
    await start($)
    return { files, ...s }
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
    const { files, runs } = await posted($, on)
    await show($, { title: 'Auth flow', body: 'x' })
    const ui = await mount($)
    await ui.press({ key: 'editor' })
    expect(runs.filter(argv => argv[0] !== 'git')).toEqual([['zed', `${folder(files)}/2026-10-15-auth-flow.md`]])
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
    const { opens } = await posted($, on)
    await show($, { title: 'A', body: 'x' })
    const ui = await mount($) // a render reports viewport.columns 140
    await show($, { title: 'B', body: 'y' })
    expect(opens.map(o => o.columns)).toEqual([undefined, 70])
    await ui.unmount()
  })

  test('/artifacts-pane asks for half the terminal as the command measures it, though a render beside another dock reports less', async ($, on) => {
    const { opens } = await posted($, on)
    await show($, { title: 'A', body: 'x' })
    // Beside a docked pane, the render's viewport is the transcript's width, not the terminal's (140 here).
    const ui = await $.ui.mount({ plugin: 'artifacts', surface: 'terminal', component: 'Pane', requestId: 'artifacts', props: PANE_PROPS(26), viewport: { columns: 113, rows: 50 } })
    await toggle($) // closes the reader the post opened
    await toggle($)
    expect(opens.map(o => o.columns)).toEqual([undefined, 70])
    await ui.unmount()
  })

  test('after a post that waits undrawn, /artifacts-pane opens the pane rather than closing it', async ($, on) => {
    const { toasts } = await posted($, on, { waitsUndrawn: true })
    await show($, { title: 'Auth flow', body: 'x' })
    expect(toasts.at(-1)).toBe('posted Auth flow · /artifacts-pane')
    expect((await toggle($)).text).toBe('artifacts opened.')
  })

  test('a post the engine will not place unasked becomes a toast', async ($, on) => {
    const { toasts } = await posted($, on, { placed: false })
    await show($, { title: 'Auth flow', body: 'x' })
    expect(toasts.at(-1)).toBe('posted Auth flow · /artifacts-pane')
  })
})
