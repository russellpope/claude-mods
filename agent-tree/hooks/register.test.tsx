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
// `statuses` collects each status line the mod sets.
const watchPane = (on: Parameters<TestBody>[1], statuses: (string | undefined)[] = []) => {
  let last: Snapshot | undefined
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
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

  test('outside herdr and Rex: no tree, a plain message', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))

    expect((await openPane($, on)).error).toBe('Not in a herdr or Rex pane: no agent tree here.')
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

describe('row press', () => {
  test("pressing a row's name focuses that agent's herdr pane", async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p2.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: edgeText }))
    on('fs.exists', async () => ({ value: false }))
    const focused: string[] = []
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'herdr' && e.argv[2] === 'focus') {
        focused.push(e.argv[3] ?? '')
        return ok('{}')
      }
      return e.argv[0] === 'herdr' ? ok(list(ROOT, agent('wX:p2', 'demo-impl', 's2'))) : failed
    })

    const snap = await watchPane(on).open($)
    const node = snap.nodes[0]
    expect(node?.pane).toBe('wX:p2')
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    await ui.press({ key: `f-wX:p2-${node?.startedAt}` })
    await ui.unmount()

    expect(focused).toEqual(['wX:p2'])
  })
})

describe('row press, compact', () => {
  test("in compact view a row's name is still pressable and focuses its pane", async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p2.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: edgeText }))
    on('fs.exists', async () => ({ value: false }))
    const focused: string[] = []
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'herdr' && e.argv[2] === 'focus') {
        focused.push(e.argv[3] ?? '')
        return ok('{}')
      }
      return e.argv[0] === 'herdr' ? ok(list(ROOT, agent('wX:p2', 'demo-impl', 's2'))) : failed
    })

    const snap = await watchPane(on).open($)
    // 40 columns is under the 60-column threshold, so the pane draws compact.
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: true, bodyColumns: 40, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    expect(await ui.find({ type: 'Text', text: /🦀/ })).toBeDefined()
    await ui.press({ key: `f-wX:p2-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()

    expect(focused).toEqual(['wX:p2'])
  })
})

describe('row press failure', () => {
  test('a focus herdr refuses shows a toast with its reason', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p2.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: edgeText }))
    on('fs.exists', async () => ({ value: false }))
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'herdr' && e.argv[2] === 'focus') return { value: { exitCode: 1, stdout: '', stderr: 'agent target wX:p2 not found', isStdoutTruncated: false, isStderrTruncated: false } }
      return e.argv[0] === 'herdr' ? ok(list(ROOT, agent('wX:p2', 'demo-impl', 's2'))) : failed
    })
    const toasts: string[] = []
    on('ui.toast', async (_$, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    const snap = await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    await ui.press({ key: `f-wX:p2-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()

    expect(toasts).toEqual(['agent-tree: could not focus wX:p2: agent target wX:p2 not found'])
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

  // The pane's look, drawn from a worker at 72% of its context window (yellow on the statusline's scale).
  const PROPS = (bodyColumns: number) => ({ title: 'Agent tree', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} })

  test('full view: the context meter is the statusline dots, coloured by its thresholds, then the percent', async ($, on) => {
    worker(on, { text: `${usageLine('m1', 720_000)}\n` })
    await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS(120) })

    const filled = await ui.find({ type: 'Text', text: /^●+$/ })
    expect([filled?.text, filled?.props.color]).toEqual(['●●●●●●●', '#E6C800'])
    expect((await ui.find({ type: 'Text', text: /^○+$/ }))?.text).toBe('○○○')
    expect(await ui.find({ type: 'Text', text: /^72%$/ })).toBeDefined()
    await ui.unmount()
  })

  test('compact view: the percent alone, in the meter colour', async ($, on) => {
    worker(on, { text: `${usageLine('m1', 720_000)}\n` })
    await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS(40) })

    expect((await ui.find({ type: 'Text', text: /^72%$/ }))?.props.color).toBe('#E6C800')
    expect(await ui.find({ type: 'Text', text: /●/ })).toBeUndefined()
    await ui.unmount()
  })

  test('summary: the mood word and live counts, then cost and labelled elapsed time, then the tokens and their split', async ($, on) => {
    const cached = JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 20_000, cache_read_input_tokens: 700_000, output_tokens: 1_500 } },
    })
    worker(on, { text: `${cached}\n` })
    await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS(120) })

    expect(await ui.find({ type: 'Text', text: /^asleep · 1 idle$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^≈\$[\d.]+ · [\d:]+ elapsed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^722k tok · 97% cache reads · 2k output$/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('codex rollouts', () => {
  const EDGE = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p3', name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
  const PATH = '/home/me/.codex-alt/sessions/2026/10/17/rollout-2026-10-17T00-09-55-01a148b2-1db3.jsonl'
  const ROLLOUT = [
    JSON.stringify({ type: 'session_meta', payload: { id: '01a148b2-1db3' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 2_994_739, cached_input_tokens: 2_900_864, output_tokens: 11_410, total_tokens: 3_006_149 },
          last_token_usage: { total_tokens: 100_705 },
          model_context_window: 828_400,
        },
      },
    }),
    '',
  ].join('\n')

  // Answers herdr with one codex worker, the rollout search with PATH, and `tail -c +N | head -c M` over ROLLOUT at PATH.
  const codexWorker = (on: Parameters<TestBody>[1], session: string, searches: string[][]) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p3.json`, kind: 'file' as const, size: EDGE.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: EDGE }))
    on('fs.exists', async () => ({ value: false }))
    on('process.run', async (_$, e) => {
      if (e.argv[0] === 'herdr') return ok(list(ROOT, { ...agent('wX:p3', 'demo-impl', session), agent: 'codex', agent_status: 'working' }))
      if (e.argv[0] !== '/bin/sh') return failed
      if (e.argv[2]?.includes('find')) {
        searches.push(e.argv.slice(3))
        return ok(`${PATH}\n`)
      }
      if (e.argv[5] !== PATH) return failed
      const bytes = new TextEncoder().encode(ROLLOUT)
      const start = Number(e.argv[4]) - 1
      return ok(new TextDecoder().decode(bytes.slice(start, start + Number(e.argv[6]))))
    })
  }

  test('a codex worker gets model, effort, context against its own window, and tokens from its rollout; no cost', async ($, on) => {
    const searches: string[][] = []
    codexWorker(on, '01a148b2-1db3', searches)

    const snap = await watchPane(on).open($)

    expect(searches).toEqual([['sh', '/home/me', '01a148b2-1db3']])
    expect(snap.nodes[0]?.usage).toEqual({
      model: 'gpt-6.1-sol',
      effort: 'high',
      contextTokens: 88_705,
      window: 816_400,
      tokens: 3_006_149,
      cachedTokens: 2_900_864,
      outputTokens: 11_410,
      costUsd: null,
    })
  })

  test("the codex row: model and effort, meter and codex's own percent, a blank cost; the header's estimate says Claude only", async ($, on) => {
    codexWorker(on, '01a148b2-1db3', [])
    await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })

    expect(await ui.find({ type: 'Text', text: /^gpt-6\.1-sol·high$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^11%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^≈\$0\.00 Claude only · [\d:]+ elapsed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^≈\$[\d.]+$/ })).toBeUndefined() // no row cost
    await ui.unmount()
  })

  test('a session id that is not a plain id is never searched for', async ($, on) => {
    const searches: string[][] = []
    codexWorker(on, '*', searches)

    const snap = await watchPane(on).open($)

    expect(searches).toEqual([])
    expect(snap.nodes[0]?.usage).toBeNull()
  })
})

describe('pane chrome', () => {
  test('header: the current view at full strength, the others dim, no brackets', async $ => {
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    const tree = await ui.find({ type: 'Button', key: 'm-tree' })
    const all = await ui.find({ type: 'Button', key: 'm-all' })
    expect([tree?.props.label, tree?.props.dimColor ?? false]).toEqual(['Tree', false])
    expect([all?.props.label, all?.props.dimColor]).toEqual(['All', true])
    await ui.unmount()
  })

  test('a finished row recorded after its pane closed shows — for its time', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p7', name: 'old-fixer', via: 'backfill', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p7.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async () => ({ value: edgeText }))
    on('fs.exists', async () => ({ value: false }))
    on('process.run', async (_$, e) => (e.argv[0] === 'herdr' ? ok(list(ROOT)) : failed))

    await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    await ui.press({ key: 's-fin' })
    expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^0:00$/ })).toBeUndefined()
    await ui.unmount()
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

describe('dings', () => {
  // This session (w9:p1) spawned lead wL:p1, which spawned workers wL:p2 and wL:p3. wB:p1 is a session nobody spawned.
  const EDGES = [
    { v: 1, parent: 'w9:p1', parentSession: '', child: 'wL:p1', name: 'lead-l', via: 'claude-mod', at: NOW - 5000 },
    { v: 1, parent: 'wL:p1', parentSession: '', child: 'wL:p2', name: 'l-impl', via: 'claude-mod', at: NOW - 4000 },
    { v: 1, parent: 'wL:p1', parentSession: '', child: 'wL:p3', name: 'l-review', via: 'claude-mod', at: NOW - 3000 },
  ]
  const fileOf = (e: (typeof EDGES)[number]) => `${e.at}-${e.child.replace(':', '_')}.json`
  const ledger = (on: Parameters<TestBody>[1]) => {
    on('fs.list', async () => ({ value: EDGES.map(e => ({ name: fileOf(e), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
    on('fs.read', async (_$, e) => ({ value: JSON.stringify(EDGES.find(x => e.path.endsWith(fileOf(x)))) }))
    on('fs.exists', async () => ({ value: false }))
  }
  const is = (a: ReturnType<typeof agent>, status: string) => ({ ...a, agent_status: status })
  const LEAD = agent('wL:p1', 'lead-l', 'sL')
  const IMPL = agent('wL:p2', 'l-impl', 'sI')
  const REVIEW = agent('wL:p3', 'l-review', 'sR')
  // herdr has no name for it: its row takes its tab's label.
  const OTHER = { ...agent('wB:p1', '', 'sB'), tab_id: 'w9:t19' }
  const TABS = JSON.stringify({ id: 'cli:tab:list', result: { tabs: [{ tab_id: 'w9:t19', label: 'mods' }] } })
  const PROPS = { title: 'Agent tree', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

  // Two polls through /agent-tree. In between, the lead's turn ends in the tab you are on (no ding), its implementer
  // finishes (dim), its reviewer asks, the unnamed session in tab "mods" finishes, and this session's own turn ends
  // (you are reading its pane: no ding). Then the pane is drawn on the terminal.
  const T = NOW + 2000
  const twoPolls = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    let now = NOW
    on('clock.now', async () => ({ value: now }))
    ledger(on)
    let agents = [is(ROOT, 'working'), is(LEAD, 'working'), is(IMPL, 'working'), is(REVIEW, 'working'), is(OTHER, 'working')]
    const focused: string[] = []
    on('process.run', async (_$, e) => {
      if (e.argv[0] !== 'herdr') return failed
      if (e.argv[2] === 'focus') {
        focused.push(e.argv[3] ?? '')
        return ok('{}')
      }
      if (e.argv[1] === 'tab') return ok(TABS)
      return ok(list(...agents))
    })
    const statuses: (string | undefined)[] = []
    const pane = watchPane(on, statuses)
    await pane.open($)
    now = T
    agents = [is(ROOT, 'done'), is(LEAD, 'idle'), is(IMPL, 'done'), is(REVIEW, 'blocked'), is(OTHER, 'done')]
    await pane.open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS })
    const text = async (key: string) => (await ui.find({ type: 'Box', key }))?.text
    const label = async (key: string) => (await ui.find({ type: 'Button', key }))?.props.label
    return { ui, text, label, focused, statuses }
  }

  test('only the dings that need you are listed, each with its ✓, a ! on its tree row and a count on the status line; the dim one waits in Acknowledged, collapsed', async ($, on) => {
    const { ui, text, label, statuses } = await twoPolls($, on)

    expect(statuses.at(-1)).toBe('tree 0● 1! · 2 need you')
    expect(await label('s-dings')).toBe('▾ Dings · 2 need you')
    expect(await label('ack-all')).toBe('ack all')
    expect(await text(`d-wB:p1-${T}`)).toMatch(/^!\s*0s\s*mods\s*finished/)
    expect(await text(`d-wL:p3-${T}`)).toMatch(/^!\s*0s\s*l-review\s*asking/)
    expect(await label(`ack-wL:p3-${T}`)).toBe('✓')
    expect(await text(`d-wL:p2-${T}`)).toBeUndefined()
    // In the tree, the reviewer that asked carries the mark; its sibling does not.
    expect(await text(`m-wL:p3-${NOW - 3000}`)).toBe('!')
    expect((await text(`m-wL:p2-${NOW - 4000}`)) ?? '').toBe('')
    expect(await label('s-acked')).toBe('▸ Acknowledged · 1')
    expect(await text(`k-wL:p2-${T}`)).toBeUndefined()

    await ui.press({ key: 's-acked' })

    expect(await label('s-acked')).toBe('▾ Acknowledged · 1')
    expect(await text(`k-wL:p2-${T}`)).toMatch(/^\s*0s\s*l-impl\s*finished\s*lead-l still running$/)
    // Acknowledged, header and rows, sits indented under Dings.
    const acked = await ui.find({ type: 'Box', key: 'acked' })
    expect(acked?.props.paddingLeft).toBe(2)
    expect(acked?.text).toMatch(/Acknowledged · 1.*l-impl/)
    expect(await label(`ack-wL:p2-${T}`)).toBeUndefined()
    await ui.unmount()
    const desktop = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', component: 'Pane', requestId: 'agent-tree', props: PROPS })
    expect((await desktop.find({ type: 'Button', key: 's-dings' }))?.props.label).toBe('▾ Dings · 2 need you')
    expect(await desktop.find({ type: 'Button', key: `ack-wL:p3-${T}` })).toBeDefined()
    await desktop.unmount()
  })

  test("✓ acks a ding where you are; pressing a ding's name takes you to its pane and acks it", async ($, on) => {
    const { ui, text, label, focused, statuses } = await twoPolls($, on)

    await ui.press({ key: `ack-wB:p1-${T}` })

    expect(focused).toEqual([])
    expect(statuses.at(-1)).toBe('tree 0● 1! · 1 needs you')
    expect(await label('s-dings')).toBe('▾ Dings · 1 needs you')
    expect(await text(`d-wB:p1-${T}`)).toBeUndefined()
    expect(await label('s-acked')).toBe('▸ Acknowledged · 2')

    await ui.press({ key: `fd-wL:p3-${T}` })

    expect(focused).toEqual(['wL:p3'])
    expect(statuses.at(-1)).toBe('tree 0● 1!')
    expect(await label('s-dings')).toBe('▾ Dings · none need you')
    expect(await label('ack-all')).toBeUndefined()
    expect(await label('s-acked')).toBe('▸ Acknowledged · 3')
    await ui.unmount()
  })

  test('ack all moves every open ding to Acknowledged and moves you nowhere', async ($, on) => {
    const { ui, label, focused, statuses } = await twoPolls($, on)

    await ui.press({ key: 'ack-all' })

    expect(focused).toEqual([])
    expect(statuses.at(-1)).toBe('tree 0● 1!')
    expect(await label('s-dings')).toBe('▾ Dings · none need you')
    expect(await label('s-acked')).toBe('▸ Acknowledged · 3')
    await ui.unmount()
  })

  test('on the terminal a name fills its cell, at least 12 wide, so a short one is not a one-character target; the desktop draws names as they are', async ($, on) => {
    const { ui, label } = await twoPolls($, on)

    expect(await label(`fd-wB:p1-${T}`)).toBe('mods        ')
    expect(await label(`f-wL:p1-${NOW - 5000}`)).toBe('lead-l      ')
    // A worker's cell is the column less its tree prefix ('├ ').
    expect(await label(`f-wL:p3-${NOW - 3000}`)).toBe('l-review  ')
    await ui.press({ key: 'm-all' })
    expect(await label('fa-wB:p1')).toBe('wB:p1       ')
    await ui.unmount()
    const desktop = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', component: 'Pane', requestId: 'agent-tree', props: PROPS })
    expect((await desktop.find({ type: 'Button', key: `fd-wB:p1-${T}` }))?.props.label).toBe('mods')
    await desktop.unmount()
  })

  test('after herdr stops answering, the first good list dings nothing: the turns in between were never seen', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    let now = NOW
    on('clock.now', async () => ({ value: now }))
    ledger(on)
    let reply = ok(list(ROOT, is(OTHER, 'working')))
    on('process.run', async (_$, e) => (e.argv[0] === 'herdr' ? reply : failed))
    const pane = watchPane(on)

    await pane.open($)
    now = NOW + 2000
    reply = failed
    await pane.open($)
    now = NOW + 4000
    reply = ok(list(ROOT, is(OTHER, 'done')))
    await pane.open($)

    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS })
    expect(await ui.find({ type: 'Button', key: 's-dings' })).toBeUndefined()
    await ui.unmount()
  })
})

// Rex: one `rex do` script lists every terminal block; Claude Code names its session in a file per pid.
const rexPane = (block: string, label: string, extra: Record<string, unknown> = {}) => ({
  session: 'session:s1',
  window: `window:${block}`,
  block,
  label,
  owner: 'client:app',
  program_status: { records: [{ state: 'idle', app: 'claude-code' }] },
  process: { foreground: { pid: block === REX_ROOT ? 100 : 200, name: 'claude', cwd: '/w' } },
  title: { title: '' },
  ...extra,
})
const REX_ROOT = 'block:01a1-root'
const REX_CHILD = 'block:01a1-c41d'
const rexList = (...panes: ReturnType<typeof rexPane>[]) => JSON.stringify({ panes, windows: { [`window:${REX_CHILD}`]: 'team' } })
const isRexList = (argv: readonly string[]) => argv[0] === 'rex' && argv[1] === 'do' && argv[2] === '-e'
const REX_RUN = JSON.stringify({ window_id: `window:${REX_CHILD}`, block_ids: [REX_CHILD], revision: 9 }, null, 2)

describe('Rex', () => {
  test('rex run output writes one edge, named by the block label, before its agent has started', async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.read', async (_$, e) => ({ value: e.path === '/home/me/.claude/sessions/100.json' ? '{"sessionId":"root-session"}' : '' }))
    const writes: { path: string; text: string }[] = []
    on('fs.write', async (_$, e) => {
      writes.push({ path: e.path, text: e.text })
      return { value: undefined }
    })
    let lists = 0
    on('process.run', async (_$, e) => {
      if (!isRexList(e.argv)) return failed
      // The new block still runs its shell: Rex lists it, but not as an agent.
      return ok(lists++ === 0 ? rexList(rexPane(REX_ROOT, 'shell')) : rexList(rexPane(REX_ROOT, 'shell'), rexPane(REX_CHILD, 'demo-impl', { program_status: { records: [] }, process: { foreground: { pid: 300, name: 'fish', cwd: '/w' } } })))
    })
    on('tool.call', { tool: 'Bash' }, bash(REX_RUN))

    await $.tool.call({ tool: 'Bash', command: 'rex run -s "$REX_SESSION" --label demo-impl --focus=false --json -- claude --permission-mode auto' })

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(`/home/me/.local/state/agent-tree/edges/${NOW}-block_01a1_c41d.json`)
    expect(JSON.parse(writes[0]?.text ?? '')).toMatchObject({ v: 1, parent: REX_ROOT, parentSession: 'root-session', child: REX_CHILD, name: 'demo-impl', via: 'claude-mod' })
  })

  test('rex send of a harness into an existing block: the list diff finds the new agent', async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.read', async () => ({ value: '' }))
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    let lists = 0
    on('process.run', async (_$, e) =>
      isRexList(e.argv) ? ok(lists++ === 0 ? rexList(rexPane(REX_ROOT, 'shell')) : rexList(rexPane(REX_ROOT, 'shell'), rexPane(REX_CHILD, 'quiet-fixer'))) : failed,
    )
    on('tool.call', { tool: 'Bash' }, bash(''))

    await $.tool.call({ tool: 'Bash', command: `rex send -s "$REX_SESSION" -b ${REX_CHILD} 'claude --model sonnet' && rex send-key -s "$REX_SESSION" -b ${REX_CHILD} enter` })

    expect(writes.map(t => [JSON.parse(t).child, JSON.parse(t).name])).toEqual([[REX_CHILD, 'quiet-fixer']])
  })

  test('the team helper through a variable, its block id kept in a variable: the list diff finds each worker', async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.read', async () => ({ value: '' }))
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const team = (block: string, label: string) => rexPane(block, label, { session: 'session:team' })
    let lists = 0
    on('process.run', async (_$, e) =>
      isRexList(e.argv)
        ? ok(lists++ === 0 ? rexList(rexPane(REX_ROOT, 'shell')) : rexList(rexPane(REX_ROOT, 'shell'), team('block:01a1-c1', 'retro-c1'), team('block:01a1-c2', 'retro-c2')))
        : failed,
    )
    on('tool.call', { tool: 'Bash' }, bash(''))

    await $.tool.call({ tool: 'Bash', command: 'RT=~/x/rex-team.sh; for l in c1 c2; do B=$($RT spawn "$S" retro-$l "$CWD" -- claude --model opus); done' })

    expect(writes.map(t => [JSON.parse(t).child, JSON.parse(t).name, JSON.parse(t).session])).toEqual([
      ['block:01a1-c1', 'retro-c1', 'session:team'],
      ['block:01a1-c2', 'retro-c2', 'session:team'],
    ])
  })

  test('negative control: inside herdr, even under Rex, a rex run records nothing and lists nothing', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const runs: string[] = []
    on('process.run', async (_$, e) => {
      runs.push(e.argv.slice(0, 2).join(' '))
      return failed
    })
    on('tool.call', { tool: 'Bash' }, bash(REX_RUN))

    // herdr is the nearer multiplexer here, so a rex spawn is not this session's pane tree.
    await $.tool.call({ tool: 'Bash', command: 'rex run --json -- claude' })

    expect(writes).toEqual([])
    expect(runs).toEqual([])
  })

  test('a recorded child shows in the tree with its Rex status and its DONE: label as title', async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: REX_ROOT, parentSession: '', child: REX_CHILD, name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-block_01a1_c41d.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async (_$, e) => ({ value: e.path.includes('/edges/') ? edgeText : '' }))
    on('fs.exists', async () => ({ value: false }))
    on('process.run', async (_$, e) =>
      isRexList(e.argv) ? ok(rexList(rexPane(REX_ROOT, 'shell'), rexPane(REX_CHILD, 'DONE: shipped', { program_status: { records: [{ state: 'idle', app: 'codex' }] } }))) : failed,
    )

    const snap = await openPane($, on)

    expect(snap.error).toBe('')
    expect(snap.nodes.map(n => [n.pane, n.name, n.harness, n.status, n.title])).toEqual([[REX_CHILD, 'demo-impl', 'codex', 'done', 'DONE: shipped']])
  })

  test('Rex not answering: the snapshot names Rex', async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('process.run', async () => failed)

    expect((await openPane($, on)).error).toBe('Rex is not answering.')
  })

  test("pressing a row's name focuses its block, then shows it in the app that owns this session's block", async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    const edgeText = JSON.stringify({ v: 1, parent: REX_ROOT, parentSession: '', child: REX_CHILD, name: 'demo-impl', via: 'claude-mod', at: NOW - 1000 })
    on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-block_01a1_c41d.json`, kind: 'file' as const, size: edgeText.length, mtimeMs: 0, isLink: false }] }))
    on('fs.read', async (_$, e) => ({ value: e.path.includes('/edges/') ? edgeText : '' }))
    on('fs.exists', async () => ({ value: false }))
    const focus: (readonly string[])[] = []
    on('process.run', async (_$, e) => {
      if (isRexList(e.argv)) return ok(rexList(rexPane(REX_ROOT, 'shell', { owner: 'client:mac' }), rexPane(REX_CHILD, 'demo-impl')))
      if (e.argv[0] === 'rex') {
        focus.push(e.argv)
        return ok('')
      }
      return failed
    })

    const snap = await watchPane(on).open($)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: { title: 'Agent tree', isFocused: true, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    await ui.press({ key: `f-${REX_CHILD}-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()

    expect(focus).toEqual([
      ['rex', 'api', 'call', '-s', 'session:s1', 'session.focus_block', JSON.stringify({ session_id: 'session:s1', block_id: REX_CHILD })],
      ['rex', '-C', 'client:mac', 'do', 'session.select', 'session_id=session:s1', `window_id=window:${REX_CHILD}`],
    ])
  })
})

describe('Rex spawns from variables', () => {
  test('a loop that names no harness still records the agent it started; a plain block it printed is not recorded', async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.read', async () => ({ value: '' }))
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
      return { value: undefined }
    })
    const SHELL = 'block:01a1-5e11'
    let lists = 0
    on('process.run', async (_$, e) =>
      isRexList(e.argv)
        ? ok(lists++ === 0 ? rexList(rexPane(REX_ROOT, 'shell')) : rexList(rexPane(REX_ROOT, 'shell'), rexPane(REX_CHILD, 'team-lead'), rexPane(SHELL, 'logs', { program_status: { records: [] }, process: { foreground: { pid: 5, name: 'tail', cwd: '/w' } } })))
        : failed,
    )
    on('tool.call', { tool: 'Bash' }, bash(JSON.stringify({ block_ids: [SHELL] })))

    await $.tool.call({ tool: 'Bash', command: 'for t in team; do rex new "$t" --json -- sh "./$t-lead.sh"; done' })

    expect(writes.map(t => [JSON.parse(t).child, JSON.parse(t).name])).toEqual([[REX_CHILD, 'team-lead']])
  })
})

describe('Rex hosts', () => {
  test("an agent on another host is listed with its server, and this machine's session files are never read for its pid", async ($, on) => {
    mock.env(on, { HOME: '/home/me', REX_BLOCK: REX_ROOT })
    mock.store(on)
    on('clock.now', async () => ({ value: NOW }))
    on('fs.list', async () => ({ value: [] }))
    const reads: string[] = []
    on('fs.read', async (_$, e) => {
      reads.push(e.path)
      return { value: '{"sessionId":"wrong-machine"}' }
    })
    on('process.run', async (_$, e) => (isRexList(e.argv) ? ok(rexList(rexPane(REX_ROOT, 'shell'), { ...rexPane(REX_CHILD, 'far-impl'), server: 'linux-box' } as ReturnType<typeof rexPane>)) : failed))

    const snap = await openPane($, on)

    const far = snap.all.find(a => a.pane === REX_CHILD)
    expect([far?.server, far?.session]).toEqual(['linux-box', ''])
    expect(reads).toEqual(['/home/me/.claude/sessions/100.json'])
  })
})
