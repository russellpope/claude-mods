import { describe, expect, test } from 'claude-code/testing'

import { focusArgvs, invokesRexSpawn, keepNames, namesHarness, parseClaudeSessionFile, parseRexList, parseRexStarted, pidOf } from './rex'

const pane = (block: string, extra: Record<string, unknown> = {}) => ({
  session: 'session:s1',
  window: `window:${block}`,
  block: `block:${block}`,
  label: 'shell',
  owner: 'client:app',
  program_status: { records: [{ state: 'working', app: 'claude-code', updated_at: 't' }] },
  process: { foreground: { pid: 42, name: 'claude', cwd: '/w' } },
  title: { title: 'Doing things' },
  ...extra,
})

describe('parseRexList', () => {
  test('maps a Claude block: harness from its status app, the session as workspace, the window as tab', () => {
    const out = JSON.stringify({ panes: [pane('a1', { label: 'demo-impl' })], windows: { 'window:a1': 'mods' } })
    expect(parseRexList(out)).toEqual({
      agents: [
        { pane: 'block:a1', name: 'demo-impl', harness: 'claude', status: 'working', title: '', label: 'Doing things', cwd: '/w', workspace: 'session:s1', session: '', terminal: 'block:a1#42', tab: 'window:a1' },
      ],
      labels: { 'window:a1': 'mods' },
      owners: { 'block:a1': 'client:app' },
      names: { 'block:a1': 'demo-impl' },
      down: [],
    })
  })

  test("a block on another host carries that host's label; hosts that did not answer are listed", () => {
    const out = JSON.stringify({ panes: [pane('a1'), pane('r1', { server: 'linux-box' })], down: ['laptop'] })
    const list = parseRexList(out)
    expect(list.agents.map(a => [a.pane, a.server])).toEqual([
      ['block:a1', undefined],
      ['block:r1', 'linux-box'],
    ])
    expect(list.down).toEqual(['laptop'])
  })

  test("a DONE: or BLOCKED: label is the block's title, not its name; Rex's default label names nothing", () => {
    const out = JSON.stringify({ panes: [pane('a1', { label: 'DONE: shipped' }), pane('a2', { label: 'BLOCKED: need a key' }), pane('a3')] })
    expect(parseRexList(out).agents.map(a => [a.name, a.title])).toEqual([
      ['', 'DONE: shipped'],
      ['', 'BLOCKED: need a key'],
      ['', ''],
    ])
  })

  test('codex reports its own app; a harness with no status is known by its process; anything else is not an agent', () => {
    const out = JSON.stringify({
      panes: [
        pane('c1', { program_status: { records: [{ state: 'done', app: 'codex' }] }, process: { foreground: { pid: 7, name: 'codex', cwd: '/k' } } }),
        pane('o1', { program_status: { records: [] }, process: { foreground: { pid: 8, name: 'opencode', cwd: '/o' } } }),
        pane('f1', { program_status: { records: [] }, process: { foreground: { pid: 9, name: 'fish', cwd: '/' } } }),
        pane('x1', { program_status: undefined, process: undefined }),
        // Lua hands back a status with no records as {}.
        pane('o2', { program_status: { records: {} }, process: { foreground: { pid: 10, name: 'opencode', cwd: '/o' } } }),
        pane('f2', { program_status: { records: {} }, process: { foreground: { pid: 11, name: 'fish', cwd: '/' } } }),
      ],
    })
    expect(parseRexList(out).agents.map(a => [a.pane, a.harness, a.status])).toEqual([
      ['block:c1', 'codex', 'done'],
      ['block:o1', 'opencode', 'unknown'],
      ['block:o2', 'opencode', 'unknown'],
    ])
  })

  test('a failed program needs you, as blocked does; a state the protocol adds later reads as idle', () => {
    const out = JSON.stringify({
      panes: [pane('e1', { program_status: { records: [{ state: 'error', app: 'claude-code' }] } }), pane('n1', { program_status: { records: [{ state: 'paused', app: 'claude-code' }] } })],
    })
    expect(parseRexList(out).agents.map(a => a.status)).toEqual(['blocked', 'idle'])
  })

  test("the root record wins over a program's sub-records", () => {
    const out = JSON.stringify({ panes: [pane('a1', { program_status: { records: [{ state: 'idle', app: 'claude-code' }, { id: 'build', state: 'working' }] } })] })
    expect(parseRexList(out).agents[0]?.status).toBe('idle')
  })

  test('Lua sends an empty table as {}: no panes, no labels; anything that is not a pane list throws', () => {
    expect(parseRexList('{"panes":{},"windows":{},"down":{}}')).toEqual({ agents: [], labels: {}, owners: {}, names: {}, down: [] })
    expect(() => parseRexList('{"sessions":[]}')).toThrow()
    expect(() => parseRexList('Error: no server')).toThrow()
  })
})

describe('keepNames', () => {
  test("a block renamed DONE: keeps the name it had; a new process in the block does not inherit it", () => {
    const known = new Map<string, string>()
    const first = parseRexList(JSON.stringify({ panes: [pane('a1', { label: 'haiku-impl-1' })] })).agents
    expect(keepNames(first, known).map(a => a.name)).toEqual(['haiku-impl-1'])
    const done = parseRexList(JSON.stringify({ panes: [pane('a1', { label: 'DONE: picked 13' })] })).agents
    expect(keepNames(done, known).map(a => [a.name, a.title])).toEqual([['haiku-impl-1', 'DONE: picked 13']])
    const next = parseRexList(JSON.stringify({ panes: [pane('a1', { label: 'DONE: picked 13', process: { foreground: { pid: 43, name: 'claude', cwd: '/w' } } })] })).agents
    expect(keepNames(next, known).map(a => a.name)).toEqual([''])
  })
})

describe('pids and sessions', () => {
  test("pidOf reads a Rex terminal's pid; a herdr terminal has none", () => {
    const [a] = parseRexList(JSON.stringify({ panes: [pane('a1')] })).agents
    expect(a && pidOf(a)).toBe(42)
    expect(pidOf({ ...a!, terminal: 'term-w1:p1' })).toBeNaN()
  })

  test("parseClaudeSessionFile: Claude Code's per-pid file → its session id; anything else → blank", () => {
    expect(parseClaudeSessionFile('{"pid":42,"sessionId":"4397d73d-a07f","cwd":"/w"}')).toBe('4397d73d-a07f')
    expect(parseClaudeSessionFile('{"pid":42}')).toBe('')
    expect(parseClaudeSessionFile('')).toBe('')
  })
})

describe('invokesRexSpawn', () => {
  test('rex run, split, new, window new or send, whatever they run', () => {
    for (const c of [
      'rex run -s "$S" --label demo-impl --json -- claude --permission-mode auto',
      'rex split -s "$S" -b "$B" --focus=false --json -- codex',
      'ID=$(rex window new -s "$S" Lead --json -- sh -c "claude --model opus")',
      'rex new team -c /w --json -- opencode',
      'rex send -s "$S" -b "$B" "claude --permission-mode auto" && rex send-key -s "$S" -b "$B" enter',
      'cd /w && rex -C mac run -- claude',
      'for t in a b; do out=$(rex new "$t-team" --json -- sh "$t.sh"); done',
      'rex run -s "$S" -- npm test',
    ])
      expect([c, invokesRexSpawn(c)]).toEqual([c, true])
  })

  test('negative control: other rex commands, a key press, and text that only mentions it', () => {
    for (const c of ['rex capture -s "$S" -b "$B" --trim', 'rex send-key -s "$S" -b "$B" enter', "echo 'rex run -- claude'", 'grep -r "rex split" docs', 'claude -p hi'])
      expect([c, invokesRexSpawn(c)]).toEqual([c, false])
  })

  test('namesHarness: claude, codex or opencode as a word', () => {
    expect(['rex run -- claude', 'rex split -- sh -c "codex -m x"', 'rex run -- npm test'].map(namesHarness)).toEqual([true, true, false])
  })
})

describe('parseRexStarted', () => {
  test("block_ids from --json, or a bare block id; a split's anchor is not new", () => {
    const split = JSON.stringify({ anchor_id: 'block:01a1-aaaa', block_ids: ['block:01a1-bbbb'], split_ids: ['split:01a1-cccc'] }, null, 2)
    expect(parseRexStarted(split)).toEqual(['block:01a1-bbbb'])
    expect(parseRexStarted('block:01a1-dddd\n')).toEqual(['block:01a1-dddd'])
    expect(parseRexStarted('Error: no such session')).toEqual([])
  })
})

describe('focusArgvs', () => {
  test("focus the block in its session, then show that session's window in the app given", () => {
    const [a] = parseRexList(JSON.stringify({ panes: [pane('a1')] })).agents
    expect(focusArgvs(a!, 'client:app')).toEqual([
      ['rex', 'api', 'call', '-s', 'session:s1', 'session.focus_block', '{"session_id":"session:s1","block_id":"block:a1"}'],
      ['rex', '-C', 'client:app', 'do', 'session.select', 'session_id=session:s1', 'window_id=window:a1'],
    ])
    expect(focusArgvs(a!, '')[1]?.slice(0, 3)).toEqual(['rex', 'do', 'session.select'])
  })

  test("a block on another host is focused there; this server's app id is not passed to it", () => {
    const [a] = parseRexList(JSON.stringify({ panes: [pane('r1', { server: 'linux-box' })] })).agents
    expect(focusArgvs(a!, 'client:app').map(argv => argv.slice(0, 4))).toEqual([
      ['rex', '-S', 'linux-box', 'api'],
      ['rex', '-S', 'linux-box', 'do'],
    ])
  })
})
