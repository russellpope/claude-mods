// Test data: two operator runs cut from a real `kintsugi --json run overview` (2026-10-09),
// a ticket run in the contract's shape, and another project's run.

export const KINTSUGI_ID = '8e8b4d9a-c3fd-49f8-a02f-72770b822899'
export const HANSA_ID = '73b93398-04c6-49e0-b0b2-7b587a66084f'

/** A moment 62 minutes into the running gate run. */
export const NOW = 1_791_608_764_000

export const RUNNING_GATE = {
  operation_id: 'a8c231fe-c2fb-4ee8-818b-18d379f673cd',
  project_id: KINTSUGI_ID,
  project: 'kintsugi',
  ref_name: 'refs/heads/main',
  commit: 'eb598c9c0516981aab1ee3654445024c98ce5e44',
  short_commit: 'eb598c9',
  profile: 'full',
  state: 'running',
  created_at_ms: 1791605020295,
  updated_at_ms: 1791605081976,
  queue_reason: null,
  detail: null,
  stages: [
    { name: 'fmt', needs: [], state: 'succeeded', started_at_ms: 1791605021291, finished_at_ms: 1791605024241, exit_code: 0 },
    { name: 'check', needs: ['fmt'], state: 'succeeded', started_at_ms: 1791605024314, finished_at_ms: 1791605062454, exit_code: 0 },
    { name: 'lint', needs: ['check'], state: 'succeeded', started_at_ms: 1791605062466, finished_at_ms: 1791605081958, exit_code: 0 },
    { name: 'test', needs: ['lint'], state: 'running', started_at_ms: 1791605081976, finished_at_ms: null, exit_code: null },
    { name: 'skip-gate', needs: ['test'], state: 'pending', started_at_ms: null, finished_at_ms: null, exit_code: null },
  ],
}

export const PASSED_GATE = {
  operation_id: 'd109803a-e563-4319-94e2-2a9ded3becba',
  project_id: KINTSUGI_ID,
  project: 'kintsugi',
  ref_name: 'refs/heads/main',
  commit: '778107f78a7ca876161c0cc04a23a00920d00e0d',
  short_commit: '778107f',
  profile: 'full',
  state: 'succeeded',
  created_at_ms: 1791593687860,
  updated_at_ms: 1791599100010,
  queue_reason: null,
  detail: null,
  stages: [
    { name: 'fmt', needs: [], state: 'succeeded', started_at_ms: 1791593688254, finished_at_ms: 1791593690019, exit_code: 0 },
    { name: 'check', needs: ['fmt'], state: 'succeeded', started_at_ms: 1791593690031, finished_at_ms: 1791593709629, exit_code: 0 },
    { name: 'lint', needs: ['check'], state: 'succeeded', started_at_ms: 1791593709640, finished_at_ms: 1791593729329, exit_code: 0 },
    { name: 'test', needs: ['lint'], state: 'succeeded', started_at_ms: 1791593729342, finished_at_ms: 1791599097922, exit_code: 0 },
    { name: 'skip-gate', needs: ['test'], state: 'succeeded', started_at_ms: 1791599097949, finished_at_ms: 1791599099998, exit_code: 0 },
  ],
}

/** A ticket's candidate run, newer than everything else but finished and failed. */
export const FAILED_TICKET = {
  run_id: 'run-1',
  operation_id: 'op-ticket-i371',
  candidate_id: 'cand-1',
  project_id: KINTSUGI_ID,
  project: 'kintsugi',
  ticket: 'I371',
  commit: '1234567890abcdef1234567890abcdef12345678',
  state: 'failed',
  version: '3',
  sequence: 1,
  current: true,
  created_at_ms: 1791608000000,
  updated_at_ms: 1791608500000,
  policy_digest: 'sha256:x',
  queue_reason: null,
  detail: 'check failed',
  stages: [
    { name: 'check', needs: [], state: 'failed', blocked_by: [], started_at_ms: 1791608000100, finished_at_ms: 1791608400000, exit_code: 101, timed_out: false, findings: 0 },
    { name: 'test', needs: ['check'], state: 'skipped', blocked_by: ['check'], started_at_ms: null, finished_at_ms: null, exit_code: null, timed_out: false, findings: 0 },
  ],
}

export const HANSA_GATE = {
  ...PASSED_GATE,
  operation_id: 'op-hansa',
  project_id: HANSA_ID,
  project: 'hansa',
  state: 'running',
  created_at_ms: 1791608600000,
  short_commit: 'aaaaaaa',
}

export const overview = (items: object[], operatorRuns: object[]) =>
  JSON.stringify({
    api_version: 1,
    request_id: 'r',
    outcome: 'ok',
    result: { kind: 'run.overview', value: { items, omitted: 0, observation: { observed_at_ms: NOW, freshness: 'current' }, operator_runs: operatorRuns } },
    warnings: [],
  })

export const PROJECTS = JSON.stringify({
  api_version: 1,
  request_id: 'r',
  outcome: 'ok',
  result: {
    kind: 'project.list',
    value: {
      items: [
        { project_id: HANSA_ID, name: 'hansa', checkout: '/Users/me/Projects/github.com/hansa' },
        { project_id: KINTSUGI_ID, name: 'kintsugi', checkout: '/Users/me/Projects/github.com/kintsugi' },
      ],
    },
  },
  warnings: [],
})

/** kintsugi's error answer, as it printed it against a missing state dir (exit 2). */
export const UNAVAILABLE = JSON.stringify({
  api_version: 1,
  request_id: '00000000-0000-0000-0000-000000000000',
  outcome: 'error',
  error: { code: 'transport_unavailable', message: 'Local state is unavailable', retryable: false, details: {} },
  warnings: [],
})
