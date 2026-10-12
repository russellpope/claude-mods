import type { Project, Run, Stage, TestTally } from '../types'

// kintsugi refuses a call without --state or --config, so the mod names the config the way
// kintsugi's own help does: KINTSUGI_CONFIG, else ~/.config/kintsugi/config.toml.
export const configPath = (env: string | undefined, home: string): string => env || `${home}/.config/kintsugi/config.toml`
export const overviewArgv = (config: string): string[] => ['kintsugi', '--config', config, '--json', 'run', 'overview']
export const projectsArgv = (config: string): string[] => ['kintsugi', '--config', config, '--json', 'project', 'list']
export const commonDirArgv = (cwd: string): string[] => ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']

/** The stage whose log the Tests section counts. */
export const TEST_STAGE = 'test'
// `run logs` prints one operator run's stage log as text; it has no --json.
export const logsArgv = (config: string, id: string): string[] => ['kintsugi', '--config', config, 'run', 'logs', '--operation-id', id, '--stage', TEST_STAGE]

/** kintsugi's JSON answer: `{ outcome: 'ok', result: { value } }`, or `{ outcome: 'error', error: { message } }`. */
export function unwrap(stdout: string): { value: unknown } | { error: string } {
  const text = stdout.trim()
  if (!text) return { error: 'kintsugi gave no answer' }
  try {
    const doc = JSON.parse(text) as { outcome?: unknown; result?: { value?: unknown }; error?: { message?: unknown } }
    if (doc.outcome === 'ok') return { value: doc.result?.value }
    const message = doc.error?.message
    return { error: typeof message === 'string' ? message : `kintsugi answered ${String(doc.outcome)}` }
  } catch {
    return { error: text.split('\n')[0] ?? text }
  }
}

type Raw = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v.filter(x => x && typeof x === 'object') as Raw[]) : [])

const toStage = (s: Raw): Stage => ({
  name: str(s.name),
  state: str(s.state),
  exitCode: num(s.exit_code),
  startedAt: num(s.started_at_ms),
  finishedAt: num(s.finished_at_ms),
})

const common = (r: Raw) => ({
  id: str(r.operation_id),
  projectId: str(r.project_id),
  project: str(r.project),
  state: str(r.state),
  createdAt: num(r.created_at_ms) ?? 0,
  updatedAt: num(r.updated_at_ms) ?? 0,
  detail: str(r.detail),
  stages: list(r.stages).map(toStage),
})

/** `run overview`'s value: ticket runs (`items`) and operator gate runs (`operator_runs`). */
export function parseRuns(value: unknown): Run[] {
  const v = (value ?? {}) as Raw
  const tickets = list(v.items).map((r): Run => ({ ...common(r), kind: 'ticket', title: `${str(r.ticket)} verification`, ref: '', sha: str(r.commit).slice(0, 7) }))
  const gates = list(v.operator_runs).map(
    (r): Run => ({ ...common(r), kind: 'gate', title: `verify ${str(r.profile)}`, ref: str(r.ref_name).replace(/^refs\/heads\//, ''), sha: str(r.short_commit) || str(r.commit).slice(0, 7) }),
  )
  return [...tickets, ...gates]
}

export type EnrolledProject = Project & { checkout: string }

export const parseProjects = (value: unknown): EnrolledProject[] =>
  list(((value ?? {}) as Raw).items).map(p => ({ id: str(p.project_id), name: str(p.name), checkout: str(p.checkout) }))

const bare = (path: string): string => path.trim().replace(/\/+$/, '')

/** The main checkout a `git rev-parse --git-common-dir` answer belongs to; a worktree's names the same one. */
export const mainRoot = (commonDir: string): string => bare(commonDir).replace(/\/\.git$/, '')

/** The project enrolled at this checkout: by path, since a name can repeat elsewhere. */
export function matchProject(projects: EnrolledProject[], root: string): Project | null {
  if (!root) return null
  const p = projects.find(x => bare(x.checkout) === bare(root))
  return p ? { id: p.id, name: p.name } : null
}

const ACTIVE = new Set(['pending', 'running', 'quota_paused', 'uncertain'])
export const isActive = (state: string): boolean => ACTIVE.has(state)

// One per-test result line: cargo test's `test <name> ... ok|FAILED|ignored[, <reason>]`, and
// unittest's `<name> (<class>) ... ok|FAIL|ERROR|skipped '<reason>'`. Notices ("has been running
// for over 60 seconds"), failure blocks and `test result:` summaries never have the ` ... ` form.
const RESULT_LINE = /^(.+?) \.\.\. (ok|FAILED|FAIL|ERROR|ignored|skipped)\b/gm
const FAILED_WORDS = new Set(['FAILED', 'FAIL', 'ERROR'])

/** The per-test results in a stage log; null when it holds none. */
export function countTests(log: string): TestTally | null {
  const t: TestTally = { passed: 0, failed: 0, ignored: 0, failedNames: [] }
  for (const [, name = '', word = ''] of log.matchAll(RESULT_LINE)) {
    if (word === 'ok') t.passed++
    else if (FAILED_WORDS.has(word)) {
      t.failed++
      t.failedNames.push(name.replace(/^test /, ''))
    } else t.ignored++
  }
  return testCount(t) ? t : null
}

export const testCount = (t: TestTally): number => t.passed + t.failed + t.ignored

/** Where a run's expected test total comes from: the newest passed run like it whose test stage passed. */
export function testsBaseline(runs: Run[], run: Run): Run | null {
  const like = runs.filter(
    r =>
      r.id !== run.id &&
      r.kind === run.kind &&
      r.projectId === run.projectId &&
      r.title === run.title &&
      r.state === 'succeeded' &&
      r.stages.some(s => s.name === TEST_STAGE && s.state === 'succeeded'),
  )
  return like.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

export const fmtCount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** The Tests heading: the tests run so far, against the usual total while the stage runs. */
export function testsHead(t: TestTally, total: number | null, isRunning: boolean): string {
  const n = fmtCount(testCount(t))
  return isRunning && total !== null ? `${n} of ~${fmtCount(total)} run` : `${n} run`
}

const newestFirst = (runs: Run[], projectId: string | null): Run[] =>
  (projectId ? runs.filter(r => r.projectId === projectId) : runs).slice().sort((a, b) => b.createdAt - a.createdAt)

/**
 * The run the tab shows: the newest one under way, else the newest queued one, else the newest,
 * so the last result stays in view. A run queued behind another never hides it.
 */
export function currentRun(runs: Run[], projectId: string | null): Run | null {
  const scope = newestFirst(runs, projectId)
  return scope.find(r => isActive(r.state) && r.state !== 'pending') ?? scope.find(r => r.state === 'pending') ?? scope[0] ?? null
}

/** How many runs wait queued behind the one shown; 0 when it is queued itself. */
export function queuedBehind(runs: Run[], projectId: string | null, shown: Run | null): number {
  if (!shown || shown.state === 'pending') return 0
  return newestFirst(runs, projectId).filter(r => r.state === 'pending' && r.id !== shown.id).length
}

export const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

const WORD: Record<string, string> = { succeeded: 'passed', pending: 'queued', quota_paused: 'quota paused' }
export const stateWord = (state: string): string => WORD[state] ?? (state || 'unknown')

const GLYPH: Record<string, string> = { succeeded: '✓', failed: '✗', pending: '○', quota_paused: '○', skipped: '–', cancelled: '⊘', superseded: '↷', uncertain: '?' }
export const glyph = (state: string, frame: number): string => (state === 'running' ? SPINNER.charAt(frame % SPINNER.length) : (GLYPH[state] ?? '?'))

// Theme keys, so the colours follow the person's theme.
const COLOR: Record<string, string> = { succeeded: 'success', failed: 'error', running: 'warning', quota_paused: 'warning', uncertain: 'warning' }
export const stateColor = (state: string): string | undefined => COLOR[state]

export function fmtDuration(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function fmtAgo(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

/** How long a stage ran, or has been running; null before it starts. */
export const stageDuration = (s: Stage, now: number): number | null => (s.startedAt === null ? null : (s.finishedAt ?? now) - s.startedAt)

const runStart = (run: Run): number => Math.min(run.createdAt || Infinity, ...run.stages.map(s => s.startedAt ?? Infinity))
const runEnd = (run: Run, now: number): number => (isActive(run.state) ? now : Math.max(0, ...run.stages.map(s => s.finishedAt ?? 0)) || run.updatedAt)

export const runDuration = (run: Run, now: number): number => runEnd(run, now) - runStart(run)

/** Where a stage's bar starts (`lead` cells in) and how long it is, on a track `width` cells wide. */
export function bar(s: Stage, run: Run, now: number, width: number): { lead: number; fill: number } {
  if (s.startedAt === null || width <= 0) return { lead: 0, fill: 0 }
  const start = runStart(run)
  const span = Math.max(1, runEnd(run, now) - start)
  const lead = Math.min(width - 1, Math.max(0, Math.floor(((s.startedAt - start) / span) * width)))
  const fill = Math.max(1, Math.round((((s.finishedAt ?? now) - s.startedAt) / span) * width))
  return { lead, fill: Math.min(fill, width - lead) }
}

/** Each stage's median length in this repo's passed runs of the same kind (gate runs: the same profile). */
export function usualDurations(runs: Run[], run: Run): Record<string, number> {
  const same = runs.filter(r => r.id !== run.id && r.projectId === run.projectId && r.kind === run.kind && (r.kind === 'ticket' || r.title === run.title) && r.state === 'succeeded')
  const lengths: Record<string, number[]> = {}
  for (const r of same)
    for (const s of r.stages)
      if (s.state === 'succeeded' && s.startedAt !== null && s.finishedAt !== null) (lengths[s.name] ??= []).push(s.finishedAt - s.startedAt)
  const usual: Record<string, number> = {}
  for (const [name, ms] of Object.entries(lengths)) {
    const sorted = ms.sort((a, b) => a - b)
    const mid = sorted.length >> 1
    usual[name] = sorted.length % 2 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
  }
  return usual
}

export type Segment = { kind: 'gap' | 'fill' | 'ghost'; n: number }

/** A running stage usually shorter than this is drawn at true scale, not given half the bar. */
export const TINY_MS = 60_000
const SWEEP = 3

const segments = (lead: number, ...rest: Segment[]): Segment[] => [{ kind: 'gap', n: lead }, ...rest.filter(s => s.n > 0)]

/** The stages that split the bar: running, and not usually tiny. */
const longRunning = (run: Run, usual: Record<string, number>): Stage[] =>
  isActive(run.state) ? run.stages.filter(s => s.state === 'running' && s.startedAt !== null && !((usual[s.name] ?? Infinity) < TINY_MS)) : []

/**
 * Each stage's cells on a `width`-cell timing track. While a long stage runs, the finished
 * stages share the left half at their true proportions and the running stage fills the right
 * half against its usual length (or a block sweeps when it has none); otherwise the whole run
 * is at true scale. Each change of running stage re-scales the finished ones together.
 */
export function timeline(run: Run, now: number, width: number, usual: Record<string, number>, frame: number): Segment[][] {
  if (!longRunning(run, usual).length)
    return run.stages.map(s => {
      const b = bar(s, run, now, width)
      return b.fill ? segments(b.lead, { kind: 'fill', n: b.fill }) : []
    })
  const half = Math.floor(width / 2)
  const left = width - half
  const start = runStart(run)
  const scale = Math.max(1, Math.max(0, ...run.stages.map(s => s.finishedAt ?? 0)) - start)
  return run.stages.map(s => {
    if (s.startedAt === null) return []
    if (s.finishedAt !== null) {
      const lead = Math.min(left - 1, Math.max(0, Math.floor(((s.startedAt - start) / scale) * left)))
      return segments(lead, { kind: 'fill', n: Math.min(left - lead, Math.max(1, Math.round(((s.finishedAt - s.startedAt) / scale) * left))) })
    }
    if (s.state !== 'running') return []
    const u = usual[s.name]
    if (u === undefined) {
      const pos = frame % (half - SWEEP + 1)
      return segments(left, { kind: 'ghost', n: pos }, { kind: 'fill', n: SWEEP }, { kind: 'ghost', n: half - pos - SWEEP })
    }
    const elapsed = now - s.startedAt
    const fill = elapsed >= u ? half : Math.max(1, Math.round((elapsed / u) * half))
    return segments(left, { kind: 'fill', n: fill }, { kind: 'ghost', n: half - fill })
  })
}

/** The timing heading: the long running stage against its usual length, else the run's total. */
export function timingHead(run: Run, now: number, usual: Record<string, number>): string {
  const s = longRunning(run, usual).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0]
  if (!s || s.startedAt === null) return fmtDuration(runDuration(run, now))
  const elapsed = now - s.startedAt
  const u = usual[s.name]
  if (u === undefined) return `${s.name} ${fmtDuration(elapsed)}`
  return `${s.name} ${fmtDuration(elapsed)} of ~${fmtDuration(u)}${elapsed > u ? ` (+${fmtDuration(elapsed - u)})` : ''}`
}

/** The spinner turns only while the shown run is active with a stage running. */
export const isMoving = (run: Run | null): boolean => !!run && isActive(run.state) && run.stages.some(s => s.state === 'running')

const INDENT = 2
const STATE_W = 11 // a glyph, a space and 'uncertain'
const EXIT_W = 4
const TIME_W = 6 // '11m23s'
const GLYPH_W = 1
const MIN_STAGE = 3
const MIN_TIMING = 8

const stageWidth = (stages: Stage[]): number => Math.max(5, ...stages.map(s => s.name.length))

/**
 * Column widths for the jobs table. As the pane narrows, the exit column goes (exit 0), then
 * the state word (state 1: the glyph alone), then stage names shorten; the time always stays.
 */
export function columns(cols: number, stages: Stage[]): { state: number; stage: number; exit: number; time: number } {
  const stage = stageWidth(stages)
  const row = (state: number, stage: number, exit: number) => INDENT + state + 1 + stage + 1 + (exit ? exit + 1 : 0) + TIME_W
  if (row(STATE_W, stage, EXIT_W) <= cols) return { state: STATE_W, stage, exit: EXIT_W, time: TIME_W }
  if (row(STATE_W, stage, 0) <= cols) return { state: STATE_W, stage, exit: 0, time: TIME_W }
  const room = cols - row(GLYPH_W, 0, 0)
  return { state: GLYPH_W, stage: Math.max(MIN_STAGE, Math.min(stage, room)), exit: 0, time: TIME_W }
}

/** The timing track: the panel width beside the stage names, the whole run spread across it; 0 when too narrow. */
export function timingTrack(cols: number, stages: Stage[]): number {
  const track = cols - stageWidth(stages) - 1
  return track >= MIN_TIMING ? track : 0
}
