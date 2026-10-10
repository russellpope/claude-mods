import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Project, Snapshot } from '../types'
import { commonDirArgv, configPath, currentRun, isMoving, mainRoot, matchProject, overviewArgv, parseProjects, parseRuns, projectsArgv, unwrap } from './kintsugi'
import { drawPane } from './pane'

export const PANE = 'kintsugi-runs'
export const PANE_TITLE = 'kintsugi'

// The console reads every 2 s; the spinner steps as agent-tree's crab does.
const POLL_MS = 2000
const FRAME_MS = 250
const CALL_MS = 10_000

export const EMPTY_SNAPSHOT: Snapshot = { at: 0, seenAt: 0, isResolved: false, project: null, runs: [], error: '' }

export const snapshot = atom({ plugin: 'kintsugi-runs', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
export const frame = atom({ plugin: 'kintsugi-runs', key: 'frame' } as const, 0)

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
  const config = configPath(await $.env.get('KINTSUGI_CONFIG'), (await $.env.get('HOME')) ?? '')
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
  // Awaited, so the pane's first draw has data.
  await refresh($).catch(() => undefined)
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
        now: await $.clock.now(),
        cols: e.props.bodyColumns || 80,
        surface: e.surface,
      },
    ),
  )
}
