import type { Project, Run, Stage } from '../types'

// kintsugi refuses a call without --state or --config, so the mod names the config the way
// kintsugi's own help does: KINTSUGI_CONFIG, else ~/.config/kintsugi/config.toml.
export const configPath = (env: string | undefined, home: string): string => env || `${home}/.config/kintsugi/config.toml`
export const overviewArgv = (config: string): string[] => ['kintsugi', '--config', config, '--json', 'run', 'overview']
export const projectsArgv = (config: string): string[] => ['kintsugi', '--config', config, '--json', 'project', 'list']
export const commonDirArgv = (cwd: string): string[] => ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']

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

/** The run the tab shows: the newest active one, else the newest, so the last result stays in view. */
export function currentRun(runs: Run[], projectId: string | null): Run | null {
  const scope = (projectId ? runs.filter(r => r.projectId === projectId) : runs).slice().sort((a, b) => b.createdAt - a.createdAt)
  return scope.find(r => isActive(r.state)) ?? scope[0] ?? null
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

/** The spinner turns only while the shown run is active with a stage running. */
export const isMoving = (run: Run | null): boolean => !!run && isActive(run.state) && run.stages.some(s => s.state === 'running')

const INDENT = 2
const STATE_W = 11 // a glyph, a space and 'uncertain'
const EXIT_W = 4
const TIME_W = 6 // '11m23s'
const MIN_TIMING = 8

const stageWidth = (stages: Stage[]): number => Math.max(5, ...stages.map(s => s.name.length))

/** Column widths for the jobs table; exit is 0, dropped, when the row would not fit. */
export function columns(cols: number, stages: Stage[]): { state: number; stage: number; exit: number; time: number } {
  const stage = stageWidth(stages)
  const fixed = INDENT + STATE_W + 1 + stage + 1 + EXIT_W + 1 + TIME_W
  return { state: STATE_W, stage, exit: fixed > cols ? 0 : EXIT_W, time: TIME_W }
}

/** The timing track: the panel width beside the stage names, the whole run spread across it; 0 when too narrow. */
export function timingTrack(cols: number, stages: Stage[]): number {
  const track = cols - stageWidth(stages) - 1
  return track >= MIN_TIMING ? track : 0
}
