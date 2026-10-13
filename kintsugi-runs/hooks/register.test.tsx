import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { FAILED_TICKET, HANSA_GATE, NOW, PASSED_GATE, PASSED_TEST_LOG, PROJECTS, QUEUED_GATE, RUNNING_GATE, RUNNING_TEST_LOG, UNAVAILABLE, overview } from './fixtures'

type On = Parameters<TestBody>[1]
type E = Parameters<TestBody>[0]

// An op hook (process.run, fs.*) answers { value }.
const out = (stdout: string, exitCode = 0, isStdoutTruncated = false) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated, isStderrTruncated: false } })
const CWD = '/Users/me/worktrees/kintsugi-moyf'
const KINTSUGI_GIT = '/Users/me/Projects/github.com/kintsugi/.git\n'
const OVERVIEW = overview([FAILED_TICKET], [RUNNING_GATE, PASSED_GATE, HANSA_GATE])
const PANE_PROPS = (bodyColumns: number) => ({ title: 'kintsugi', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} })

/** A `run logs` answer: the log, or kintsugi failing, or a log cut at the engine's 4 MiB. */
type LogAnswer = string | Error | { cut: string }

/** Answers git and kintsugi by argv, and records every argv. Logs, by operation id, default to none. */
const host = (on: On, answers: { git?: string; projects?: string; overview?: () => string | Error; logs?: (id: string) => LogAnswer }) => {
  const calls: string[][] = []
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    if (e.argv[0] === 'git') return out(answers.git ?? KINTSUGI_GIT)
    if (e.argv.includes('project')) return out(answers.projects ?? PROJECTS)
    if (e.argv.includes('logs')) {
      const log = answers.logs ? answers.logs(e.argv[e.argv.indexOf('--operation-id') + 1] ?? '') : ''
      if (log instanceof Error) throw log
      return typeof log === 'string' ? out(log) : out(log.cut, 0, true)
    }
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
  test('header, jobs rows with exit and time, timing, and when kintsugi was seen', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const ui = await mount($)
    // This repo's own runs: no project name; the state never wraps under the title.
    expect(await ui.find({ type: 'Text', text: /^verify full · main · eb598c9$/ })).toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'state' }))?.props).toMatchObject({ flexShrink: 0 })
    expect(await ui.find({ type: 'Text', text: /^⠋ running$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^started 1h ago$/ })).toBeDefined()
    const test = await ui.find({ type: 'Box', key: 'job-test' })
    expect(test?.text).toMatch(/⠋ running\s*test\s*—\s*1h01m/)
    expect((await ui.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/✓ passed\s*check\s*0\s*38s/)
    expect(await ui.find({ type: 'Text', text: /^seen 0s ago$/ })).toBeDefined()
    await ui.unmount()
  })

  test('the pipeline breaks only between whole stages, each arrow kept with the stage before it', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const ui = await mount($, 42)
    // A wrapping row moves whole boxes to the next line; one long Text breaks at any space,
    // which left "○" at a line's end and "skip-gate" under it.
    expect((await ui.find({ type: 'Box', key: 'pipe' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
    // A stage's text, and how its one label truncates rather than wraps when wider than the pane.
    const stage = async (name: string) => {
      const box = await ui.find({ type: 'Box', key: `pipe-${name}` })
      const label = box?.children[0] as { props?: { wrap?: string } } | undefined
      return { text: box?.text, wrap: label?.props?.wrap }
    }
    expect(await stage('fmt')).toEqual({ text: '✓ fmt →', wrap: 'truncate-end' })
    expect(await stage('check')).toEqual({ text: '✓ check →', wrap: 'truncate-end' })
    expect(await stage('lint')).toEqual({ text: '✓ lint →', wrap: 'truncate-end' })
    expect(await stage('test')).toEqual({ text: '⠋ test →', wrap: 'truncate-end' })
    // The last stage has no arrow.
    expect(await stage('skip-gate')).toEqual({ text: '○ skip-gate', wrap: 'truncate-end' })
    await ui.unmount()
  })

  test('timing while test runs: finished stages to scale on the left, test filling against its usual length on the right', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const ui = await mount($, 100)
    expect(await ui.find({ type: 'Text', text: /^Timing$/ })).toBeDefined()
    // Usual: the passed gate run in the overview took 1h29m over test.
    expect(await ui.find({ type: 'Text', text: /^test 1h01m of ~1h29m$/ })).toBeDefined()
    // 100 columns less the stage names (9) and a gap: a 90-cell track, test on its right 45.
    const test = await ui.find({ type: 'Box', key: 'bar-test' })
    expect(test?.props).toMatchObject({ width: 90 })
    expect(test?.text).toMatch(/^ {45}━{31}╌{14}$/)
    expect((await ui.find({ type: 'Box', key: 'bar-fmt' }))?.text).toBe('━━')
    expect((await ui.find({ type: 'Box', key: 'bar-lint' }))?.text).toMatch(/^ {30}━{14}$/)
    // Not started: a name and no bar.
    expect(await ui.find({ type: 'Box', key: 'bar-skip-gate' })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'tl-skip-gate' })).toBeDefined()
    await ui.unmount()
  })

  test('a run queued behind the running one: the running run shows, the queue counted under its header', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { overview: () => overview([], [QUEUED_GATE, RUNNING_GATE, PASSED_GATE]) })
    await setup(on).open($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^verify full · main · eb598c9$/ })).toBeDefined()
    // Two pieces in a wrapping row, so a narrow pane breaks between them, not mid-phrase.
    expect((await ui.find({ type: 'Box', key: 'since' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
    expect((await ui.find({ type: 'Box', key: 'since-age' }))?.text).toBe('started 1h ago ·')
    expect((await ui.find({ type: 'Box', key: 'since-queue' }))?.text).toBe('1 queued behind it')
    await ui.unmount()
  })

  test('a run that waited 26 minutes in the queue: timed from its first stage, the wait named under its header', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    const waited = { ...RUNNING_GATE, created_at_ms: RUNNING_GATE.created_at_ms - 26 * 60_000 }
    host(on, { overview: () => overview([], [QUEUED_GATE, waited, PASSED_GATE]) })
    await setup(on).open($)
    const ui = await mount($, 100)
    expect((await ui.find({ type: 'Box', key: 'since-age' }))?.text).toBe('started 1h ago ·')
    expect((await ui.find({ type: 'Box', key: 'since-wait' }))?.text).toBe('waited 26m00s ·')
    expect((await ui.find({ type: 'Box', key: 'since-queue' }))?.text).toBe('1 queued behind it')
    // The bars sit as for the run that started at once (the timing test above), not bunched
    // at the left half's end behind 26 minutes of nothing.
    expect((await ui.find({ type: 'Box', key: 'bar-fmt' }))?.text).toBe('━━')
    expect((await ui.find({ type: 'Box', key: 'bar-lint' }))?.text).toMatch(/^ {30}━{14}$/)
    await ui.unmount()
  })

  test('a run still in the queue: when it was queued, and no timing until a stage starts', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { overview: () => overview([], [QUEUED_GATE]) })
    await setup(on).open($)
    const ui = await mount($, 100)
    expect(await ui.find({ type: 'Text', text: /^verify full · main · f39b294$/ })).toBeDefined()
    expect((await ui.find({ type: 'Box', key: 'since-age' }))?.text).toBe('queued 1m ago')
    // Its heading would only time the wait, over no bars.
    expect(await ui.find({ type: 'Text', text: /^Timing$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: 'timing' })).toBeUndefined()
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

  test('a narrow pane drops exit codes, then state words, then the timing section', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, {})
    await setup(on).open($)
    const mid = await mount($, 40)
    expect((await mid.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/check\s*0\s*38s/)
    expect(await mid.find({ type: 'Box', key: 'bar-test' })).toBeDefined()
    await mid.unmount()
    const narrow = await mount($, 34)
    expect((await narrow.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/passed\s*check\s*38s/)
    await narrow.unmount()
    // Too narrow for the state word: its coloured glyph stays, and so does the time.
    const slim = await mount($, 24)
    expect((await slim.find({ type: 'Box', key: 'job-test' }))?.text).toMatch(/^⠋\s*test\s*1h01m$/)
    expect((await slim.find({ type: 'Box', key: 'job-check' }))?.text).toMatch(/^✓\s*check\s*38s$/)
    await slim.unmount()
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

const LOGS = (id: string): LogAnswer => (id === RUNNING_GATE.operation_id ? RUNNING_TEST_LOG : id === PASSED_GATE.operation_id ? PASSED_TEST_LOG : '')
const LOGS_ARGV = (id: string) => ['kintsugi', '--config', '/home/me/.config/kintsugi/config.toml', 'run', 'logs', '--operation-id', id, '--stage', 'test']
const FAILED_NAME = 'inbox::production_review_tests::i261_socket_local_settings_end_the_review'

describe('tests section', () => {
  test('while test runs: the tests run so far against the last passed run, the tally, the failed test by name', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    const calls = host(on, { logs: LOGS })
    await setup(on).open($)
    expect(calls).toContainEqual(LOGS_ARGV(RUNNING_GATE.operation_id))
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^Tests$/ })).toBeDefined()
    // Five reported so far; the passed run reported six.
    expect(await ui.find({ type: 'Text', text: /^5 of ~6 run$/ })).toBeDefined()
    // A narrow pane moves the count under the label instead of squeezing "Tests".
    expect((await ui.find({ type: 'Box', key: 'tests-head' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
    expect((await ui.find({ type: 'Box', key: 'tests-label' }))?.props).toMatchObject({ flexShrink: 0 })
    // Whole items in a wrapping row, as the pipeline.
    expect((await ui.find({ type: 'Box', key: 'tally' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
    expect((await ui.find({ type: 'Box', key: 'tally-passed' }))?.text).toBe('✓ 3 passed ·')
    expect((await ui.find({ type: 'Box', key: 'tally-failed' }))?.text).toBe('✗ 1 failed ·')
    expect((await ui.find({ type: 'Box', key: 'tally-ignored' }))?.text).toBe('1 ignored')
    expect(await ui.find({ type: 'Text', text: '✗ 1 failed' })).toMatchObject({ props: { color: 'error' } })
    // The name gives way from its left, so the test's own name at the end stays in view.
    expect((await ui.find({ type: 'Box', key: 'failed-0' }))?.text).toMatch(new RegExp(`^✗\\s*${FAILED_NAME}$`))
    expect(await ui.find({ type: 'Text', text: FAILED_NAME })).toMatchObject({ props: { color: 'error', wrap: 'truncate-start' } })
    await ui.unmount()
  })

  test('no failures: the failed count is dim, and no names', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { logs: () => PASSED_TEST_LOG })
    await setup(on).open($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: '✗ 0 failed' })).toMatchObject({ props: { dimColor: true } })
    expect(await ui.find({ type: 'Box', key: 'failed-0' })).toBeUndefined()
    await ui.unmount()
  })

  test('more than three failures: three by name, then how many more', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    const five = [1, 2, 3, 4, 5].map(i => `test t::f${i} ... FAILED`).join('\n')
    host(on, { logs: id => (id === RUNNING_GATE.operation_id ? five : PASSED_TEST_LOG) })
    await setup(on).open($)
    const ui = await mount($)
    expect((await ui.find({ type: 'Box', key: 'failed-2' }))?.text).toMatch(/t::f3$/)
    expect(await ui.find({ type: 'Box', key: 'failed-3' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^\+2 more$/ })).toBeDefined()
    await ui.unmount()
  })

  test('a finished test stage: its final count, no usual total', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    host(on, { overview: () => overview([], [PASSED_GATE]), logs: LOGS })
    await setup(on).open($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^6 run$/ })).toBeDefined()
    await ui.unmount()
  })

  test('the count belongs to its run: when another run is shown, the section goes', async ($, on) => {
    on('clock.now', async () => ({ value: NOW }))
    let n = 0
    host(on, { overview: () => (n++ === 0 ? OVERVIEW : overview([], [QUEUED_GATE, PASSED_GATE])), logs: LOGS })
    const pane = setup(on)
    await pane.open($)
    // Close, then open on the next overview: only the queued run is under way now.
    await $.command.run({ command: 'kintsugi-runs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await pane.open($)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: /^verify full · main · f39b294$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Tests$/ })).toBeUndefined()
    await ui.unmount()
  })

  const unread: [string, LogAnswer][] = [
    ['no test lines in the log', 'RUN LOGS operation=x stage=test\n'],
    ['kintsugi failing', new Error('spawn kintsugi ENOENT')],
    ['a log cut at 4 MiB', { cut: RUNNING_TEST_LOG }],
  ]
  for (const [why, log] of unread)
    test(`no section: ${why}; the rest of the tab stays`, async ($, on) => {
      on('clock.now', async () => ({ value: NOW }))
      host(on, { logs: id => (id === RUNNING_GATE.operation_id ? log : PASSED_TEST_LOG) })
      await setup(on).open($)
      const ui = await mount($)
      expect(await ui.find({ type: 'Text', text: /^Tests$/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^Timing$/ })).toBeDefined()
      await ui.unmount()
    })

  // Lint still running: the gate run's test stage has not started.
  const BEFORE_TEST = {
    ...RUNNING_GATE,
    stages: RUNNING_GATE.stages.map(st =>
      st.name === 'lint' ? { ...st, state: 'running', finished_at_ms: null, exit_code: null } : st.name === 'test' ? { ...st, state: 'pending', started_at_ms: null } : st,
    ),
  }
  // A ticket run's test stage, started: run logs reads operator runs only.
  const TICKET_TESTING = { ...FAILED_TICKET, state: 'running', stages: [{ ...FAILED_TICKET.stages[1], state: 'running', started_at_ms: 1791608400100 }] }
  for (const [why, ops, items] of [
    ['a run only queued', [QUEUED_GATE], []],
    ['a test stage not started yet', [BEFORE_TEST], []],
    ['a ticket run', [], [TICKET_TESTING]],
  ] as [string, object[], object[]][])
    test(`no log is read for ${why}`, async ($, on) => {
      on('clock.now', async () => ({ value: NOW }))
      const calls = host(on, { overview: () => overview(items, ops), logs: LOGS })
      await setup(on).open($)
      expect(calls.filter(c => c.includes('logs'))).toEqual([])
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

  test("while a test stage runs and the tab is open, its log is read every 5 s; the passed run's once", async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const calls = host(on, { logs: LOGS })
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    const reads = (id: string) => calls.filter(c => c.includes('logs') && c.includes(id)).length
    const before = reads(RUNNING_GATE.operation_id)
    expect(before).toBe(1)
    await clock.advance(10_000)
    expect(reads(RUNNING_GATE.operation_id) - before).toBe(2)
    expect(reads(PASSED_GATE.operation_id)).toBe(1)
  })

  test('a finished test stage is read once, then left alone', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const calls = host(on, { overview: () => overview([], [PASSED_GATE]), logs: LOGS })
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    await clock.advance(10_000)
    expect(calls.filter(c => c.includes('logs'))).toEqual([LOGS_ARGV(PASSED_GATE.operation_id)])
  })

  test('closing the tab stops the log reads', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const calls = host(on, { logs: LOGS })
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    await $.command.run({ command: 'kintsugi-runs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    const before = calls.filter(c => c.includes('logs')).length
    await clock.advance(10_000)
    expect(calls.filter(c => c.includes('logs')).length).toBe(before)
  })

  test('a finished stage whose log could not be read is read again', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    let n = 0
    const calls = host(on, { overview: () => overview([], [PASSED_GATE]), logs: () => (n++ === 0 ? new Error('kintsugi busy') : PASSED_TEST_LOG) })
    const pane = setup(on)
    await start($, on)
    await pane.open($)
    await clock.advance(10_000)
    // Failed once, read on the next tick, then final.
    expect(calls.filter(c => c.includes('logs')).length).toBe(2)
  })
})
