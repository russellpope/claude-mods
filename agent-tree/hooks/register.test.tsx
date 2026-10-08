import { describe, expect, mock, test } from 'claude-code/testing'

const agent = (pane: string, name: string, session: string) => ({
  pane_id: pane,
  name,
  agent: 'claude',
  agent_status: 'idle',
  cwd: '/w',
  workspace_id: pane.split(':')[0],
  terminal_id: `term-${pane}`,
  agent_session: { value: session },
})
const list = (...agents: ReturnType<typeof agent>[]) => JSON.stringify({ id: 'cli:agent:list', result: { type: 'agent_list', agents } })
const ROOT = agent('w9:p1', 'me', 'root-session')
const STARTED = JSON.stringify({ id: 'cli:agent:start', result: { type: 'agent_started', argv: ['claude'], agent: agent('wX:p2', 'demo-impl', '') } })
// An op hook (process.run, fs.*) answers { value }.
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const bash = (stdout: string) => async () => ({ result: { stdout, stderr: '', interrupted: false } })
const NOW = 1_791_486_939_969

describe('Bash spawn hook', () => {
  test('herdr agent start output writes one edge', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const writes: { path: string; text: string }[] = []
    on('fs.write', async (_$, e) => {
      writes.push({ path: e.path, text: e.text })
      return { value: undefined }
    })
    on('process.run', async () => ok(list(ROOT)))
    on('tool.call', { tool: 'Bash' }, bash(`${STARTED}\n`))

    await $.tool.call({ tool: 'Bash', command: 'herdr agent start demo-impl --kind claude --pane wX:p2' })

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(`/home/me/.local/state/agent-tree/edges/${NOW}-wX_p2.json`)
    expect(JSON.parse(writes[0]?.text ?? '')).toMatchObject({ v: 1, parent: 'w9:p1', parentSession: 'root-session', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod' })
  })

  test('swallowed output: the before/after list diff finds the new pane', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    let calls = 0
    on('process.run', async () => ok(calls++ === 0 ? list(ROOT) : list(ROOT, agent('wX:p3', 'quiet-fixer', 's3'))))
    on('tool.call', { tool: 'Bash' }, bash(''))

    await $.tool.call({ tool: 'Bash', command: 'OUT=$(herdr agent start quiet-fixer --kind claude --pane wX:p3)' })

    expect(writes.map(t => JSON.parse(t).child)).toEqual(['wX:p3'])
  })

  test('negative control: text that only mentions herdr agent start writes nothing', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('process.run', async () => ok(list(ROOT, agent('wX:p4', 'x', 's4'))))
    // Even an echoed agent_started document must not count.
    on('tool.call', { tool: 'Bash' }, bash(STARTED))

    await $.tool.call({ tool: 'Bash', command: `echo 'herdr agent start demo' && echo '${STARTED}'` })

    expect(writes).toEqual([])
  })

  test('outside herdr nothing is recorded', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    mock.store(on)
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Bash' }, bash(STARTED))

    await $.tool.call({ tool: 'Bash', command: 'herdr agent start demo --kind claude --pane wX:p2' })

    expect(writes).toEqual([])
  })
})
