import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { OutputFile } from '../types'
import { fileKind, miscArgv, scratchPatterns, sectionOf } from './register'
import { findArgv, stampOf } from './scan'

type E = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const CWD = '/Users/me/p'
const NOW = Date.UTC(2026, 10, 19, 6, 52, 51, 500)
const STAMP_S = Math.floor(NOW / 1000)

const CLEAN = {
  status: '# branch.oid 1cbf\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n',
  branches: 'main\torigin/main\t\n',
  origin: 'origin/main\n',
  merged: 'main\n',
  worktrees: `worktree ${CWD}\nHEAD 1cbf\nbranch refs/heads/main\n\n`,
}
// The claude-mods main checkout as read on 2026-11-18, cut down: main ahead 4, a dirty file, a local-only
// branch, a merged one with no upstream, and a merged worktree.
const UNSHIPPED = {
  status: '# branch.oid 1cbf\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +4 -0\n? notes.md\n',
  branches: 'agent-tree-dings\t\t\nmain\torigin/main\t[ahead 4]\nvendor-spinner\t\t\n',
  origin: 'origin/main\n',
  merged: 'agent-tree-dings\nmain\n',
  worktrees: `worktree ${CWD}\nHEAD 1cbf\nbranch refs/heads/main\n\nworktree /Users/me/wt/dings\nHEAD 95c6\nbranch refs/heads/agent-tree-dings\n\n`,
}

type Git = Partial<typeof CLEAN>
type World = {
  platform?: string
  isBashError?: boolean
  isWriteError?: boolean
  found?: string[]
  findFails?: 'exit' | 'deny'
  findGate?: Promise<void>
  births?: Record<string, number>
  stats?: Record<string, { kind: 'file' | 'dir'; mtimeMs: number }>
  git?: Git
  paneOpen?: boolean
  rexFar?: boolean
}

const VIEW = JSON.stringify({ windows: [{ blocks: [{ block_id: 'block:me', owner: 'client:far' }] }] })
const CLIENTS = JSON.stringify({ clients: [{ client_id: 'client:far', info: { label: 'Laptop' } }] })

// Everything beneath the mod, answered from `w`. Most tests are not in a git repo: git exits 128.
const world = (on: On, w: World = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const ran: { argv: string[]; env?: Record<string, string>; timeoutMs?: number }[] = []
  const opened: string[] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  let files: OutputFile[] = []
  on('tool.call', (_$, e) => ((e.tool === 'Bash' && w.isBashError) || (e.tool === 'Write' && w.isWriteError)
    ? { result: 'exit 1', isError: true } : { result: 'ok' }) as never)
  on('session.cwd', () => ({ value: CWD }))
  on('session.info', () => ({ value: { platform: w.platform ?? 'macos' } }) as never)
  mock.env(on, w.rexFar ? { HOME: '/Users/me', REX_SESSION: 'session:s', REX_BLOCK: 'block:me' } : { HOME: '/Users/me' })
  on('process.run', async (_$, e) => {
    const argv = [...e.argv]
    ran.push({ argv, env: e.init?.env, timeoutMs: e.init?.timeoutMs })
    const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal: boom' : '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv[0] === 'find') {
      if (w.findGate) await w.findGate
      if (w.findFails === 'deny') return { deny: 'timed out after 2000 ms' } as never
      if (w.findFails === 'exit') return answer('', 1)
      return answer((w.found ?? []).map(p => `${p}\n`).join(''))
    }
    if (argv[0] === 'stat') return answer(argv.slice(3).map(p => `${w.births?.[p] ?? 0} ${p}\n`).join(''))
    if (argv[0] === 'git') {
      const git = w.git
      const sub = argv[4]
      if (!git) return answer('', 128)
      if (sub === 'status') return answer(git.status ?? '')
      if (sub === 'symbolic-ref') return git.origin ? answer(git.origin) : answer('', 128)
      if (sub === 'for-each-ref') return answer(argv.some(a => a.startsWith('--merged=')) ? git.merged ?? '' : git.branches ?? '')
      if (sub === 'worktree') return answer(git.worktrees ?? '')
      return answer('', 1)
    }
    if (argv[0] === 'scutil') return answer('Mac15\n')
    if (argv[0] === 'rex' && argv[1] === 'api') return answer(VIEW)
    if (argv[0] === 'rex' && argv[1] === 'client') return answer(CLIENTS)
    return answer('')
  })
  on('fs.stat', (_$, e) => {
    const s = w.stats?.[e.path]
    return (s ? { value: { kind: s.kind, size: 1, mtimeMs: s.mtimeMs, isLink: false } } : { deny: 'ENOENT' }) as never
  })
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } as never })
  on('ui.panes', () => ({ value: w.paneOpen === false ? [] : [{ id: 'outputs', title: 'Outputs', isShown: true, isFocused: false, isPlaced: true }] }) as never)
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.status', (_$, e) => { statuses.push(e.text); return { value: undefined } as never })
  on('ui.scroll', () => ({ value: {} } as never))
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'outputs-pane' && e.key === 'files') files = e.value as OutputFile[]
    return next(e)
  })

  return {
    clock,
    toasts,
    statuses,
    opened,
    files: () => files.map(f => [f.path, f.kind]),
    finds: () => ran.filter(r => r.argv[0] === 'find'),
    gitReads: () => ran.filter(r => r.argv[0] === 'git'),
    statusReads: () => ran.filter(r => r.argv[0] === 'git' && r.argv[4] === 'status').length,
    // What a click ran, without the lookups that decided it.
    clicked: () => ran.map(r => r.argv).filter(a => !['git', 'find', 'stat', 'scutil', 'rex'].includes(a[0] ?? '')),
  }
}

const bash = async ($: E, command: string, settle: () => Promise<void>) => {
  const result = await $.tool.call({ tool: 'Bash', tool_use_id: `b${Math.random()}`, command } as never)
  await settle()
  await settle()
  return result
}
const mount = ($: E) => $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
const start = ($: E) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

describe('files made by Bash', () => {
  test('a file made during the call is new, one that existed is edit; a misc one pops the pane', async ($, on) => {
    const w = world(on, {
      found: [`${CWD}/out/deck.pptx`, `${CWD}/src/main.rs`],
      births: { [`${CWD}/out/deck.pptx`]: STAMP_S, [`${CWD}/src/main.rs`]: STAMP_S - 600 },
    })
    await bash($, 'python3 make_deck.py', () => w.clock.settle())
    expect(w.files().sort()).toEqual([[`${CWD}/out/deck.pptx`, 'new'], [`${CWD}/src/main.rs`, 'edit']])
    expect(w.opened).toEqual(['outputs'])
    const ui = await mount($)
    expect(await ui.findAll({ type: 'Button', text: 'deck.pptx' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Button', text: 'main.rs' })).toHaveLength(1)
  })

  test('a Bash-made code or planning file is listed without opening the pane', async ($, on) => {
    const w = world(on, { found: [`${CWD}/src/main.rs`, `${CWD}/notes.md`] })
    await bash($, 'cargo fmt', () => w.clock.settle())
    expect(w.files()).toHaveLength(2)
    expect(w.opened).toEqual([])
  })

  test('the listing is one find under the working directory, newer than the start second, in UTC, with a short timeout', async ($, on) => {
    const w = world(on)
    await bash($, 'true', () => w.clock.settle())
    expect(w.finds().map(r => r.argv)).toEqual([findArgv(CWD, stampOf(NOW), [])])
    expect(w.finds()[0]?.env).toEqual({ TZ: 'UTC' })
    expect(w.finds()[0]?.timeoutMs).toBeLessThanOrEqual(3000)
  })

  test('the ignore setting prunes folders from the listing and from named paths', { options: { ignore: 'vendor, out*' } }, async ($, on) => {
    const w = world(on, { found: [], stats: { [`${CWD}/vendor/x.pptx`]: { kind: 'file', mtimeMs: NOW } } })
    await bash($, `cp a.pptx ${CWD}/vendor/x.pptx`, () => w.clock.settle())
    expect(w.finds()[0]?.argv).toEqual(findArgv(CWD, stampOf(NOW), ['vendor', 'out*']))
    expect(w.files()).toEqual([])
  })

  test('over 50 changed files is a build: none from the listing, paths named in the command still count', async ($, on) => {
    const found = Array.from({ length: 51 }, (_, i) => `${CWD}/gen/f${i}.o`)
    const w = world(on, { found, stats: { '/tmp/s/deck.pptx': { kind: 'file', mtimeMs: NOW + 200 } }, births: { '/tmp/s/deck.pptx': STAMP_S } })
    await bash($, 'make all && cp out.pptx /tmp/s/deck.pptx', () => w.clock.settle())
    expect(w.files()).toEqual([['/tmp/s/deck.pptx', 'new']])
  })

  test('exactly 50 changed files are all listed', async ($, on) => {
    const found = Array.from({ length: 50 }, (_, i) => `${CWD}/gen/f${i}.o`)
    const w = world(on, { found })
    await bash($, 'make all', () => w.clock.settle())
    expect(w.files()).toHaveLength(50)
  })

  test('a named path that is old, a folder, missing or a device is not listed', async ($, on) => {
    const w = world(on, { stats: { '/tmp/old.pptx': { kind: 'file', mtimeMs: NOW - 60_000 }, '/tmp/dir': { kind: 'dir', mtimeMs: NOW } } })
    await bash($, 'ls /tmp/old.pptx /tmp/dir /tmp/missing > /dev/null', () => w.clock.settle())
    expect(w.files()).toEqual([])
  })

  test('a failed Bash call lists nothing and runs no listing', async ($, on) => {
    const w = world(on, { isBashError: true, found: [`${CWD}/a.pptx`], stats: { '/tmp/b.pptx': { kind: 'file', mtimeMs: NOW } } })
    await bash($, 'false; touch /tmp/b.pptx', () => w.clock.settle())
    expect(w.finds()).toHaveLength(0)
    expect(w.files()).toEqual([])
  })

  test('a listing that exits non-zero lists nothing, named paths included, and shows no error', async ($, on) => {
    const w = world(on, { findFails: 'exit', stats: { '/tmp/b.pptx': { kind: 'file', mtimeMs: NOW } } })
    await bash($, 'touch /tmp/b.pptx', () => w.clock.settle())
    expect(w.finds()).toHaveLength(1)
    expect(w.files()).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('a listing that times out lists nothing and shows no error', async ($, on) => {
    const w = world(on, { findFails: 'deny', stats: { '/tmp/b.pptx': { kind: 'file', mtimeMs: NOW } } })
    await bash($, 'touch /tmp/b.pptx', () => w.clock.settle())
    expect(w.finds()).toHaveLength(1)
    expect(w.files()).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('the Bash result comes back before the listing has answered', async ($, on) => {
    let release = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    const w = world(on, { findGate: gate, found: [`${CWD}/a.pptx`], births: { [`${CWD}/a.pptx`]: STAMP_S } })
    const result = await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'make' } as never)
    expect(result).toMatchObject({ result: 'ok' })
    expect(w.files()).toEqual([])
    release()
    await w.clock.settle()
    await w.clock.settle()
    expect(w.files()).toEqual([[`${CWD}/a.pptx`, 'new']])
  })

  test('a file Write already listed is not listed twice and stays new', async ($, on) => {
    const w = world(on, { found: [`${CWD}/a.rs`], births: { [`${CWD}/a.rs`]: STAMP_S - 5 } })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/a.rs`, content: 'x' })
    await bash($, 'rustfmt a.rs', () => w.clock.settle())
    expect(w.files()).toEqual([[`${CWD}/a.rs`, 'new']])
  })

  test('where the platform cannot tell a birth time, an unlisted file is new and a listed one keeps its kind', async ($, on) => {
    const w = world(on, { platform: 'linux', found: [`${CWD}/b.rs`, `${CWD}/c.bin`] })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${CWD}/b.rs`, old_string: 'a', new_string: 'b' } as never)
    await bash($, 'cargo build', () => w.clock.settle())
    expect(w.files().sort()).toEqual([[`${CWD}/b.rs`, 'edit'], [`${CWD}/c.bin`, 'new']])
  })
})

describe('the misc section', () => {
  test('code is source, config, markup, known names and dotfiles; planning is markdown and text; the rest is misc', () => {
    for (const path of ['a.rs', 'a.json', 'a.html', 'a.yaml', 'a.sh', 'a.lock', 'Makefile', 'Dockerfile', 'README', 'README-old', 'LICENSE', '.env', '.gitignore', 'a.tsx', 'a.css', 'a.sql'])
      expect([path, fileKind(`/w/${path}`)]).toEqual([path, 'code'])
    for (const path of ['a.md', 'a.MDX', 'a.markdown', 'a.txt'])
      expect([path, fileKind(`/w/${path}`)]).toEqual([path, 'planning'])
    for (const path of ['deck.pptx', 'a.docx', 'a.xlsx', 'a.pdf', 'a.png', 'a.svg', 'a.mp4', 'a.mov', 'a.mp3', 'a.zip', 'a.tar.gz', 'a.woff2', 'a.csv', 'a.log', 'a.o', 'app', 'dump.parquet', 'Dockerfile.dev'])
      expect([path, fileKind(`/w/${path}`)]).toEqual([path, 'misc'])
  })

  test('a scratch name still wins over misc', () => {
    expect(sectionOf('/w/msg-deck.pptx', scratchPatterns('msg-*'))).toBe('scratch')
    expect(sectionOf('/w/deck.pptx', scratchPatterns('msg-*'))).toBe('misc')
  })

  test('the misc opener: the setting with the path last; blank is open on macOS, xdg-open elsewhere', () => {
    expect(miscArgv('qlmanage -p', '/w/a.pptx', 'macos')).toEqual(['qlmanage', '-p', '/w/a.pptx'])
    expect(miscArgv('', '/w/a.pptx', 'macos')).toEqual(['open', '/w/a.pptx'])
    expect(miscArgv(undefined, '/w/a.pptx', 'linux')).toEqual(['xdg-open', '/w/a.pptx'])
    expect(miscArgv(undefined, '/w/a.pptx', undefined)).toEqual(['open', '/w/a.pptx'])
  })

  test('misc shows only once something lands in it, unfolded, below code and above scratch', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/a.rs`, content: 'x' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: `${CWD}/msg-a.txt`, content: 'x' })
    await w.clock.settle()
    const ui = await mount($)
    expect(await ui.findAll({ type: 'Button', key: 'fold:misc' })).toHaveLength(0)

    await $.tool.call({ tool: 'Write', tool_use_id: 'w3', file_path: `${CWD}/deck.pptx`, content: 'x' })
    await w.clock.settle()
    expect(await ui.findAll({ type: 'Button', text: 'deck.pptx' })).toHaveLength(1)
    const heads = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('fold:'))
    expect(heads).toEqual(['fold:planning', 'fold:code', 'fold:misc', 'fold:scratch'])
  })

  test('clicking a misc file runs the misc opener, not the editor', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/deck.pptx`, content: 'x' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w2', file_path: `${CWD}/a.rs`, content: 'x' })
    await w.clock.settle()
    const ui = await mount($)
    await ui.press({ key: `open:${CWD}/deck.pptx` })
    await ui.press({ key: `open:${CWD}/a.rs` })
    expect(w.clicked()).toEqual([['open', `${CWD}/deck.pptx`], ['zed', `${CWD}/a.rs`]])
  })

  test('the miscOpener setting decides what a misc click runs', { options: { miscOpener: 'qlmanage -p' } }, async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/clip.mp4`, content: 'x' })
    const ui = await mount($)
    await ui.press({ key: `open:${CWD}/clip.mp4` })
    expect(w.clicked()).toEqual([['qlmanage', '-p', `${CWD}/clip.mp4`]])
  })

  test('on Linux a misc click runs xdg-open', async ($, on) => {
    const w = world(on, { platform: 'linux' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/clip.mp4`, content: 'x' })
    const ui = await mount($)
    await ui.press({ key: `open:${CWD}/clip.mp4` })
    expect(w.clicked()).toEqual([['xdg-open', `${CWD}/clip.mp4`]])
  })

  test('in Rex from another machine a misc click opens nothing and says where it opens', async ($, on) => {
    const w = world(on, { rexFar: true })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/deck.pptx`, content: 'x' })
    const ui = await mount($)
    await ui.press({ key: `open:${CWD}/deck.pptx` })
    expect(w.clicked()).toEqual([])
    expect(w.toasts).toEqual(['deck.pptx opens only on the machine Claude runs on (Mac15)'])
  })
})

describe('ship state', () => {
  test('at session start, a clean repo reads committed and pushed and leaves no status entry', async ($, on) => {
    const w = world(on, { git: CLEAN })
    await start($)
    await w.clock.settle()
    const ui = await mount($)
    expect(await ui.findAll({ type: 'Button', text: 'main · committed and pushed' })).toHaveLength(1)
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('only local reads: never fetch, pull, push or anything that writes', async ($, on) => {
    const w = world(on, { git: UNSHIPPED })
    await start($)
    await w.clock.settle()
    const subs = new Set(w.gitReads().map(r => r.argv[4]))
    expect([...subs].sort()).toEqual(['for-each-ref', 'status', 'symbolic-ref', 'worktree'])
    for (const r of w.gitReads()) {
      expect(r.argv.slice(0, 4)).toEqual(['git', '-C', CWD, '--no-optional-locks'])
      expect(r.timeoutMs).toBeLessThanOrEqual(3000)
    }
  })

  test('unshipped: the counts, the short status entry, and a press unfolds the names', async ($, on) => {
    const w = world(on, { git: UNSHIPPED })
    await start($)
    await w.clock.settle()
    const ui = await mount($)
    const line = 'main ↑4 · 1 dirty · 2 unpushed · 1 merged worktree'
    expect(await ui.findAll({ type: 'Button', text: line })).toHaveLength(1)
    expect(w.statuses.at(-1)).toBe(' main ↑4 · 1 dirty · 2 unpushed · 1 merged')
    expect(await ui.findAll({ text: /vendor-spinner/ })).toHaveLength(0)

    await ui.press({ key: 'ship' })
    expect(await ui.findAll({ type: 'Box', key: 'unpushed:vendor-spinner' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Box', key: 'unpushed:main' })).toHaveLength(1)
    const merged = await ui.findAll({ type: 'Box', key: 'merged:/Users/me/wt/dings' })
    expect(merged).toHaveLength(1)
    expect(merged[0]?.text).toMatch(/agent-tree-dings\s*~\/wt\/dings/)

    await ui.press({ key: 'ship' })
    expect(await ui.findAll({ type: 'Box', key: 'unpushed:vendor-spinner' })).toHaveLength(0)
  })

  test('shipIgnore drops branches from the counts', { options: { shipIgnore: 'vendor-*, agent-tree-*' } }, async ($, on) => {
    const w = world(on, { git: UNSHIPPED })
    await start($)
    await w.clock.settle()
    const ui = await mount($)
    expect(await ui.findAll({ type: 'Button', text: 'main ↑4 · 1 dirty · 1 unpushed' })).toHaveLength(1)
  })

  test('the status entry clears once nothing is unshipped', async ($, on) => {
    const git: Git = { ...UNSHIPPED }
    const w = world(on, { git })
    await start($)
    await w.clock.settle()
    expect(w.statuses.at(-1)).toBeDefined()
    Object.assign(git, CLEAN)
    await bash($, 'git push', () => w.clock.settle())
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('outside a git repository: no line, no status entry, no error', async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.settle()
    const ui = await mount($)
    expect(await ui.findAll({ type: 'Button', key: 'ship' })).toHaveLength(0)
    expect(w.statuses.every(s => s === undefined)).toBe(true)
    expect(w.toasts).toEqual([])
  })

  test('refreshed after a Bash call naming git and after a Write or Edit, not after other Bash calls', async ($, on) => {
    const w = world(on, { git: CLEAN })
    await bash($, 'ls -la', () => w.clock.settle())
    expect(w.statusReads()).toBe(0)
    await bash($, 'git commit -m x', () => w.clock.settle())
    expect(w.statusReads()).toBe(1)
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/a.rs`, content: 'x' })
    await w.clock.settle()
    expect(w.statusReads()).toBe(2)
    await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${CWD}/a.rs`, old_string: 'a', new_string: 'b' } as never)
    await w.clock.settle()
    expect(w.statusReads()).toBe(3)
  })

  test('a failed Write does not refresh', async ($, on) => {
    const w = world(on, { git: CLEAN, isWriteError: true })
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', file_path: `${CWD}/a.rs`, content: 'x' })
    await w.clock.settle()
    expect(w.statusReads()).toBe(0)
  })

  test('every 30 s while the pane is open', async ($, on) => {
    const w = world(on, { git: CLEAN })
    await start($)
    await w.clock.settle()
    const first = w.statusReads()
    await w.clock.advance(30_000)
    await w.clock.settle()
    expect(w.statusReads()).toBe(first + 1)
    await w.clock.advance(60_000)
    await w.clock.settle()
    expect(w.statusReads()).toBe(first + 3)
  })

  test('not on the timer while the pane is closed', async ($, on) => {
    const w = world(on, { git: CLEAN, paneOpen: false })
    await start($)
    await w.clock.settle()
    const first = w.statusReads()
    await w.clock.advance(90_000)
    await w.clock.settle()
    expect(w.statusReads()).toBe(first)
  })
})
