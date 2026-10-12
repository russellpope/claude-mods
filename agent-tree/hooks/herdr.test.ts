import { describe, expect, test } from 'claude-code/testing'

import { herdrError, invokesAgentStart, newAgents, parseAgentList, parseStarted } from './herdr'

const raw = (pane: string, extra: Record<string, unknown> = {}) => ({
  pane_id: pane,
  name: `n-${pane}`,
  agent: 'claude',
  agent_status: 'working',
  cwd: '/w',
  workspace_id: 'w1',
  terminal_id: `term-${pane}`,
  terminal_title_stripped: 'Doing things',
  agent_session: { value: `s-${pane}` },
  ...extra,
})

describe('parseAgentList', () => {
  test('maps herdr fields and drops rows with no pane', () => {
    const out = JSON.stringify({ id: 'cli:agent:list', result: { type: 'agent_list', agents: [raw('w1:p1', { title: 'DONE: x' }), { name: 'x' }] } })
    expect(parseAgentList(out)).toEqual([
      { pane: 'w1:p1', name: 'n-w1:p1', harness: 'claude', status: 'working', title: 'DONE: x', label: 'Doing things', cwd: '/w', workspace: 'w1', session: 's-w1:p1', terminal: 'term-w1:p1' },
    ])
  })

  test('an unknown status becomes unknown; a missing session is blank', () => {
    const out = JSON.stringify({ result: { type: 'agent_list', agents: [raw('w1:p2', { agent_status: 'weird', agent_session: undefined })] } })
    const [a] = parseAgentList(out)
    expect(a?.status).toBe('unknown')
    expect(a?.session).toBe('')
  })

  test('throws on anything that is not an agent_list', () => {
    expect(() => parseAgentList('{"result":{"type":"pane_list","panes":[]}}')).toThrow()
    expect(() => parseAgentList('not json')).toThrow()
  })
})

describe('parseStarted', () => {
  test('finds agent_started documents among other output lines', () => {
    const started = JSON.stringify({ id: 'cli:agent:start', result: { type: 'agent_started', argv: ['claude'], agent: raw('wX:p2', { name: 'demo-impl' }) } })
    const got = parseStarted(`creating pane\n${started}\n{"result":{"type":"agent_prompted","agent":{"pane_id":"wX:p9"}}}\n`)
    expect(got.map(a => [a.pane, a.name])).toEqual([['wX:p2', 'demo-impl']])
  })

  test('nothing on plain text or broken JSON', () => {
    expect(parseStarted('ok\n{"agent_started": broken')).toEqual([])
  })
})

describe('invokesAgentStart', () => {
  test('true when it runs as a command', () => {
    expect(invokesAgentStart('herdr agent start a --kind claude --pane w1:p2')).toBe(true)
    expect(invokesAgentStart('cd /x && herdr agent start "$SLOT" --kind claude --pane "$P" -- --model opus')).toBe(true)
    expect(invokesAgentStart('OUT=$(herdr agent start a --kind codex --pane w1:p2)')).toBe(true)
    expect(invokesAgentStart('X="$(herdr agent start a --kind codex --pane w1:p2)"')).toBe(true)
    expect(invokesAgentStart('if herdr agent start a --kind pi --pane w1:p2; then echo ok; fi')).toBe(true)
  })

  test('false when it is only text', () => {
    expect(invokesAgentStart('echo "next: herdr agent start a"')).toBe(false)
    expect(invokesAgentStart("grep -n 'herdr agent start' SKILL.md")).toBe(false)
    expect(invokesAgentStart('echo herdr agent start')).toBe(false)
    expect(invokesAgentStart('herdr agent list')).toBe(false)
  })
})

describe('newAgents', () => {
  test('a new pane, or a pane now running a different session', () => {
    const before = parseAgentList(JSON.stringify({ result: { type: 'agent_list', agents: [raw('w1:p1'), raw('w1:p2')] } }))
    const after = parseAgentList(
      JSON.stringify({ result: { type: 'agent_list', agents: [raw('w1:p1'), raw('w1:p2', { agent_session: { value: 'other' } }), raw('w1:p3')] } }),
    )
    expect(newAgents(before, after).map(a => a.pane)).toEqual(['w1:p2', 'w1:p3'])
  })
})

describe('herdrError', () => {
  test("a refused command's message; anything else is empty", () => {
    expect(herdrError('{"error":{"code":"agent_not_found","message":"agent target x:p9 not found"},"id":"cli:agent:focus"}')).toBe('agent target x:p9 not found')
    expect(herdrError('{"result":{}}')).toBe('')
    expect(herdrError('not json')).toBe('')
  })
})
