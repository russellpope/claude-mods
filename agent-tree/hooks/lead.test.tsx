import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Snapshot } from '../types'

// The lead's tools: team_status, errored rows and their continue button, the batch ETA, the model change mark.
type On = Parameters<TestBody>[1]
type E = Parameters<TestBody>[0]

const NOW = 1_791_486_939_969
const MIN = 60_000
const TOOL = 'mcp__agent-tree__team_status'
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = (stderr: string, stdout = '') => ({ value: { exitCode: 1, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

const herdrAgent = (pane: string, name: string, session: string, status: string) => ({
  pane_id: pane,
  name,
  agent: 'claude',
  agent_status: status,
  cwd: '/w',
  workspace_id: pane.split(':')[0],
  terminal_id: `term-${pane}`,
  agent_session: { value: session },
})
const herdrList = (...agents: ReturnType<typeof herdrAgent>[]) => JSON.stringify({ id: 'cli:agent:list', result: { type: 'agent_list', agents } })
const ROOT = herdrAgent('w9:p1', 'me', 'root-session', 'working')
const EDGE = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'i702-impl', via: 'claude-mod', at: NOW - 1000 })

const usageLine = (id: string, model: string, input: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, effort: 'high', timestamp: '2026-11-18T10:00:00.000Z', message: { id, model, usage: { input_tokens: input, output_tokens: 0 } }, ...extra })
const ERROR_LINE = JSON.stringify({
  type: 'assistant',
  isSidechain: false,
  isApiErrorMessage: true,
  error: 'authentication_failed',
  apiErrorStatus: 401,
  timestamp: '2026-11-18T10:05:00.000Z',
  message: { id: 'e1', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } },
})
const tickets = (fixed: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const f = `/r/docs/issues/I70${i}.md`
    return [`${f}:id: I70${i}`, `${f}:status: ${i < fixed ? 'fixed' : i === fixed ? 'in-progress' : 'open'}`, `${f}:batch: b1#${i}`, ...(i === fixed ? [`${f}:workspace: /w`] : [])].join('\n')
  }).join('\n')

/** The world one worker lives in; a test changes it between refreshes. */
type World = {
  /** herdr's status for the worker, one per list call; the last repeats. */
  statuses: string[]
  transcript: string
  fixed: number
  lists: number
  sent: (readonly string[])[]
  promptReply: ReturnType<typeof ok> | ReturnType<typeof fail>
  toasts: string[]
  registered: { name: string; isDeferred?: unknown }[]
  last?: Snapshot
}

const team = (on: On, env: Record<string, string> = { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' }) => {
  const world: World = { statuses: ['idle'], transcript: '', fixed: 0, lists: 0, sent: [], promptReply: ok('{}'), toasts: [], registered: [] }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, env)
  mock.store(on)
  on('fs.list', async () => ({ value: [{ name: `${NOW - 1000}-wX_p2.json`, kind: 'file' as const, size: EDGE.length, mtimeMs: 0, isLink: false }] }))
  on('fs.read', async () => ({ value: EDGE }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'agent-tree' && e.key === 'snapshot') world.last = e.value as Snapshot
    return next(e)
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => {
    world.registered.push({ name: e.name, isDeferred: e.isDeferred })
    return { value: { tool: `mcp__agent-tree__${e.name}` } }
  })
  on('process.run', async (_$, e) => {
    const [cmd, sub, verb] = e.argv
    if (cmd === 'herdr' && sub === 'agent' && verb === 'list') {
      const status = world.statuses[Math.min(world.lists, world.statuses.length - 1)] ?? 'idle'
      world.lists++
      return ok(herdrList(ROOT, herdrAgent('wX:p2', 'i702-impl', 's2', status)))
    }
    if (cmd === 'herdr' && sub === 'agent' && verb === 'prompt') {
      world.sent.push(e.argv)
      return world.promptReply
    }
    if (cmd === 'herdr') return fail('no')
    if (cmd === 'git') return ok('/r/.git\n')
    if (cmd === 'grep') return ok(tickets(world.fixed))
    if (cmd === '/bin/sh') {
      const bytes = new TextEncoder().encode(world.transcript)
      const start = Number(e.argv[4]) - 1
      return ok(new TextDecoder().decode(bytes.slice(start, start + Number(e.argv[6]))))
    }
    return fail('unexpected')
  })
  const open = async ($: E): Promise<Snapshot> => {
    world.last = undefined
    await $.command.run({ command: 'agent-tree', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    if (!world.last) throw new Error('no snapshot was written')
    return world.last
  }
  return { world, clock, open }
}

const start = ($: E) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
const status = async ($: E, input: Record<string, unknown> = {}): Promise<string> => {
  const r = await $.tool.call({ tool: TOOL, ...input })
  return String(r.result)
}
const PROPS = (bodyColumns: number) => ({ title: 'Agent tree', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} })
const mountPane = ($: E, cols = 140) => $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', component: 'Pane', requestId: 'agent-tree', props: PROPS(cols) })

describe('team_status', () => {
  test('registered in a herdr or Rex pane, in front of the model, not deferred', async ($, on) => {
    const { world } = team(on)
    await start($)
    expect(world.registered).toEqual([{ name: 'team_status', isDeferred: false }])
  })

  test('negative control: outside herdr and Rex it is not registered', async ($, on) => {
    const { world } = team(on, { HOME: '/home/me' })
    await start($)
    expect(world.registered).toEqual([])
  })

  test('answers from a fresh refresh: one line per node with its state, the counts in the header', async ($, on) => {
    const { world } = team(on)
    world.transcript = `${usageLine('m1', 'claude-opus-5-5', 120_000)}\n`
    await start($)
    const text = await status($)
    expect(text.split('\n')).toEqual(['1 idle · batch b1 0/10 fixed · 1 in progress', 'i702-impl · implementer · idle · I700 · Opus 5.5·high · ctx 12% · 0:01 in tree · pane wX:p2'])
  })

  test('a snapshot under 2 s old is answered as it stands; an older one is refreshed first; nothing waits', async ($, on) => {
    const { world, clock } = team(on)
    await start($)
    await status($)
    const after = world.lists
    expect(after).toBeGreaterThan(0)
    await clock.advance(1000)
    await status($)
    expect(world.lists).toBe(after)
    await clock.advance(1500)
    await status($)
    expect(world.lists).toBeGreaterThan(after)
  })

  test('scope all lists every agent, grouped by repo', async ($, on) => {
    team(on)
    await start($)
    const text = await status($, { scope: 'all' })
    expect(text.split('\n')).toEqual(['1 idle · batch b1 0/10 fixed · 1 in progress · 2 agents listed', 'r', '  me · claude · working · pane w9:p1', '  i702-impl · claude · idle · pane wX:p2'])
  })

  test('never sends anything to a pane', async ($, on) => {
    const { world } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    await start($)
    await status($)
    expect(world.sent).toEqual([])
  })
})

describe('errored rows', () => {
  test('a worker whose last turn died on an API error is errored: a warning mark, the reason as its note, a continue button, counted on the status line', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${usageLine('m1', 'claude-opus-5-5', 120_000)}\n${ERROR_LINE}\n`
    const snap = await open($)
    const n = snap.nodes[0]
    expect(n?.apiError).toEqual({ reason: 'authentication_failed', status: 401, at: Date.parse('2026-11-18T10:05:00.000Z') })
    // The error line is not a model: the row keeps its model and context.
    expect([n?.usage?.model, n?.usage?.contextTokens]).toEqual(['claude-opus-5-5', 120_000])
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^⚠ $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /API error: authentication_failed \(401\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `c-wX:p2-${n?.startedAt}` })).toBeDefined()
    await ui.unmount()
    expect(await status($)).toMatch(/i702-impl · implementer · idle · API error: authentication_failed \(401\)/)
  })

  test('a worker herdr reports working is not errored, whatever its transcript says', async ($, on) => {
    const { world, open } = team(on)
    world.statuses = ['working']
    world.transcript = `${ERROR_LINE}\n`
    const snap = await open($)
    expect(snap.nodes[0]?.apiError).toBeUndefined()
  })

  test('a first turn that died before any model answered is still errored', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    expect((await open($)).nodes[0]?.apiError?.reason).toBe('authentication_failed')
  })

  test('continue sends one prompt through herdr, then confirms', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    const snap = await open($)
    const ui = await mountPane($)
    await ui.press({ key: `c-wX:p2-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()
    expect(world.sent).toEqual([['herdr', 'agent', 'prompt', 'wX:p2', 'Continue your dispatch from where you stopped.']])
    expect(world.toasts).toEqual(['agent-tree: sent continue to i702-impl'])
  })

  test('the prompt is the continuePrompt setting', { options: { continuePrompt: 'Log in is fixed. Carry on.' } }, async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    const snap = await open($)
    const ui = await mountPane($)
    await ui.press({ key: `c-wX:p2-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()
    expect(world.sent.map(a => a[4])).toEqual(['Log in is fixed. Carry on.'])
  })

  test('an agent working by the time of the press gets nothing, and a toast says why', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    const snap = await open($)
    world.statuses = ['working']
    world.lists = 0
    const ui = await mountPane($)
    await ui.press({ key: `c-wX:p2-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()
    expect(world.sent).toEqual([])
    expect(world.toasts).toEqual(['agent-tree: did not send continue to i702-impl: it is working'])
  })

  test('a send herdr refuses toasts its reason', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    world.promptReply = fail('agent_blocked: agent is blocked')
    const snap = await open($)
    const ui = await mountPane($)
    await ui.press({ key: `c-wX:p2-${snap.nodes[0]?.startedAt}` })
    await ui.unmount()
    expect(world.sent).toHaveLength(1)
    expect(world.toasts).toEqual(['agent-tree: could not send continue to i702-impl: agent_blocked: agent is blocked'])
  })

  test('nothing is sent without a press, however many refreshes see the error', async ($, on) => {
    const { world, open, clock } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    await start($)
    await open($)
    await clock.advance(30_000)
    await status($)
    expect(world.sent).toEqual([])
  })

  test('a later user line clears the error', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${ERROR_LINE}\n`
    expect((await open($)).nodes[0]?.apiError).toBeDefined()
    world.transcript += `${JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'Continue' } })}\n`
    expect((await open($)).nodes[0]?.apiError).toBeUndefined()
  })
})

describe('model change marker', () => {
  test('the model cell marks the change, the note and team_status say what it was', async ($, on) => {
    const { world, open } = team(on)
    world.transcript = `${usageLine('m1', 'claude-opus-5-5', 1000)}\n${usageLine('m2', 'claude-sonnet-5-5', 1000, { timestamp: '2026-11-18T11:00:00.000Z' })}\n`
    const snap = await open($)
    expect(snap.nodes[0]?.usage?.was).toEqual({ model: 'claude-opus-5-5', effort: 'high', at: Date.parse('2026-11-18T11:00:00.000Z') })
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /^Sonnet 5\.5·high\*$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /was Opus 5\.5·high/ })).toBeDefined()
    await ui.unmount()
    expect(await status($)).toMatch(/Sonnet 5\.5·high \(was Opus 5\.5·high\)/)
  })
})

describe('batch ETA', () => {
  test('after two observed closes the batch line ends with the time left; closes before first sight do not count', async ($, on) => {
    const { world, open, clock } = team(on)
    world.fixed = 2
    await open($)
    let ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: /2\/10 fixed · 1 in progress$/ })).toBeDefined()
    await ui.unmount()
    await clock.advance(20 * MIN)
    world.fixed = 3
    await open($)
    ui = await mountPane($)
    // One close seen: no estimate yet.
    expect(await ui.find({ type: 'Text', text: /3\/10 fixed · 1 in progress$/ })).toBeDefined()
    await ui.unmount()
    await clock.advance(20 * MIN)
    world.fixed = 4
    await open($)
    ui = await mountPane($)
    // First seen at 0, closes at 20 and 40 min: 20 min a close, 6 left.
    expect(await ui.find({ type: 'Text', text: /4\/10 fixed · 1 in progress · ~2h left$/ })).toBeDefined()
    await ui.unmount()
    expect((await status($)).split('\n')[0]).toMatch(/batch b1 4\/10 fixed · 1 in progress · ~2h left$/)
  })
})
