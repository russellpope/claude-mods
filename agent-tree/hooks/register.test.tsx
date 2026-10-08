import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Snapshot } from '../types'

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

  test('the hook never blocks the Bash call, even when the environment is unreadable', async ($, on) => {
    on('env.get', async () => ({ deny: 'environment unavailable' }))
    on('tool.call', { tool: 'Bash' }, bash('real output'))

    const res = await $.tool.call({ tool: 'Bash', command: 'herdr agent start demo --kind claude --pane wX:p2' })

    // The engine skips a hook that throws and runs the call: the worker's output still arrives.
    expect((res.result as { stdout?: string } | undefined)?.stdout).toBe('real output')
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

// A test body's $ is the kit's engine, not the plugin's, and has no state noun: refresh is
// driven the way a person drives it, by /agent-tree, which opens the pane and awaits it.
// Registers the pane's test hooks once (the kit wants every test hook before the first $ call);
// open() then runs /agent-tree and returns the snapshot the first refresh wrote.
const watchPane = (on: Parameters<TestBody>[1]) => {
  let last: Snapshot | undefined
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async () => ({ value: undefined }))
  // Test hooks sit beneath the plugin: this one sees each snapshot write, then lets the kit store it.
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'agent-tree' && e.key === 'snapshot') last = e.value as Snapshot
    return next(e)
  })
  return {
    open: async ($: Parameters<TestBody>[0]): Promise<Snapshot> => {
      last = undefined
      await $.command.run({ command: 'agent-tree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
      if (!last) throw new Error('no snapshot was written')
      return last
    },
  }
}
const openPane = ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]): Promise<Snapshot> => watchPane(on).open($)
const failed = { value: { exitCode: 1, stdout: '', stderr: 'no socket', isStdoutTruncated: false, isStderrTruncated: false } }

describe('refresh (through /agent-tree)', () => {
  test('herdr not answering: the snapshot says so and nothing throws', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('process.run', async () => failed)

    expect((await openPane($, on)).error).toBe('herdr is not answering.')
  })

  test('outside herdr: no tree, a plain message', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))

    expect((await openPane($, on)).error).toBe('Not in a herdr pane: no agent tree here.')
  })

  test('a recorded child shows up in the tree with its status', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p2.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: edgeText }))
    on('fs.exists', async () => ({ value: false }))
    on('process.run', async (_$, e) => (e.argv[0] === 'herdr' ? ok(list(ROOT, { ...agent('wX:p2', 'demo-impl', 's2'), agent: 'codex', agent_status: 'working' })) : failed))

    const snap = await openPane($, on)

    expect(snap.error).toBe('')
    expect(snap.nodes.map(n => [n.pane, n.name, n.status, n.role])).toEqual([['wX:p2', 'demo-impl', 'working', 'implementer']])
  })
})

describe('pane render', () => {
  const PANE_PROPS = (bodyColumns: number) => ({ title: 'Agent tree', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} })

  test('an empty tree draws on every surface, full and compact', async $ => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'agent-tree', surface, component: 'Pane', requestId: 'agent-tree', props: PANE_PROPS(100) })
      expect(await ui.find({ type: 'Text', text: /No workers spawned from this session yet/ })).toBeDefined()
      // Desktop draws the hero crab as an SVG; the terminal draws it in half blocks.
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(surface === 'desktop' ? 1 : 0)
      await ui.unmount()
      const narrow = await $.ui.mount({ plugin: 'agent-tree', surface, component: 'Pane', requestId: 'agent-tree', props: PANE_PROPS(40) })
      expect(await narrow.find({ type: 'Text', text: /🦀 asleep/ })).toBeDefined()
      await narrow.unmount()
    }
  })
})

describe('ledger reads', () => {
  test('an edge file caught mid-write is read again on the next refresh', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p5', name: 'late-impl', via: 'claude-mod', at: NOW - 1000 })
    let reads = 0
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p5.json`, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: reads++ === 0 ? '' : edgeText }))
    on('fs.exists', async () => ({ value: false }))
    on('process.run', async (_$, e) => (e.argv[0] === 'herdr' ? ok(list(ROOT, agent('wX:p5', 'late-impl', 's5'))) : failed))

    const pane = watchPane(on)
    expect((await pane.open($)).nodes).toEqual([])
    expect((await pane.open($)).nodes.map(n => n.name)).toEqual(['late-impl'])
  })
})

// The test environment has setTimeout at run time; its type library (no DOM) does not declare it.
declare const setTimeout: (fn: () => void, ms: number) => unknown

describe('transcript reads', () => {
  const usageLine = (id: string, input: number) =>
    JSON.stringify({ type: 'assistant', isSidechain: false, message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: input, output_tokens: 0 } } })
  const EDGE = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })

  // Answers herdr with one Claude worker and runs `tail -c +N | head -c M` over an in-memory transcript.
  // While `gate.isArmed`, the next transcript read waits until another read starts (or 300 ms pass), so two refreshes overlap.
  const worker = (on: Parameters<TestBody>[1], transcript: { text: string }, gate = { isArmed: false }) => {
    let held: (() => void) | null = null
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p2.json`, kind: 'file' as const, size: EDGE.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: EDGE }))
    on('fs.exists', async () => ({ value: true }))
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'herdr') return ok(list(ROOT, agent('wX:p2', 'demo-impl', 's2')))
      if (e.argv[0] !== '/bin/sh') return failed
      if (held) {
        held()
        held = null
      } else if (gate.isArmed) {
        gate.isArmed = false
        await new Promise<void>(r => {
          held = r
          setTimeout(r, 300)
        })
      }
      const bytes = new TextEncoder().encode(transcript.text)
      const start = Number(e.argv[4]) - 1
      return ok(new TextDecoder().decode(bytes.slice(start, start + Number(e.argv[6]))))
    })
  }

  test('a line longer than one read is skipped, and the lines after it still count', async ($, on) => {
    const transcript = { text: `${usageLine('m1', 10)}\n{"type":"user","note":"${'x'.repeat(2_500_000)}"}\n${usageLine('m2', 20)}\n` }
    worker(on, transcript)

    const snap = await watchPane(on).open($)

    expect(snap.nodes[0]?.usage?.tokens).toBe(30)
  })

  test('two refreshes at once do not skip transcript bytes', async ($, on) => {
    const transcript = { text: `${usageLine('m1', 1000)}\n` }
    const gate = { isArmed: false }
    worker(on, transcript, gate)
    const pane = watchPane(on)
    await pane.open($)

    transcript.text += `${usageLine('m2', 200)}\n`
    gate.isArmed = true
    await Promise.all([pane.open($), pane.open($)])
    transcript.text += `${usageLine('m3-a-longer-id', 30)}\n`
    const snap = await pane.open($)

    expect(snap.nodes[0]?.usage?.tokens).toBe(1230)
  })
})

describe('idle cost', () => {
  test('a session that never opened the pane or spawned a worker polls nothing', async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    let panesCalls = 0
    on('ui.panes', async () => {
      panesCalls++
      return { value: [] }
    })
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async (_$, e) => ({ value: { command: e.name } }))

    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    panesCalls = 0 // session.start looks once, for a pane kept across a reload
    await clock.advance(10_000)

    expect(panesCalls).toBe(0)
  })
})
