import { describe, expect, test } from 'claude-code/testing'

import type { Run, Stage } from '../types'
import { FAILED_TICKET, HANSA_GATE, KINTSUGI_ID, NOW, PASSED_GATE, PROJECTS, RUNNING_GATE, UNAVAILABLE, overview } from './fixtures'
import {
  SPINNER,
  bar,
  columns,
  configPath,
  currentRun,
  fmtAgo,
  fmtDuration,
  glyph,
  isMoving,
  mainRoot,
  matchProject,
  overviewArgv,
  parseProjects,
  parseRuns,
  runDuration,
  stageDuration,
  stateColor,
  stateWord,
  timingTrack,
  unwrap,
} from './kintsugi'

const runsOf = (items: object[], ops: object[]): Run[] => {
  const r = unwrap(overview(items, ops))
  if ('error' in r) throw new Error(r.error)
  return parseRuns(r.value)
}
const ALL = runsOf([FAILED_TICKET], [RUNNING_GATE, PASSED_GATE, HANSA_GATE])
const byId = (id: string) => ALL.find(r => r.id === id)

describe('talking to kintsugi', () => {
  test('config: KINTSUGI_CONFIG wins, else the file kintsugi documents', () => {
    expect(configPath('/etc/k.toml', '/home/me')).toBe('/etc/k.toml')
    expect(configPath(undefined, '/home/me')).toBe('/home/me/.config/kintsugi/config.toml')
    expect(configPath('', '/home/me')).toBe('/home/me/.config/kintsugi/config.toml')
    expect(overviewArgv('/c.toml')).toEqual(['kintsugi', '--config', '/c.toml', '--json', 'run', 'overview'])
  })

  test("unwrap: an ok answer's value; kintsugi's own error message; anything else says so", () => {
    expect(unwrap(PROJECTS)).toHaveProperty('value')
    expect(unwrap(UNAVAILABLE)).toEqual({ error: 'Local state is unavailable' })
    expect(unwrap('')).toEqual({ error: 'kintsugi gave no answer' })
    expect(unwrap('thread main panicked\nmore')).toEqual({ error: 'thread main panicked' })
  })
})

describe('runs', () => {
  test('a gate run: verify <profile>, the branch without refs/heads/, its stages in order', () => {
    const gate = byId(RUNNING_GATE.operation_id)
    expect(gate).toMatchObject({ kind: 'gate', title: 'verify full', ref: 'main', sha: 'eb598c9', state: 'running', project: 'kintsugi', projectId: KINTSUGI_ID })
    expect(gate?.stages.map(s => `${s.name}:${s.state}`)).toEqual(['fmt:succeeded', 'check:succeeded', 'lint:succeeded', 'test:running', 'skip-gate:pending'])
    expect(gate?.stages[0]).toEqual({ name: 'fmt', state: 'succeeded', exitCode: 0, startedAt: 1791605021291, finishedAt: 1791605024241 })
    expect(gate?.stages[4]).toEqual({ name: 'skip-gate', state: 'pending', exitCode: null, startedAt: null, finishedAt: null })
  })

  test('a ticket run: <ticket> verification, short sha, the runtime detail', () => {
    expect(byId('op-ticket-i371')).toMatchObject({ kind: 'ticket', title: 'I371 verification', ref: '', sha: '1234567', state: 'failed', detail: 'check failed' })
  })

  test('missing lists and fields do not throw', () => {
    expect(parseRuns({})).toEqual([])
    expect(parseRuns({ operator_runs: [{ operation_id: 'x' }] })[0]).toMatchObject({ id: 'x', project: '', stages: [], title: 'verify ' })
  })
})

describe('this session’s project', () => {
  test('main checkout from git --git-common-dir, worktrees included', () => {
    expect(mainRoot('/Users/me/Projects/github.com/kintsugi/.git')).toBe('/Users/me/Projects/github.com/kintsugi')
    expect(mainRoot('/Users/me/Projects/github.com/kintsugi/.git/\n')).toBe('/Users/me/Projects/github.com/kintsugi')
    expect(mainRoot('/srv/bare.git')).toBe('/srv/bare.git')
  })

  test('matched by checkout path, not by name', () => {
    const r = unwrap(PROJECTS)
    if ('error' in r) throw new Error(r.error)
    const projects = parseProjects(r.value)
    expect(matchProject(projects, '/Users/me/Projects/github.com/kintsugi')).toEqual({ id: KINTSUGI_ID, name: 'kintsugi' })
    expect(matchProject([{ id: 'a', name: 'kintsugi', checkout: '/elsewhere/kintsugi/' }], '/elsewhere/kintsugi')).toEqual({ id: 'a', name: 'kintsugi' })
    // Same name, other place: not this repo.
    expect(matchProject(projects, '/tmp/kintsugi')).toBeNull()
    expect(matchProject(projects, '')).toBeNull()
  })
})

describe('which run the tab shows', () => {
  test("the active run; a running run beats a newer finished one; other projects' runs are left out", () => {
    expect(currentRun(ALL, KINTSUGI_ID)?.id).toBe(RUNNING_GATE.operation_id)
  })

  test('nothing active: the newest run, so the last result stays in view', () => {
    const idle = ALL.filter(r => r.state !== 'running')
    expect(currentRun(idle, KINTSUGI_ID)?.id).toBe('op-ticket-i371')
  })

  test('no project (not enrolled): every project counts', () => {
    expect(currentRun(ALL, null)?.id).toBe('op-hansa')
  })

  test('no runs: none', () => {
    expect(currentRun([], KINTSUGI_ID)).toBeNull()
  })
})

describe('drawing words', () => {
  test("the console's words and glyphs; only a running state spins", () => {
    expect(stateWord('succeeded')).toBe('passed')
    expect(stateWord('pending')).toBe('queued')
    expect(stateWord('quota_paused')).toBe('quota paused')
    expect(stateWord('failed')).toBe('failed')
    expect(glyph('succeeded', 0)).toBe('✓')
    expect(glyph('failed', 3)).toBe('✗')
    expect(glyph('pending', 3)).toBe('○')
    expect(glyph('running', 0)).toBe(SPINNER[0])
    expect(glyph('running', 1)).toBe(SPINNER[1])
    expect(glyph('running', SPINNER.length + 2)).toBe(SPINNER[2])
    expect(stateColor('succeeded')).toBe('success')
    expect(stateColor('failed')).toBe('error')
    expect(stateColor('running')).toBe('warning')
    expect(stateColor('pending')).toBeUndefined()
  })

  test('durations and ages', () => {
    expect(fmtDuration(2950)).toBe('2s')
    expect(fmtDuration(683_000)).toBe('11m23s')
    expect(fmtDuration(3_743_705)).toBe('1h02m')
    expect(fmtDuration(0)).toBe('0s')
    expect(fmtAgo(1_500)).toBe('1s ago')
    expect(fmtAgo(12 * 60_000 + 5)).toBe('12m ago')
    expect(fmtAgo(3 * 3_600_000)).toBe('3h ago')
    expect(fmtAgo(50 * 3_600_000)).toBe('2d ago')
  })

  test('a running stage times to now; a queued one has no time', () => {
    const gate = byId(RUNNING_GATE.operation_id) as Run
    expect(stageDuration(gate.stages[0] as Stage, NOW)).toBe(2950)
    expect(stageDuration(gate.stages[3] as Stage, NOW)).toBe(NOW - 1791605081976)
    expect(stageDuration(gate.stages[4] as Stage, NOW)).toBeNull()
  })

  test('a run lasts from its start to its last stage, or to now while active', () => {
    expect(runDuration(byId(PASSED_GATE.operation_id) as Run, NOW)).toBe(1791599099998 - 1791593687860)
    expect(runDuration(byId(RUNNING_GATE.operation_id) as Run, NOW)).toBe(NOW - 1791605020295)
  })

  test('timing bars sit where each stage ran within the run', () => {
    const s = (name: string, a: number, b: number): Stage => ({ name, state: 'succeeded', exitCode: 0, startedAt: a, finishedAt: b })
    const run = { ...(byId(PASSED_GATE.operation_id) as Run), state: 'succeeded', createdAt: 0, stages: [s('a', 0, 10_000), s('b', 10_000, 40_000), s('c', 40_000, 100_000)] }
    expect(run.stages.map(st => bar(st, run, NOW, 10))).toEqual([
      { lead: 0, fill: 1 },
      { lead: 1, fill: 3 },
      { lead: 4, fill: 6 },
    ])
    // Not started: no bar.
    expect(bar({ name: 'q', state: 'pending', exitCode: null, startedAt: null, finishedAt: null }, run, NOW, 10)).toEqual({ lead: 0, fill: 0 })
  })

  test('spinner moves only for an active run with a running stage', () => {
    expect(isMoving(byId(RUNNING_GATE.operation_id) ?? null)).toBe(true)
    expect(isMoving(byId(PASSED_GATE.operation_id) ?? null)).toBe(false)
    expect(isMoving(null)).toBe(false)
  })

  test('narrow panes drop the exit column; nothing wraps', () => {
    const stages = (byId(RUNNING_GATE.operation_id) as Run).stages
    expect(columns(100, stages)).toEqual({ state: 11, stage: 9, exit: 4, time: 6 })
    expect(columns(35, stages)).toEqual({ state: 11, stage: 9, exit: 4, time: 6 })
    expect(columns(34, stages)).toEqual({ state: 11, stage: 9, exit: 0, time: 6 })
  })

  test('the timing track takes the panel width beside the stage names; too narrow, none', () => {
    const stages = (byId(RUNNING_GATE.operation_id) as Run).stages
    expect(timingTrack(52, stages)).toBe(42)
    expect(timingTrack(100, stages)).toBe(90)
    expect(timingTrack(17, stages)).toBe(0)
  })
})
