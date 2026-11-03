import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Project, Snapshot, TestTally, TestsView } from '../types'
import {
  TEST_STAGE,
  commonDirArgv,
  configPath,
  countTests,
  currentRun,
  isMoving,
  logsArgv,
  mainRoot,
  matchProject,
  overviewArgv,
  parseProjects,
  parseRuns,
  projectsArgv,
  testCount,
  testsBaseline,
  unwrap,
} from './kintsugi'
import { drawPane } from './pane'

export const PANE = 'kintsugi-runs'
export const PANE_TITLE = 'kintsugi'

// The console reads every 2 s; the spinner steps as agent-tree's crab does.
const POLL_MS = 2000
const FRAME_MS = 250
const CALL_MS = 10_000
// A test stage's log is read whole (~12 ms for 380 KB), so less often than the overview.
const TESTS_MS = 5000

export const EMPTY_SNAPSHOT: Snapshot = { at: 0, seenAt: 0, isResolved: false, project: null, runs: [], error: '' }

export const snapshot = atom({ plugin: 'kintsugi-runs', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
export const frame = atom({ plugin: 'kintsugi-runs', key: 'frame' } as const, 0)

export const EMPTY_TESTS: TestsView = { runId: '', tally: null, isFinal: false, baseId: '', total: null }
export const tests = atom({ plugin: 'kintsugi-runs', key: 'tests' } as const, EMPTY_TESTS)

const kintsugiConfig = async ($: EngineInterface): Promise<string> => configPath(await $.env.get('KINTSUGI_CONFIG'), (await $.env.get('HOME')) ?? '')

/** One kintsugi call: its JSON answer's value, or the error in words. */
async function ask($: EngineInterface, argv: string[]): Promise<{ value: unknown } | { error: string }> {
  try {
    const r = await $.process.run(argv, { timeoutMs: CALL_MS })
    const answer = unwrap(r.stdout || r.stderr)
    return 'error' in answer ? { error: `kintsugi: ${answer.error}` } : answer
  } catch (err) {
    return { error: `kintsugi did not run: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** This session's repo as a kintsugi project: null when it is not enrolled, undefined when kintsugi did not say. */
async function findProject($: EngineInterface, config: string): Promise<Project | null | undefined> {
  const cwd = await $.session.cwd()
  const git = await $.process.run(commonDirArgv(cwd), { timeoutMs: CALL_MS }).catch(() => null)
  // Not a git repo: no project of its own.
  if (!git || git.exitCode !== 0) return null
  const answer = await ask($, projectsArgv(config))
  if ('error' in answer) return undefined
  return matchProject(parseProjects(answer.value), mainRoot(git.stdout))
}

async function refreshOnce($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  const config = await kintsugiConfig($)
  const prev = await read($, snapshot)
  // Looked up once; the snapshot keeps it across a reload.
  const project = prev.isResolved ? prev.project : await findProject($, config)
  const isResolved = project !== undefined
  const answer = await ask($, overviewArgv(config))
  if ('error' in answer) {
    await update($, snapshot, s => ({ ...s, at, isResolved, project: project ?? null, error: answer.error }))
    return
  }
  await update($, snapshot, () => ({ at, seenAt: at, isResolved, project: project ?? null, runs: parseRuns(answer.value), error: '' }))
}

// One read at a time: a slow kintsugi skips ticks instead of stacking calls.
let isBusy = false

async function refresh($: EngineInterface): Promise<void> {
  if (isBusy) return
  isBusy = true
  try {
    await refreshOnce($)
  } finally {
    isBusy = false
  }
}

/** A run's test stage log, counted: null when kintsugi fails, the log was cut short, or it holds no tests. */
async function readTally($: EngineInterface, config: string, id: string): Promise<TestTally | null> {
  try {
    const r = await $.process.run(logsArgv(config, id), { timeoutMs: CALL_MS })
    // Past the engine's 4 MiB the count would come up short: better no section than a wrong one.
    // kintsugi's error answers hold no test lines, so they count as none.
    return r.isStdoutTruncated ? null : countTests(r.stdout)
  } catch {
    return null
  }
}

/** Counts the shown gate run's test stage once it has started; once more after it ends, then no more. */
async function refreshTestsOnce($: EngineInterface): Promise<void> {
  const snap = await read($, snapshot)
  const run = currentRun(snap.runs, snap.project?.id ?? null)
  const stage = run?.kind === 'gate' ? run.stages.find(s => s.name === TEST_STAGE) : undefined
  if (!run || !stage || stage.startedAt === null) return
  const prev = await read($, tests)
  if (prev.runId === run.id && prev.isFinal) return
  const config = await kintsugiConfig($)
  const tally = await readTally($, config, run.id)
  // The usual total: the last passed run's count, read once per such run.
  const base = testsBaseline(snap.runs, run)
  let total = base && prev.baseId === base.id ? prev.total : null
  if (base && total === null) {
    const t = await readTally($, config, base.id)
    total = t && testCount(t)
  }
  const isFinal = stage.state !== 'running' && tally !== null
  await update($, tests, () => ({ runId: run.id, tally, isFinal, baseId: base && total !== null ? base.id : '', total }))
}

let isCounting = false

async function refreshTests($: EngineInterface): Promise<void> {
  if (isCounting) return
  isCounting = true
  try {
    await refreshTestsOnce($)
  } finally {
    isCounting = false
  }
}

// True from the moment this session opens the pane until ui.panes says it is gone: a session
// that never opened it asks nothing (the mod loads in every session).
let mayBeOpen = false

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  if (!mayBeOpen) return false
  mayBeOpen = (await $.ui.panes()).some(p => p.id === PANE)
  return mayBeOpen
}

async function togglePane($: EngineInterface): Promise<boolean> {
  // A person asked: look, whatever the flag says.
  mayBeOpen = true
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  mayBeOpen = true
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  // Awaited, so the pane's first draw has data, the test count included (a read or two of ~12 ms).
  await refresh($).catch(() => undefined)
  await refreshTests($).catch(() => undefined)
  return true
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'kintsugi-runs', description: "Show or hide this repo's kintsugi verification runs" })
    // A reload keeps an open pane but starts the module's flag over: look once.
    mayBeOpen = true
    await isPaneOpen($).catch(() => false)
    $.clock.every(POLL_MS, () => {
      void (async () => {
        if (await isPaneOpen($)) await refresh($)
      })().catch(() => undefined)
    })
    $.clock.every(TESTS_MS, () => {
      void (async () => {
        if (await isPaneOpen($)) await refreshTests($)
      })().catch(() => undefined)
    })
    $.clock.every(FRAME_MS, () => {
      void (async () => {
        if (options.motion === 'off' || !mayBeOpen) return
        const snap = await read($, snapshot)
        if (!isMoving(currentRun(snap.runs, snap.project?.id ?? null)) || !(await isPaneOpen($))) return
        await update($, frame, f => f + 1)
      })().catch(() => undefined)
    })
    return started
  })

  on('command.run', { command: 'kintsugi-runs' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'kintsugi runs opened.' : 'kintsugi runs closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    drawPane(
      $.ui.resolve(e),
      {
        snap: await read($, snapshot),
        frame: await read($, frame),
        tests: await read($, tests),
        now: await $.clock.now(),
        cols: e.props.bodyColumns || 80,
        surface: e.surface,
      },
    ),
  )
}
