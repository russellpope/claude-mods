import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { FAILED_TICKET, HANSA_GATE, NOW, PASSED_GATE, PROJECTS, RUNNING_GATE, UNAVAILABLE, overview } from './fixtures'

type On = Parameters<TestBody>[1]
type E = Parameters<TestBody>[0]

// An op hook (process.run, fs.*) answers { value }.
const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const CWD = '/Users/me/worktrees/kintsugi-moyf'
const KINTSUGI_GIT = '/Users/me/Projects/github.com/kintsugi/.git\n'
const OVERVIEW = overview([FAILED_TICKET], [RUNNING_GATE, PASSED_GATE, HANSA_GATE])
const PANE_PROPS = (bodyColumns: number) => ({ title: 'kintsugi', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} })

/** Answers git and kintsugi by argv, and records every argv. */
const host = (on: On, answers: { git?: string; projects?: string; overview?: () => string | Error }) => {
  const calls: string[][] = []
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    if (e.argv[0] === 'git') return out(answers.git ?? KINTSUGI_GIT)
    if (e.argv.includes('project')) return out(answers.projects ?? PROJECTS)
    const o = answers.overview ? answers.overview() : OVERVIEW
    if (o instanceof Error) throw o
    return out(o, o === UNAVAILABLE ? 2 : 0)
  })
  return calls
}

const setup = (on: On, env: Record<string, string> = { HOME: '/home/me' }) => {
  mock.env(on, env)
  on('session.cwd', async () => ({ value: CWD }))
  let isOpen = false
  on('ui.open', async () => {
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({ value: isOpen ? [{ id: 'kintsugi-runs', title: 'kintsugi', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.close', async () => {
    isOpen = false
    return { value: undefined }
  })
  let last: Snapshot | undefined
  let frames = 0
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'kintsugi-runs' && e.key === 'snapshot') last = e.value as Snapshot
    if (e.plugin === 'kintsugi-runs' && e.key === 'frame') frames++
    return next(e)
  })
  return {
    open: async ($: E): Promise<Snapshot> => {
      await $.command.run({ command: 'kintsugi-runs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
      if (!last) throw new Error('no snapshot was written')
      return last
    },
    last: () => last,
    frames: () => frames,
  }
}

const mount = ($: E, cols = 100) => $.ui.mount({ plugin: 'kintsugi-runs', surface: 'terminal', component: 'Pane', requestId: 'kintsugi-runs', props: PANE_PROPS(cols) })

describe('refresh (through /kintsugi-runs)', () => {
  test("finds this repo's project from a worktree and reads the runs with the documented config", async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    const calls = host(on, {})
    const snap = await setup(on).open($)

    expect(snap.project).toEqual({ id: '8e8b4d9a-c3fd-49f8-a02f-72770b822899', name: 'kintsugi' })
    expect(snap.runs).toHaveLength(4)
    expect(snap.error).toBe('')
    expect(snap.seenAt).toBe(NOW)
    expect(calls[0]).toEqual(['git', '-C', CWD, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    expect(calls).toContainEqual(['kintsugi', '--config', '/home/me/.config/kintsugi/config.toml', '--json', 'run', 'overview'])
  })

  test('KINTSUGI_CONFIG names the config when set', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    const calls = host(on, {})
    await setup(on, { HOME: '/home/me', KINTSUGI_CONFIG: '/etc/kintsugi.toml' }).open($)
    expect(calls).toContainEqual(['kintsugi', '--config', '/etc/kintsugi.toml', '--json', 'run', 'overview'])
  })

  test("kintsugi's error answer is shown, and the last runs stay", async ($, on) => {
    let n = 0
    on('clock.now', async () => ({ value: NOW + n * 1000 }))
    host(on, { overview: () => (n++ === 0 ? OVERVIEW : UNAVAILABLE) })
    const pane = setup(on)
    await pane.open($)
    await $.command.run({ command: 'kintsugi-runs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await pane.open($)
    const snap = pane.last() as Snapshot
    expect(snap.error).toBe('kintsugi: Local state is unavailable')
    expect(snap.runs).toHaveLength(4)
    expect(snap.seenAt).toBe(NOW)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /kintsugi: Local state is unavailable/ })).toBeDefined()
    await ui.unmount()
  })

  test('kintsugi that cannot start says so; nothing throws', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { overview: () => new Error('spawn kintsugi ENOENT') })
    const snap = await setup(on).open($)
    // The words after the colon are the engine's rejection.
    expect(snap.error).toMatch(/^kintsugi did not run: \S/)
    expect(snap.runs).toEqual([])
  })

  test('a repo kintsugi does not know: every project, and a note saying so', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { git: '/Users/me/Projects/github.com/elsewhere/.git\n' })
    const snap = await setup(on).open($)
    expect(snap.project).toBeNull()
    expect(snap.isResolved).toBe(true)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /not enrolled in kintsugi · all projects/ })).toBeDefined()
    // The newest active run anywhere: hansa's.
    expect(await ui.find({ type: 'Text', text: /^hansa · verify full · main · aaaaaaa$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('pane', () => {
  test('header, pipeline, jobs rows with exit and time, timing, and when kintsugi was seen', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const ui = await mount($)
    // This repo's own runs: no project name; the state never wraps under the title.
    expect(await ui.find({ type: 'Text', text: /^verify full · main · eb598c9$/ })).toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'state' }))?.props).toMatchObject({ flexShrink: 0 })
    expect(await ui.find({ type: 'Text', text: /^⠋ running$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^started 1h ago$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✓ fmt → ✓ check → ✓ lint → ⠋ test → ○ skip-gate$/ })).toBeDefined()
    const test = await ui.find({ type: 'Box', key: 'job-test' })
    expect(test?.text).toMatch(/⠋ running\s*test\s*—\s*1h01m/)
    expect((await ui.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/✓ passed\s*check\s*0\s*38s/)
    expect(await ui.find({ type: 'Text', text: /^seen 0s ago$/ })).toBeDefined()
    await ui.unmount()
  })

  test('timing: the whole run spans the panel width, each stage placed and sized within it', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const ui = await mount($, 100)
    expect(await ui.find({ type: 'Text', text: /^Timing$/ })).toBeDefined()
    // The run so far: 1h02m.
    expect(await ui.find({ type: 'Text', text: /^1h02m$/ })).toBeDefined()
    // 100 columns less the stage names (9) and a gap: a 90-cell track.
    const test = await ui.find({ type: 'Box', key: 'bar-test' })
    expect(test?.props).toMatchObject({ width: 90 })
    expect(test?.text).toMatch(/^·━{89}$/)
    expect((await ui.find({ type: 'Box', key: 'bar-fmt' }))?.text).toBe('━')
    // Not started: a name and no bar.
    expect(await ui.find({ type: 'Box', key: 'bar-skip-gate' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'tl-skip-gate' })).toBeDefined()
    await ui.unmount()
  })

  test('only the active run: no recent list, nothing to pin', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^Recent$/ })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /778107f/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a narrow pane drops exit codes, then the timing section', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const mid = await mount($, 40)
    expect((await mid.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/check\s*0\s*38s/)
    expect(await mid.find({ type: 'Box', key: 'bar-test' })).toBeDefined()
    await mid.unmount()
    const narrow = await mount($, 34)
    expect((await narrow.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/check\s*38s/)
    await narrow.unmount()
    const tiny = await mount($, 17)
    expect(await tiny.find({ type: 'Text', text: /^Timing$/ })).toBeUndefined()
    await tiny.unmount()
  })

  test('nothing yet: a plain line', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { overview: () => overview([], []) })
    await setup(on).open($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^No kintsugi runs yet for kintsugi\.$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('timers', () => {
  const start = async ($: E, on: On) => {
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async (_$, e) => ({ value: { command: e.name } }))
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  }

  test('a session that never opens the tab calls nothing', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const calls = host(on, {})
    let panes = 0
    mock.env(on, { HOME: '/home/me' })
    // Answered, so a stray refresh would get as far as calling git and kintsugi.
    on('session.cwd', async () => ({ value: CWD }))
    on('ui.panes', async () => {
      panes++
      return { value: [] }
    })
    await start($, on)
    panes = 0 // session.start looks once, for a pane kept across a reload
    await clock.advance(10_000)
    expect(calls).toEqual([])
    expect(panes).toBe(0)
  })

  test('the spinner turns while the shown run has a running stage', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    host(on, {})
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    await clock.advance(1000)
    expect(pane.frames()).toBeGreaterThanOrEqual(3)
  })

  test('motion off: the spinner stays still', { options: { motion: 'off' } }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    host(on, {})
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    await clock.advance(1000)
    expect(pane.frames()).toBe(0)
  })

  test('nothing running: the spinner stays still', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    host(on, { overview: () => overview([FAILED_TICKET], [PASSED_GATE]) })
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    await clock.advance(1000)
    expect(pane.frames()).toBe(0)
  })

  test('while open it reads again every 2 s, never two at once', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const calls = host(on, {})
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    const before = calls.filter(c => c.includes('overview')).length
    await clock.advance(6000)
    expect(calls.filter(c => c.includes('overview')).length - before).toBe(3)
    // The project is looked up once.
    expect(calls.filter(c => c.includes('project')).length).toBe(1)
  })
})
