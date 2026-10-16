/** One stage of a run, as `kintsugi --json run overview` lists it. Times are epoch ms. */
export type Stage = {
  name: string
  /** pending, running, succeeded, failed, skipped or uncertain */
  state: string
  exitCode: number | null
  startedAt: number | null
  finishedAt: number | null
}

/** A verification run: a ticket's candidate run or an operator gate run (`kintsugi verify`). */
export type Run = {
  /** The operation id. */
  id: string
  kind: 'ticket' | 'gate'
  projectId: string
  project: string
  /** `<ticket> verification` or `verify <profile>`, as the console names it. */
  title: string
  /** The branch a gate run verifies (refs/heads/ dropped); empty for a ticket run. */
  ref: string
  sha: string
  /** pending, running, quota_paused, succeeded, failed, cancelled, superseded or uncertain */
  state: string
  createdAt: number
  updatedAt: number
  detail: string
  stages: Stage[]
}

export type Project = { id: string; name: string }

export type Snapshot = {
  /** When the last refresh ended. */
  at: number
  /** When kintsugi last answered. */
  seenAt: number
  /** Whether this session's repo has been looked up yet. */
  isResolved: boolean
  /** This session's repo as a kintsugi project; null when it is not enrolled. */
  project: Project | null
  runs: Run[]
  error: string
}

/** Per-test results counted from a stage's log. */
export type TestTally = {
  passed: number
  failed: number
  ignored: number
  /** Failed tests in log order, as the log names them. */
  failedNames: string[]
}

/** The shown run's test count, and the total of the last passed run like it. */
export type TestsView = {
  /** The run counted; the pane shows the count only while this run is shown. */
  runId: string
  /** null: no log yet, kintsugi failed, the log was cut short, or it held no tests. */
  tally: TestTally | null
  /** The test stage had finished when counted, so its count is final. */
  isFinal: boolean
  /** The passed run the total came from; empty when there is none. */
  baseId: string
  total: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'kintsugi-runs': {
      snapshot: Snapshot
      frame: number
      tests: TestsView
    }
  }
}
