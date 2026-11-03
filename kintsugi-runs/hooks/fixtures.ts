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

/** A gate run queued behind the running one: newer, no stages yet (shape from a real overview, 2026-10-12). */
export const QUEUED_GATE = {
  operation_id: 'bdfa2828-d68e-4ff6-a40e-9d5b0e12737b',
  project_id: KINTSUGI_ID,
  project: 'kintsugi',
  ref_name: 'refs/heads/main',
  commit: 'f39b29456ca356c253068a93f4aa28577fcfcea3',
  short_commit: 'f39b294',
  profile: 'full',
  state: 'pending',
  version: '1',
  created_at_ms: 1791608700000,
  updated_at_ms: 1791608700000,
  queue_reason: 'waiting: run a8c231fe-c2fb-4ee8-818b-18d379f673cd active',
  detail: null,
  stages: [],
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

/**
 * `run logs --stage test` of the running gate run, mid-stage: the line shapes of a real log
 * (2026-10-12): cargo's ok, ignored-with-a-reason and FAILED lines, a long-running notice, the
 * failures block and summary, and a unittest lane's line. Five tests reported.
 */
export const RUNNING_TEST_LOG = `RUN LOGS operation=a8c231fe-c2fb-4ee8-818b-18d379f673cd stage=test
Availability: available bytes=1693
cargo build --locked --workspace --bin kintsugi

running 5 tests
test agent_observer::tests::a_bind_lock_identity_error_names_the_lock_file ... ok
test attempt_cleanup::tests::deep_cleanup_child ... ignored, run by cleanup_refuses_three_thousand_levels_on_two_megabyte_stack
test dispatch::personal_tests::native_herdr_tests::i277_native_prompt_screens_refuse_before_paste has been running for over 60 seconds
test inbox::production_review_tests::i261_socket_local_settings_end_the_review ... FAILED
test vault::tests::denied_policy_disables_security_user_interaction ... ok

failures:

---- inbox::production_review_tests::i261_socket_local_settings_end_the_review stdout ----

thread 'inbox::production_review_tests::i261_socket_local_settings_end_the_review' (52747977) panicked at crates/kintsugi/src/inbox/production_review_tests.rs:88:5:
socket path too long for sun_path

failures:
    inbox::production_review_tests::i261_socket_local_settings_end_the_review

test result: FAILED. 2 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 2758.67s

test_command_line_zero_is_overridden (__main__.VerifySkipGateTest.test_command_line_zero_is_overridden) ... ok
`

/** `run logs --stage test` of the passed gate run: six tests reported, the expected total. */
export const PASSED_TEST_LOG = `RUN LOGS operation=d109803a-e563-4319-94e2-2a9ded3becba stage=test
Availability: available bytes=812

running 6 tests
test agent_observer::tests::a_bind_lock_identity_error_names_the_lock_file ... ok
test attempt_cleanup::tests::deep_cleanup_child ... ignored, run by cleanup_refuses_three_thousand_levels_on_two_megabyte_stack
test dispatch::personal_tests::native_herdr_tests::i277_native_prompt_screens_refuse_before_paste ... ok
test inbox::production_review_tests::i261_socket_local_settings_end_the_review ... ok
test vault::tests::denied_policy_disables_security_user_interaction ... ok

test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 2750.05s

test_command_line_zero_is_overridden (__main__.VerifySkipGateTest.test_command_line_zero_is_overridden) ... ok
`

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
