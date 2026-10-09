# agent-tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `agent-tree` Claude Code mod: a pane, opened with `/agent-tree`, showing the herdr agents this session spawned (and theirs, any depth), with a global All view, per-worker model, context, cost, ticket and status, and half-block pixel crabs.

**Architecture:** A hooks module (`hooks/register.tsx`) wires small pure modules: herdr output parsing, a one-file-per-edge lineage ledger, tree building, transcript usage, ticket lookup, crab sprites, and view helpers. A `tool.call` hook on Bash records an edge whenever this session runs `herdr agent start`. A 2 s clock, active while the pane is open, rebuilds a `Snapshot` in `$.state`, and the `Pane` render reads it.

**Tech Stack:** Claude Code function-hooks plugin API (build 2.1.293), TypeScript/TSX compiled by the engine, `claude-code/testing` kit, herdr CLI, git CLI.

**Spec:** `docs/superpowers/specs/2026-10-08-agent-tree-design.md`

## Deviations from the spec (decided while planning, from live probes on 2026-10-08)

1. **Ledger is a directory of one-file-per-edge**, `~/.local/state/agent-tree/edges/<at>-<child>.json`, not one `edges.jsonl`. `$.fs` has `write` (whole file) but no append, and several sessions write concurrently. Same fields, same `v: 1`.
2. **Only `herdr agent start` makes an edge.** `herdr workspace create` and `herdr pane split` make empty panes; the agent appears at `agent start`, whose stdout is `{"result":{"type":"agent_started","agent":{pane_id,name,…},"argv":[…]}}` (herdr API schema, protocol 22). When a script swallows that output, a before/after `herdr agent list` diff finds the new pane.
3. **Role comes from the herdr agent name** (`*-lead`, `*-impl`, `*-review(er)`, `*-fix(er)`, `*-integrator`, `*-res(earch)`), the slot names the team skills already use. Kintsugi `dispatch overview` is not called in v1 (its item shape could not be sampled: it returned no items).
4. **Pane-id reuse:** a pane bound to an edge is identified by herdr `terminal_id`. When two edges name the same child pane, the newest edge owns it and older ones show as gone.
5. **Batch bar counts** are fixed / in-progress / open (ticket `status:` has no "blocked" value; blocked shows on agents).

## Global Constraints

- Mod folder: `agent-tree/` at the repo root. Manifest name `agent-tree`, version `0.1.0`. Command: `/agent-tree`. Pane id: `agent-tree`, title `Agent tree`.
- Layout follows `outputs-pane/`: `.claude-plugin/plugin.json`, `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), `hooks/*.ts(x)`, `hooks/*.test.ts(x)`, `types/index.d.ts`, `tsconfig.json` (`{ "extends": "./.claude-plugin/types/tsconfig.json" }`), `README.md`.
- No npm dependencies. The module runs with no DOM and no Node: everything outside goes through `$` (`$.process.run`, `$.fs`, `$.env`, `$.store`, `$.clock`, `$.ui`).
- Ledger dir: `<HOME>/.local/state/agent-tree/edges`. Edge fields: `{"v":1,"parent","parentSession","child","name","via":"claude-mod","at"}`. Edges older than 7 days are not read.
- Cadence: refresh every 2 s while the pane is open. While it is closed, the status line refreshes every 10 s, and only when this session has recorded an edge. The ticket index refreshes at most every 15 s. The crab animates at 4 fps only while the pane is open, an agent is working, and option `motion` is `on`.
- Compact mode when the pane body is under 60 columns (`compact: auto`), or forced on or off from the pane.
- Status line text: `tree <working>● <blocked>!`, with the `!` part only when something is blocked. Cleared when no tree member is live.
- No failure throws out of a hook, blanks the pane, or blocks a Bash call.
- Commits: stage explicit paths only (never `git add -A`/`.`); check `git status --short` and `git diff --cached --stat` first; write each message with the Write tool to the session scratchpad and `git commit -F <file>`. End messages with the session's Co-Authored-By / Claude-Session lines.
- Auto-mode note (this repo): if Edit/Write on a repo file fails with "auto mode classifier gave no verdict", write the file to the scratchpad and `cp` it into place.
- Test command for every task: `claude plugin test agent-tree` (from the repo root). If it reports "hooks modules are turned off ... rollout switch", run `claude -p "Reply with the single word ok" --max-turns 1` once and retry.

## Review Focus

1. **Spawn output swallowed** (`OUT=$(herdr agent start …)`, or `>/dev/null`): the worker should still appear in the tree. Pinned by the diff-fallback test in Task 2.
2. **Transcript over 4 MiB** (a long lead session): the row should still show model and cost, not an error. Pinned by the chunked-read test in Task 4.
3. **A worker's pane closes while the pane is open:** the row should turn `✗` and keep its last numbers, not vanish. Pinned by the gone-node test in Task 3.
4. **herdr not answering** (server restarting): the pane should say so and keep in-process rows. Pinned by the refresh-error test in Task 7.
5. **A herdr pane reused for a new lead** (claude-team "adopt" step): the old lead must not inherit the new lead's numbers. Pinned by the newest-edge-owns test in Task 3.

---

### Task 1: Scaffold and herdr output parsing

**Files:**
- Create: `agent-tree/.claude-plugin/plugin.json`
- Create: `agent-tree/hooks/hooks.json`
- Create: `agent-tree/tsconfig.json`
- Create: `agent-tree/types/index.d.ts`
- Create: `agent-tree/hooks/herdr.ts`
- Create: `agent-tree/hooks/register.tsx` (stub)
- Test: `agent-tree/hooks/herdr.test.ts`

**Interfaces:**
- Produces (types, `agent-tree/types/index.d.ts`): `AgentStatus`, `NodeStatus`, `Role`, `Edge`, `HerdrAgent`, `Usage`, `TreeNode`, `BatchCounts`, `Snapshot`, `Panel`, `InProcRun`, and the `PluginState['agent-tree']` contract.
- Produces (`hooks/herdr.ts`): `toAgent(raw): HerdrAgent`, `parseAgentList(stdout: string): HerdrAgent[]` (throws on non-`agent_list`), `parseStarted(stdout: string): HerdrAgent[]`, `invokesAgentStart(command: string): boolean`, `newAgents(before: HerdrAgent[], after: HerdrAgent[]): HerdrAgent[]`.

- [ ] **Step 1: Write the manifest, hooks.json, tsconfig and types**

`agent-tree/.claude-plugin/plugin.json`:
```json
{
  "name": "agent-tree",
  "version": "0.1.0",
  "description": "Pane of the herdr agents this session spawned, and theirs: status, model, context, cost, ticket. /agent-tree toggles it; a global view lists every herdr agent.",
  "types": "./types/index.d.ts",
  "userConfig": {
    "motion": {
      "type": "string",
      "title": "Crab animation",
      "description": "off keeps the crab still",
      "default": "on",
      "options": ["on", "off"]
    }
  }
}
```

`agent-tree/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```

`agent-tree/tsconfig.json`:
```json
{
  "extends": "./.claude-plugin/types/tsconfig.json"
}
```

`agent-tree/types/index.d.ts`:
```ts
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
export type NodeStatus = 'working' | 'idle' | 'blocked' | 'done' | 'gone'
export type Role = 'lead' | 'implementer' | 'reviewer' | 'fixer' | 'integrator' | 'research' | 'other'

/** One spawn: `parent` pane ran `herdr agent start` and `child` pane got the agent. */
export type Edge = {
  v: 1
  parent: string
  parentSession: string
  child: string
  name: string
  via: string
  at: number
}

/** One row of `herdr agent list`, trimmed to what the mod reads. */
export type HerdrAgent = {
  pane: string
  name: string
  harness: string
  status: AgentStatus
  title: string
  label: string
  cwd: string
  workspace: string
  session: string
  terminal: string
}

export type Usage = {
  model: string
  effort: string
  contextTokens: number
  tokens: number
  costUsd: number
}

export type TreeNode = {
  pane: string
  parent: string
  depth: number
  isLast: boolean
  name: string
  harness: string
  role: Role
  status: NodeStatus
  title: string
  cwd: string
  session: string
  startedAt: number
  lastSeen: number
  usage: Usage | null
  ticket: string
}

export type BatchCounts = { stamp: string; fixed: number; inProgress: number; open: number; total: number }

export type Snapshot = {
  at: number
  root: string
  nodes: TreeNode[]
  all: HerdrAgent[]
  /** cwd → main repo path */
  repos: Record<string, string>
  batch: BatchCounts | null
  error: string
}

export type Panel = {
  mode: 'tree' | 'all'
  compact: 'auto' | 'on' | 'off'
  isFinishedOpen: boolean
  isInProcessOpen: boolean
  isAutoOpened: boolean
}

export type InProcRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  contextTokens: number
  tokens: number
  costUsd: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': {
      snapshot: Snapshot
      panel: Panel
      frame: number
      inproc: InProcRun[]
      edgeCount: number
    }
  }
}
```

`agent-tree/hooks/register.tsx` (stub so the module loads; Task 2 replaces it):
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 2: Write the failing tests**

`agent-tree/hooks/herdr.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { invokesAgentStart, newAgents, parseAgentList, parseStarted } from './herdr'

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./herdr`.

- [ ] **Step 4: Write `hooks/herdr.ts`**

```ts
import type { AgentStatus, HerdrAgent } from '../types'

const STATUSES: readonly AgentStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown']

type RawAgent = {
  pane_id?: string
  name?: string
  agent?: string
  agent_status?: string
  title?: string
  terminal_title_stripped?: string
  cwd?: string
  workspace_id?: string
  terminal_id?: string
  agent_session?: { value?: string }
}

export const toAgent = (r: RawAgent): HerdrAgent => ({
  pane: r.pane_id ?? '',
  name: r.name ?? '',
  harness: r.agent ?? '',
  status: STATUSES.includes(r.agent_status as AgentStatus) ? (r.agent_status as AgentStatus) : 'unknown',
  title: r.title ?? '',
  label: r.terminal_title_stripped ?? '',
  cwd: r.cwd ?? '',
  workspace: r.workspace_id ?? '',
  session: r.agent_session?.value ?? '',
  terminal: r.terminal_id ?? '',
})

/** `herdr agent list` stdout → agents. Throws on anything that is not an agent_list. */
export const parseAgentList = (stdout: string): HerdrAgent[] => {
  const o = JSON.parse(stdout) as { result?: { type?: string; agents?: RawAgent[] } }
  if (o.result?.type !== 'agent_list' || !Array.isArray(o.result.agents)) throw new Error('not an agent_list')
  return o.result.agents.map(toAgent).filter(a => a.pane)
}

/** Every `agent_started` response in a command's stdout; herdr prints one JSON document per line. */
export const parseStarted = (stdout: string): HerdrAgent[] =>
  stdout.split('\n').flatMap(line => {
    const t = line.trim()
    if (!t.startsWith('{') || !t.includes('agent_started')) return []
    try {
      const o = JSON.parse(t) as { result?: { type?: string; agent?: RawAgent } }
      return o.result?.type === 'agent_started' && o.result.agent?.pane_id ? [toAgent(o.result.agent)] : []
    } catch {
      return []
    }
  })

/**
 * True when `herdr agent start` runs as a command. Quoted text is blanked first,
 * except a double-quoted string holding `$(`, whose command substitution runs.
 */
export const invokesAgentStart = (command: string): boolean => {
  const unquoted = command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\$]|\\.|\$(?!\())*"/g, '""')
  return /(?:^|[;&|(`\n]|\$\(|\b(?:if|then|do|else|time|exec)\s)\s*herdr\s+agent\s+start\b/.test(unquoted)
}

/** Agents in `after` on a pane `before` lacked, or on a pane that now runs another session. */
export const newAgents = (before: HerdrAgent[], after: HerdrAgent[]): HerdrAgent[] => {
  const seen = new Map(before.map(a => [a.pane, a.session]))
  return after.filter(a => !seen.has(a.pane) || (a.session !== '' && seen.get(a.pane) !== a.session))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (herdr.test.ts, 8 tests).

- [ ] **Step 6: Validate the manifest**

Run: `claude plugin validate agent-tree`
Expected: no errors (the stub module registers no hooks).

- [ ] **Step 7: Commit**

```bash
git add agent-tree/.claude-plugin/plugin.json agent-tree/hooks/hooks.json agent-tree/tsconfig.json agent-tree/types/index.d.ts agent-tree/hooks/herdr.ts agent-tree/hooks/herdr.test.ts agent-tree/hooks/register.tsx
git commit -F <scratchpad>/msg-task1.txt   # "agent-tree: scaffold and herdr output parsing"
```

---

### Task 2: Lineage ledger and the Bash spawn hook

**Files:**
- Create: `agent-tree/hooks/ledger.ts`
- Modify: `agent-tree/hooks/register.tsx` (replace the stub)
- Test: `agent-tree/hooks/ledger.test.ts`, `agent-tree/hooks/register.test.tsx`

**Interfaces:**
- Consumes: `parseAgentList`, `parseStarted`, `invokesAgentStart`, `newAgents` (Task 1); types `Edge`, `HerdrAgent`, `Panel`, `Snapshot`, `InProcRun`.
- Produces (`ledger.ts`): `WEEK_MS = 604_800_000`, `ledgerDir(home: string): string`, `edgeFileName(e: Edge): string`, `edgeAt(fileName: string): number` (NaN when not an edge file), `makeEdge(parent: string, parentSession: string, child: HerdrAgent, at: number): Edge`, `parseEdge(text: string): Edge | null`.
- Produces (`register.tsx`): `PANE = 'agent-tree'`, atoms `snapshot`, `panel`, `frame`, `inproc`, `edgeCount`; `EMPTY_SNAPSHOT: Snapshot`; `listAgents($): Promise<HerdrAgent[] | null>`; `recordEdges($, root: string, parentSession: string, started: HerdrAgent[]): Promise<void>`; `loadEdges($, home: string, at: number): Promise<Edge[]>`; the Bash `tool.call` hook.

- [ ] **Step 1: Write the failing ledger tests**

`agent-tree/hooks/ledger.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { edgeAt, edgeFileName, ledgerDir, makeEdge, parseEdge } from './ledger'

const child = { pane: 'wCK:p8', name: 'udci-i156-impl', harness: 'pi', status: 'working' as const, title: '', label: '', cwd: '/w', workspace: 'wCK', session: 's', terminal: 't' }

describe('ledger', () => {
  test('dir under HOME', () => {
    expect(ledgerDir('/Users/me')).toBe('/Users/me/.local/state/agent-tree/edges')
  })

  test('file name: time first, pane id made filename-safe, and edgeAt reads it back', () => {
    const e = makeEdge('w9:p1A', 'sess', child, 1791486939969)
    expect(edgeFileName(e)).toBe('1791486939969-wCK_p8.json')
    expect(edgeAt('1791486939969-wCK_p8.json')).toBe(1791486939969)
    expect(Number.isNaN(edgeAt('notes.txt'))).toBe(true)
  })

  test('makeEdge then parseEdge round-trips', () => {
    const e = makeEdge('w9:p1A', 'sess', child, 5)
    expect(e).toEqual({ v: 1, parent: 'w9:p1A', parentSession: 'sess', child: 'wCK:p8', name: 'udci-i156-impl', via: 'claude-mod', at: 5 })
    expect(parseEdge(JSON.stringify(e))).toEqual(e)
  })

  test('parseEdge refuses other versions, missing fields and junk', () => {
    expect(parseEdge('{"v":2,"parent":"a","child":"b","at":1}')).toBeNull()
    expect(parseEdge('{"v":1,"parent":"a","at":1}')).toBeNull()
    expect(parseEdge('}{')).toBeNull()
    expect(parseEdge('{"v":1,"parent":"a","child":"b","at":1}')).toEqual({ v: 1, parent: 'a', parentSession: '', child: 'b', name: '', via: '', at: 1 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./ledger`.

- [ ] **Step 3: Write `hooks/ledger.ts`**

```ts
import type { Edge, HerdrAgent } from '../types'

export const WEEK_MS = 604_800_000

export const ledgerDir = (home: string): string => `${home}/.local/state/agent-tree/edges`

export const edgeFileName = (e: Edge): string => `${e.at}-${e.child.replace(/[^A-Za-z0-9]/g, '_')}.json`

/** The spawn time an edge file's name starts with; NaN for any other file. */
export const edgeAt = (fileName: string): number => {
  const m = /^(\d+)-.+\.json$/.exec(fileName)
  return m ? Number(m[1]) : NaN
}

export const makeEdge = (parent: string, parentSession: string, child: HerdrAgent, at: number): Edge => ({
  v: 1,
  parent,
  parentSession,
  child: child.pane,
  name: child.name,
  via: 'claude-mod',
  at,
})

export const parseEdge = (text: string): Edge | null => {
  try {
    const o = JSON.parse(text) as Partial<Edge>
    if (o.v !== 1 || typeof o.parent !== 'string' || typeof o.child !== 'string' || typeof o.at !== 'number') return null
    return {
      v: 1,
      parent: o.parent,
      parentSession: String(o.parentSession ?? ''),
      child: o.child,
      name: String(o.name ?? ''),
      via: String(o.via ?? ''),
      at: o.at,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run ledger tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS for ledger.test.ts.

- [ ] **Step 5: Write the failing hook tests (with the negative control)**

`agent-tree/hooks/register.test.tsx`:
```tsx
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
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const bash = (stdout: string) => async () => ({ result: { stdout, stderr: '', interrupted: false } })

describe('Bash spawn hook', () => {
  test('herdr agent start output writes one edge', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    const writes: { path: string; text: string }[] = []
    on('fs.write', async (_$, e) => {
      writes.push({ path: e.path, text: e.text })
    })
    on('process.run', async () => ok(list(ROOT)))
    on('tool.call', { tool: 'Bash' }, bash(`${STARTED}\n`))

    await $.tool.call({ tool: 'Bash', command: 'herdr agent start demo-impl --kind claude --pane wX:p2' })

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toMatch(/^\/home\/me\/\.local\/state\/agent-tree\/edges\/\d+-wX_p2\.json$/)
    expect(JSON.parse(writes[0]?.text ?? '')).toMatchObject({ v: 1, parent: 'w9:p1', parentSession: 'root-session', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod' })
  })

  test('swallowed output: the before/after list diff finds the new pane', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
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
    const writes: string[] = []
    on('fs.write', async (_$, e) => {
      writes.push(e.text)
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
    })
    on('tool.call', { tool: 'Bash' }, bash(STARTED))

    await $.tool.call({ tool: 'Bash', command: 'herdr agent start demo --kind claude --pane wX:p2' })

    expect(writes).toEqual([])
  })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL. The stub registers no hook, so `writes` has length 0 in the first two tests.

- [ ] **Step 7: Replace `hooks/register.tsx` with the ledger wiring**

```tsx
import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Edge, HerdrAgent, InProcRun, Panel, Snapshot } from '../types'
import { invokesAgentStart, newAgents, parseAgentList, parseStarted } from './herdr'
import { WEEK_MS, edgeAt, edgeFileName, ledgerDir, makeEdge, parseEdge } from './ledger'

export const PANE = 'agent-tree'
export const PANE_TITLE = 'Agent tree'

export const EMPTY_SNAPSHOT: Snapshot = { at: 0, root: '', nodes: [], all: [], repos: {}, batch: null, error: '' }

export const snapshot = atom({ plugin: 'agent-tree', key: 'snapshot' } as const, EMPTY_SNAPSHOT)
export const panel = atom({ plugin: 'agent-tree', key: 'panel' } as const, {
  mode: 'tree',
  compact: 'auto',
  isFinishedOpen: false,
  isInProcessOpen: false,
  isAutoOpened: false,
} as Panel)
export const frame = atom({ plugin: 'agent-tree', key: 'frame' } as const, 0)
export const inproc = atom({ plugin: 'agent-tree', key: 'inproc' } as const, [] as InProcRun[])
export const edgeCount = atom({ plugin: 'agent-tree', key: 'edgeCount' } as const, 0)

// Module caches: a reload starts them over, which only costs a re-read.
const edgeCache = new Map<string, Edge | null>()

/** `herdr agent list`, or null when herdr does not answer. */
export async function listAgents($: EngineInterface): Promise<HerdrAgent[] | null> {
  try {
    const r = await $.process.run(['herdr', 'agent', 'list'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? parseAgentList(r.stdout) : null
  } catch {
    return null
  }
}

/** Edge files of the last week; unreadable or foreign files are skipped. */
export async function loadEdges($: EngineInterface, home: string, at: number): Promise<Edge[]> {
  const dir = ledgerDir(home)
  let names: string[]
  try {
    names = (await $.fs.list(dir)).filter(f => f.kind === 'file').map(f => f.name)
  } catch {
    return []
  }
  const edges: Edge[] = []
  for (const name of names) {
    const t = edgeAt(name)
    if (!Number.isFinite(t) || t < at - WEEK_MS) continue
    if (!edgeCache.has(name)) {
      edgeCache.set(name, await $.fs.read(`${dir}/${name}`).then(text => parseEdge(String(text)), () => null))
    }
    const e = edgeCache.get(name)
    if (e) edges.push(e)
  }
  return edges
}

export async function recordEdges($: EngineInterface, root: string, parentSession: string, started: HerdrAgent[]): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  const at = await $.clock.now()
  for (const child of started) {
    const edge = makeEdge(root, parentSession, child, at)
    await $.fs.write(`${ledgerDir(home)}/${edgeFileName(edge)}`, JSON.stringify(edge))
    edgeCache.set(edgeFileName(edge), edge)
  }
  await update($, edgeCount, n => n + started.length)
}

export const register: Register = on => {
  // A spawn from this session becomes an edge. The call itself is never held up or refused.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!invokesAgentStart(String(e.command ?? ''))) return next(e)
    const root = await $.env.get('HERDR_PANE_ID')
    if (!root) return next(e)

    const before = await listAgents($)
    const res = await next(e)
    try {
      const out = res.result as { stdout?: unknown } | undefined
      let started = parseStarted(typeof out?.stdout === 'string' ? out.stdout : '')
      if (!started.length && before) {
        const after = await listAgents($)
        if (after) started = newAgents(before, after).filter(a => a.pane !== root)
      }
      if (started.length) {
        const parentSession = before?.find(a => a.pane === root)?.session ?? ''
        await recordEdges($, root, parentSession, started)
      }
    } catch {
      $.ui.toast('agent-tree: the new worker was not recorded')
    }
    return res
  })
}
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (herdr, ledger, register: 4 hook tests).

- [ ] **Step 9: Negative control on the guard**

Temporarily change the first line of the hook to skip the `invokesAgentStart` check (`if (false) return next(e)`). Run `claude plugin test agent-tree`. Expected: "negative control" FAILS (one write). Restore the line, re-run, PASS. Paste both outputs in the task report.

- [ ] **Step 10: Commit**

```bash
git add agent-tree/hooks/ledger.ts agent-tree/hooks/ledger.test.ts agent-tree/hooks/register.tsx agent-tree/hooks/register.test.tsx
git commit -F <scratchpad>/msg-task2.txt   # "agent-tree: lineage ledger and Bash spawn hook"
```

---

### Task 3: Tree building

**Files:**
- Create: `agent-tree/hooks/tree.ts`
- Test: `agent-tree/hooks/tree.test.ts`

**Interfaces:**
- Consumes: `Edge`, `HerdrAgent`, `TreeNode`, `Role`, `NodeStatus`; `edgeFileName` (Task 2).
- Produces: `roleOf(name: string): Role`, `statusOf(a: HerdrAgent | null): NodeStatus`, `isLive(s: NodeStatus): boolean`, `buildTree(input: TreeInput): { nodes: TreeNode[]; bindings: Record<string, string> }` with `TreeInput = { root: string; edges: Edge[]; agents: HerdrAgent[]; bindings: Record<string, string>; previous: TreeNode[]; at: number }`, `partition(nodes: TreeNode[]): { tree: TreeNode[]; finished: TreeNode[] }`.

Rules (from the spec, deviation 4):
- Bindings map `edgeFileName(edge)` → herdr `terminal_id`, set on first sight of the child pane.
- A live node needs: the child pane in `agents`; this edge being the newest edge naming that pane; and the pane's terminal equal to the binding (or no binding yet).
- Otherwise the node is `gone`, and keeps `name`, `harness`, `title`, `cwd`, `session`, `usage`, `ticket` and `lastSeen` from the previous node with the same `pane` and `startedAt`. With no previous node, it uses the edge name and blanks.
- Live nodes also carry `usage` and `ticket` over from that previous node (Tasks 4–5 refresh them).
- Children of a node: edges whose `parent` is its pane and whose `at` is at or after its edge's `at` and before the next edge that names the same pane. Pre-order, siblings by `at`. `depth` 0 is a direct child of the root. A cycle stops at a pane already on the path.

- [ ] **Step 1: Write the failing tests**

`agent-tree/hooks/tree.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import type { Edge, HerdrAgent, TreeNode } from '../types'
import { edgeFileName } from './ledger'
import { buildTree, partition, roleOf, statusOf } from './tree'

const ag = (pane: string, over: Partial<HerdrAgent> = {}): HerdrAgent => ({
  pane,
  name: `n-${pane}`,
  harness: 'claude',
  status: 'working',
  title: '',
  label: '',
  cwd: '/w',
  workspace: 'w1',
  session: `s-${pane}`,
  terminal: `t-${pane}`,
  ...over,
})
const edge = (parent: string, child: string, at: number, name = `n-${child}`): Edge => ({ v: 1, parent, parentSession: '', child, name, via: 'claude-mod', at })
const build = (edges: Edge[], agents: HerdrAgent[], bindings: Record<string, string> = {}, previous: TreeNode[] = []) =>
  buildTree({ root: 'R', edges, agents, bindings, previous, at: 1000 })

describe('roleOf', () => {
  test('slot names from the team skills', () => {
    expect(roleOf('kintsugi-vhvf-lead')).toBe('lead')
    expect(roleOf('udci-i156-impl')).toBe('implementer')
    expect(roleOf('demo-implementer-2')).toBe('implementer')
    expect(roleOf('m5r-review')).toBe('reviewer')
    expect(roleOf('deepthought-i356-reviewer')).toBe('reviewer')
    expect(roleOf('udci-i172-fixer-r2')).toBe('fixer')
    expect(roleOf('m5c-w2-i062-fix3')).toBe('fixer')
    expect(roleOf('splash-res')).toBe('research')
    expect(roleOf('batch-integrator')).toBe('integrator')
    expect(roleOf('m5r-t1')).toBe('other')
    expect(roleOf('leader-board')).toBe('other')
  })
})

describe('statusOf', () => {
  test('herdr status first, then the DONE:/BLOCKED: title; working beats an old DONE title', () => {
    expect(statusOf(null)).toBe('gone')
    expect(statusOf(ag('a', { status: 'blocked' }))).toBe('blocked')
    expect(statusOf(ag('a', { status: 'working', title: 'DONE: old' }))).toBe('working')
    expect(statusOf(ag('a', { status: 'idle', title: 'DONE: merged' }))).toBe('done')
    expect(statusOf(ag('a', { status: 'done' }))).toBe('done')
    expect(statusOf(ag('a', { status: 'idle', title: 'BLOCKED: owner call' }))).toBe('blocked')
    expect(statusOf(ag('a', { status: 'unknown' }))).toBe('idle')
  })
})

describe('buildTree', () => {
  test('root → lead → workers, pre-order with depth and last-sibling marks', () => {
    const edges = [edge('R', 'L', 1), edge('L', 'W1', 2), edge('L', 'W2', 3), edge('X', 'Y', 4)]
    const { nodes } = build(edges, [ag('L'), ag('W1'), ag('W2'), ag('Y')])
    expect(nodes.map(n => [n.pane, n.depth, n.isLast])).toEqual([
      ['L', 0, true],
      ['W1', 1, false],
      ['W2', 1, true],
    ])
    expect(nodes[0]?.startedAt).toBe(1)
    expect(nodes[0]?.lastSeen).toBe(1000)
  })

  test('binds each edge to the terminal it first saw', () => {
    const e = edge('R', 'L', 1)
    const { bindings } = build([e], [ag('L')])
    expect(bindings).toEqual({ [edgeFileName(e)]: 't-L' })
  })

  test('a pane closed since: gone, keeping its last numbers', () => {
    const e = edge('R', 'L', 1)
    const prev = build([e], [ag('L', { title: 'BLOCKED: x' })]).nodes.map(n => ({ ...n, usage: { model: 'claude-opus-5-5', effort: 'high', contextTokens: 9, tokens: 99, costUsd: 1.5 }, lastSeen: 500 }))
    const { nodes } = build([e], [], { [edgeFileName(e)]: 't-L' }, prev)
    expect(nodes[0]).toMatchObject({ pane: 'L', status: 'gone', title: 'BLOCKED: x', lastSeen: 500, usage: { costUsd: 1.5 } })
  })

  test('a pane id reused by a new terminal is not adopted', () => {
    const e = edge('R', 'L', 1)
    const { nodes } = build([e], [ag('L', { terminal: 't-new' })], { [edgeFileName(e)]: 't-L' })
    expect(nodes[0]?.status).toBe('gone')
  })

  test('the newest edge owns a reused pane; the old lead does not inherit it', () => {
    const old = edge('R', 'L', 1, 'old-lead')
    const fresh = edge('R', 'L', 5, 'new-lead')
    const { nodes } = build([old, fresh], [ag('L', { name: 'new-lead' })])
    expect(nodes.map(n => [n.name, n.status])).toEqual([
      ['old-lead', 'gone'],
      ['new-lead', 'working'],
    ])
  })

  test('children belong to the incarnation that spawned them', () => {
    const edges = [edge('R', 'L', 1, 'old-lead'), edge('L', 'A', 2), edge('R', 'L', 5, 'new-lead'), edge('L', 'B', 6)]
    const { nodes } = build(edges, [ag('L'), ag('A'), ag('B')])
    expect(nodes.map(n => [n.name, n.depth])).toEqual([
      ['old-lead', 0],
      ['n-A', 1],
      ['new-lead', 0],
      ['n-B', 1],
    ])
  })

  test('a cycle stops', () => {
    const { nodes } = build([edge('R', 'A', 1), edge('A', 'B', 2), edge('B', 'A', 3)], [ag('A'), ag('B')])
    expect(nodes.map(n => n.pane)).toEqual(['A', 'B'])
  })
})

describe('partition', () => {
  test('finished = done or gone with nothing live below; a lead with live workers stays in the tree', () => {
    const edges = [edge('R', 'L', 1), edge('L', 'W1', 2), edge('R', 'D', 3)]
    const { nodes } = build(edges, [ag('L', { status: 'idle', title: 'DONE: x' }), ag('W1'), ag('D', { status: 'done' })])
    const { tree, finished } = partition(nodes)
    expect(tree.map(n => n.pane)).toEqual(['L', 'W1'])
    expect(finished.map(n => n.pane)).toEqual(['D'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./tree`.

- [ ] **Step 3: Write `hooks/tree.ts`**

```ts
import type { Edge, HerdrAgent, NodeStatus, Role, TreeNode } from '../types'
import { edgeFileName } from './ledger'

const ROLES: [Role, RegExp][] = [
  ['lead', /(^|[-_])lead($|[-_\d])/],
  ['implementer', /(^|[-_])(impl|implementer)($|[-_\d])/],
  ['reviewer', /(^|[-_])(review|reviewer|rereview)($|[-_\d])/],
  ['fixer', /(^|[-_])(fix|fixer)($|[-_\d])/],
  ['integrator', /(^|[-_])(integrate|integrator)($|[-_\d])/],
  ['research', /(^|[-_])(res|research|researcher)($|[-_\d])/],
]

export const roleOf = (name: string): Role => ROLES.find(([, re]) => re.test(name.toLowerCase()))?.[0] ?? 'other'

export const statusOf = (a: HerdrAgent | null): NodeStatus => {
  if (!a) return 'gone'
  if (a.status === 'blocked') return 'blocked'
  if (a.status === 'working') return 'working'
  if (a.status === 'done' || /^DONE:/i.test(a.title)) return 'done'
  if (/^BLOCKED:/i.test(a.title)) return 'blocked'
  return 'idle'
}

export const isLive = (s: NodeStatus): boolean => s === 'working' || s === 'idle' || s === 'blocked'

export type TreeInput = {
  root: string
  edges: Edge[]
  agents: HerdrAgent[]
  bindings: Record<string, string>
  previous: TreeNode[]
  at: number
}

export const buildTree = (input: TreeInput): { nodes: TreeNode[]; bindings: Record<string, string> } => {
  const { root, edges, agents, previous, at } = input
  const bindings = { ...input.bindings }
  const byPane = new Map(agents.map(a => [a.pane, a]))
  const sorted = [...edges].sort((a, b) => a.at - b.at)
  // Every edge naming a pane, oldest first: the incarnations of that pane.
  const incarnations = new Map<string, Edge[]>()
  for (const e of sorted) incarnations.set(e.child, [...(incarnations.get(e.child) ?? []), e])

  const nextIncarnationAt = (e: Edge): number => incarnations.get(e.child)?.find(x => x.at > e.at)?.at ?? Infinity
  const nodes: TreeNode[] = []

  const visit = (pane: string, from: number, until: number, depth: number, path: Set<string>) => {
    const kids = sorted.filter(e => e.parent === pane && e.at >= from && e.at < until && !path.has(e.child))
    kids.forEach((e, i) => {
      const key = edgeFileName(e)
      const isNewest = nextIncarnationAt(e) === Infinity
      const a = byPane.get(e.child)
      const bound = bindings[key]
      const holder = a && isNewest && (bound === undefined || bound === a.terminal) ? a : null
      if (holder && bound === undefined) bindings[key] = holder.terminal
      const prev = previous.find(p => p.pane === e.child && p.startedAt === e.at)
      nodes.push({
        pane: e.child,
        parent: e.parent,
        depth,
        isLast: i === kids.length - 1,
        name: holder?.name || prev?.name || e.name || e.child,
        harness: holder?.harness ?? prev?.harness ?? '',
        role: roleOf(holder?.name || prev?.name || e.name),
        status: statusOf(holder),
        title: holder?.title ?? prev?.title ?? '',
        cwd: holder?.cwd ?? prev?.cwd ?? '',
        session: holder?.session ?? prev?.session ?? '',
        startedAt: e.at,
        lastSeen: holder ? at : (prev?.lastSeen ?? e.at),
        usage: prev?.usage ?? null,
        ticket: prev?.ticket ?? '',
      })
      visit(e.child, e.at, nextIncarnationAt(e), depth + 1, new Set([...path, e.child]))
    })
  }
  visit(root, -Infinity, Infinity, 0, new Set([root]))
  return { nodes, bindings }
}

/** Finished: done or gone with nothing live below it. The rest stays in the tree. */
export const partition = (nodes: TreeNode[]): { tree: TreeNode[]; finished: TreeNode[] } => {
  const liveBelow = (i: number): boolean => {
    const d = nodes[i]?.depth ?? 0
    for (let j = i + 1; j < nodes.length && (nodes[j]?.depth ?? 0) > d; j++) if (isLive(nodes[j]?.status ?? 'gone')) return true
    return false
  }
  const tree: TreeNode[] = []
  const finished: TreeNode[] = []
  nodes.forEach((n, i) => (isLive(n.status) || liveBelow(i) ? tree : finished).push(n))
  return { tree, finished }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (tree.test.ts, 10 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-tree/hooks/tree.ts agent-tree/hooks/tree.test.ts
git commit -F <scratchpad>/msg-task3.txt   # "agent-tree: build the spawn tree from the ledger"
```

---

### Task 4: Transcript usage and cost

**Files:**
- Create: `agent-tree/hooks/usage.ts`
- Test: `agent-tree/hooks/usage.test.ts`

**Interfaces:**
- Consumes: `Usage`.
- Produces: `costOf(model: string, u: RawUsage): number`, `windowOf(model: string): number`, `modelName(id: string): string`, `fmtTokens(n)`, `fmtCost(usd)`, `fmtTime(ms)`, `UsageAcc` (`Usage & { ids: string[]; byId: Record<string, [number, number]> }`), `emptyUsage(): UsageAcc`, `addTranscript(acc: UsageAcc, text: string): UsageAcc`, `toUsage(acc: UsageAcc): Usage`, `projectDirName(cwd: string): string`, `transcriptPath(home: string, cwd: string, session: string): string`, `wholeLines(chunk: string): { text: string; bytes: number }`, `CHUNK_BYTES = 2_000_000`.

Transcript facts (sampled 2026-10-08 from a live session): assistant lines are `{"type":"assistant","isSidechain":false,"effort":"high","message":{"id":"msg_…","model":"claude-fable-5-1","usage":{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, …}}}`. A streamed message can appear on several lines with the same `message.id`; the last one counts. The project dir name is the session's cwd with every non-alphanumeric character turned into `-` (`/Users/ldh/Projects/github.com/praxis` → `-Users-ldh-Projects-github-com-praxis`).

- [ ] **Step 1: Write the failing tests**

`agent-tree/hooks/usage.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { addTranscript, costOf, emptyUsage, fmtCost, fmtTime, fmtTokens, modelName, projectDirName, toUsage, transcriptPath, wholeLines } from './usage'

const line = (id: string, model: string, u: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, effort: 'high', message: { id, model, usage: u }, ...extra })

describe('addTranscript', () => {
  test('latest context, summed tokens and cost; a repeated message id replaces its earlier line', () => {
    const u1 = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 5 }
    const u1b = { ...u1, output_tokens: 50 }
    const u2 = { input_tokens: 20, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100, output_tokens: 7 }
    const text = [line('m1', 'claude-opus-5-5', u1), line('m1', 'claude-opus-5-5', u1b), '{"type":"user"}', 'garbage', line('m2', 'claude-opus-5-5', u2), ''].join('\n')
    const got = toUsage(addTranscript(emptyUsage(), text))
    expect(got.model).toBe('claude-opus-5-5')
    expect(got.effort).toBe('high')
    expect(got.contextTokens).toBe(2127)
    expect(got.tokens).toBe(1060 + 2127)
    expect(Math.abs(got.costUsd - (costOf('claude-opus-5-5', u1b) + costOf('claude-opus-5-5', u2)))).toBeLessThan(1e-9)
  })

  test('sidechain lines (in-session subagents) are not this agent', () => {
    const got = toUsage(addTranscript(emptyUsage(), line('m9', 'claude-haiku-5-5', { input_tokens: 99, output_tokens: 1 }, { isSidechain: true })))
    expect(got.tokens).toBe(0)
  })

  test('feeding a transcript in two pieces equals feeding it whole', () => {
    const a = line('m1', 'claude-sonnet-5-5', { input_tokens: 1, output_tokens: 1 })
    const b = line('m2', 'claude-sonnet-5-5', { input_tokens: 2, output_tokens: 2 })
    expect(toUsage(addTranscript(addTranscript(emptyUsage(), a + '\n'), b + '\n'))).toEqual(toUsage(addTranscript(emptyUsage(), `${a}\n${b}\n`)))
  })
})

describe('wholeLines', () => {
  test('cuts after the last newline and counts UTF-8 bytes', () => {
    expect(wholeLines('ab\ncd')).toEqual({ text: 'ab\n', bytes: 3 })
    expect(wholeLines('é\n')).toEqual({ text: 'é\n', bytes: 3 })
    expect(wholeLines('no newline yet')).toEqual({ text: '', bytes: 0 })
  })
})

describe('paths and formats', () => {
  test('transcript path from cwd and session', () => {
    expect(projectDirName('/Users/ldh/Projects/github.com/praxis')).toBe('-Users-ldh-Projects-github-com-praxis')
    expect(transcriptPath('/Users/ldh', '/Users/ldh/x.y', 'abc')).toBe('/Users/ldh/.claude/projects/-Users-ldh-x-y/abc.jsonl')
  })

  test('model names and numbers', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(12_400)).toBe('12k')
    expect(fmtTokens(3_100_000)).toBe('3.1M')
    expect(fmtCost(1.234)).toBe('$1.23')
    expect(fmtCost(14.2)).toBe('$14.2')
    expect(fmtTime(65_000)).toBe('1:05')
    expect(fmtTime(6_130_000)).toBe('1:42:10')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./usage`.

- [ ] **Step 3: Write `hooks/usage.ts`**

Price table, `modelName` and the formatters are taken from savvy-progress 1.2.0 (`~/.claude/plugins/cache/claude-kit/savvy-progress/1.2.0/hooks/register.tsx` lines 297–357, MIT).

```ts
import type { Usage } from '../types'

export type RawUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// USD per million tokens: input, output, cache read, cache write (5-minute TTL).
// The engine reports tokens, not money: the cost is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

const priceOf = (model: string): [number, number, number, number] => PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

export const costOf = (model: string, u: RawUsage): number => {
  const [i, o, r, w] = priceOf(model)
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
}

export const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

export const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export type UsageAcc = Usage & { ids: string[]; byId: Record<string, [number, number]> }

export const emptyUsage = (): UsageAcc => ({ model: '', effort: '', contextTokens: 0, tokens: 0, costUsd: 0, ids: [], byId: {} })

const KEEP_IDS = 200

type Line = { type?: string; isSidechain?: boolean; effort?: unknown; message?: { id?: string; model?: string; usage?: RawUsage } }

export const addTranscript = (acc: UsageAcc, text: string): UsageAcc => {
  const next: UsageAcc = { ...acc, ids: [...acc.ids], byId: { ...acc.byId } }
  for (const raw of text.split('\n')) {
    if (!raw.includes('"usage"')) continue
    let o: Line
    try {
      o = JSON.parse(raw) as Line
    } catch {
      continue
    }
    const u = o.message?.usage
    if (o.type !== 'assistant' || o.isSidechain || !u) continue
    const model = o.message?.model || next.model
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
    const cost = costOf(model, u)
    next.model = model
    next.contextTokens = ctx
    if (typeof o.effort === 'string') next.effort = o.effort
    const id = o.message?.id ?? ''
    const prev = id ? next.byId[id] : undefined
    if (prev) {
      next.tokens -= prev[0]
      next.costUsd -= prev[1]
    } else if (id) {
      next.ids.push(id)
    }
    if (id) next.byId[id] = [ctx, cost]
    next.tokens += ctx
    next.costUsd += cost
  }
  while (next.ids.length > KEEP_IDS) delete next.byId[next.ids.shift() ?? '']
  return next
}

export const toUsage = (acc: UsageAcc): Usage => ({ model: acc.model, effort: acc.effort, contextTokens: acc.contextTokens, tokens: acc.tokens, costUsd: acc.costUsd })

export const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

export const transcriptPath = (home: string, cwd: string, session: string): string => `${home}/.claude/projects/${projectDirName(cwd)}/${session}.jsonl`

export const CHUNK_BYTES = 2_000_000

/** The whole lines of a chunk, and how many bytes they take on disk. */
export const wholeLines = (chunk: string): { text: string; bytes: number } => {
  const text = chunk.slice(0, chunk.lastIndexOf('\n') + 1)
  return { text, bytes: new TextEncoder().encode(text).length }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (usage.test.ts, 6 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-tree/hooks/usage.ts agent-tree/hooks/usage.test.ts
git commit -F <scratchpad>/msg-task4.txt   # "agent-tree: transcript usage and cost"
```

---

### Task 5: Repos and tickets

**Files:**
- Create: `agent-tree/hooks/tickets.ts`
- Test: `agent-tree/hooks/tickets.test.ts`

**Interfaces:**
- Consumes: `BatchCounts`.
- Produces: `Ticket = { file: string; id: string; status: string; batch: string; workspace: string }`, `parseTicketGrep(stdout: string): Ticket[]`, `ticketFor(tickets: Ticket[], cwd: string): Ticket | null`, `batchStamp(batch: string): string`, `batchCounts(tickets: Ticket[], stamp: string): BatchCounts`, `repoFromCommonDir(stdout: string, cwd: string): string`, `repoName(path: string): string`, `TICKET_GREP_ARGV(issuesDir: string): string[]`.

Ticket facts (sampled): frontmatter keys `id: I028`, `status: fixed|in-progress|open|done|closed|resolved|superseded|wontfix|…`, `batch: 2026-09-22-rvw1#5` (sometimes quoted), `workspace: /abs/path` (only while in progress).

- [ ] **Step 1: Write the failing tests**

`agent-tree/hooks/tickets.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { TICKET_GREP_ARGV, batchCounts, batchStamp, parseTicketGrep, repoFromCommonDir, repoName, ticketFor } from './tickets'

const GREP = [
  '/r/docs/issues/I001-a.md:id: I001',
  '/r/docs/issues/I001-a.md:status: in-progress',
  '/r/docs/issues/I001-a.md:batch: "2026-10-08-hne7#1"',
  '/r/docs/issues/I001-a.md:workspace: /Users/me/worktrees/r-i001/',
  '/r/docs/issues/I001-a.md:status: body text that also starts with status',
  '/r/docs/issues/I002-b.md:id: I002',
  '/r/docs/issues/I002-b.md:status: fixed',
  '/r/docs/issues/I002-b.md:batch: 2026-10-08-hne7#2',
  '/r/docs/issues/I003-c.md:id: I003',
  '/r/docs/issues/I003-c.md:status: open',
  '/r/docs/issues/I003-c.md:batch: 2026-10-08-hne7#3',
  '/r/docs/issues/I004-d.md:id: I004',
  '/r/docs/issues/I004-d.md:status: open',
  '/r/docs/issues/_template.md:status: open',
].join('\n')

describe('tickets', () => {
  test('first value of each key wins; quotes stripped; files without an id dropped', () => {
    const t = parseTicketGrep(GREP)
    expect(t.map(x => x.id)).toEqual(['I001', 'I002', 'I003', 'I004'])
    expect(t[0]).toEqual({ file: '/r/docs/issues/I001-a.md', id: 'I001', status: 'in-progress', batch: '2026-10-08-hne7#1', workspace: '/Users/me/worktrees/r-i001/' })
  })

  test('a worker finds its ticket by workspace, trailing slash or not', () => {
    const t = parseTicketGrep(GREP)
    expect(ticketFor(t, '/Users/me/worktrees/r-i001')?.id).toBe('I001')
    expect(ticketFor(t, '/elsewhere')).toBeNull()
  })

  test('batch counts by stamp', () => {
    const t = parseTicketGrep(GREP)
    expect(batchStamp('2026-10-08-hne7#3')).toBe('2026-10-08-hne7')
    expect(batchCounts(t, '2026-10-08-hne7')).toEqual({ stamp: '2026-10-08-hne7', fixed: 1, inProgress: 1, open: 1, total: 3 })
  })

  test('grep argv reads only the four keys', () => {
    expect(TICKET_GREP_ARGV('/r/docs/issues')).toEqual(['grep', '-rH', '-E', '^(id|status|batch|workspace):', '--include=*.md', '/r/docs/issues'])
  })
})

describe('repos', () => {
  test('main repo from git common dir; worktrees fold in', () => {
    expect(repoFromCommonDir('/Users/me/p/kintsugi/.git\n', '/Users/me/worktrees/kintsugi-vhvf')).toBe('/Users/me/p/kintsugi')
    expect(repoFromCommonDir('', '/tmp/x')).toBe('/tmp/x')
    expect(repoName('/Users/me/p/kintsugi')).toBe('kintsugi')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./tickets`.

- [ ] **Step 3: Write `hooks/tickets.ts`**

```ts
import type { BatchCounts } from '../types'

export type Ticket = { file: string; id: string; status: string; batch: string; workspace: string }

type Key = 'id' | 'status' | 'batch' | 'workspace'

export const TICKET_GREP_ARGV = (issuesDir: string): string[] => ['grep', '-rH', '-E', '^(id|status|batch|workspace):', '--include=*.md', issuesDir]

/** `grep -rH` lines `<file>:<key>: <value>`; the first value per file and key wins (frontmatter comes first). */
export const parseTicketGrep = (stdout: string): Ticket[] => {
  const byFile = new Map<string, Ticket>()
  for (const line of stdout.split('\n')) {
    const m = /^(.+?\.md):(id|status|batch|workspace):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, file = '', key = 'id', raw = ''] = m
    const t = byFile.get(file) ?? { file, id: '', status: '', batch: '', workspace: '' }
    if (!t[key as Key]) t[key as Key] = raw.trim().replace(/^["']|["']$/g, '')
    byFile.set(file, t)
  }
  return [...byFile.values()].filter(t => t.id)
}

const trimSlash = (p: string): string => p.replace(/\/+$/, '')

export const ticketFor = (tickets: Ticket[], cwd: string): Ticket | null =>
  tickets.find(t => t.workspace && trimSlash(t.workspace) === trimSlash(cwd)) ?? null

export const batchStamp = (batch: string): string => batch.split('#')[0]?.trim() ?? ''

const CLOSED = new Set(['fixed', 'done', 'closed', 'resolved', 'superseded', 'wontfix'])

export const batchCounts = (tickets: Ticket[], stamp: string): BatchCounts => {
  const members = tickets.filter(t => batchStamp(t.batch) === stamp)
  const fixed = members.filter(t => CLOSED.has(t.status)).length
  const inProgress = members.filter(t => t.status === 'in-progress').length
  return { stamp, fixed, inProgress, open: members.length - fixed - inProgress, total: members.length }
}

/** `git rev-parse --path-format=absolute --git-common-dir` output → the main checkout; else the cwd itself. */
export const repoFromCommonDir = (stdout: string, cwd: string): string => {
  const dir = stdout.trim()
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : dir || cwd
}

export const repoName = (path: string): string => trimSlash(path).split('/').pop() || path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (tickets.test.ts, 5 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-tree/hooks/tickets.ts agent-tree/hooks/tickets.test.ts
git commit -F <scratchpad>/msg-task5.txt   # "agent-tree: ticket and repo lookup"
```

---

### Task 6: Half-block crabs

**Files:**
- Create: `agent-tree/hooks/crab.ts`
- Test: `agent-tree/hooks/crab.test.ts`

**Interfaces:**
- Consumes: `TreeNode`, `BatchCounts`, `Role`.
- Produces: `Segment = { text: string; fg?: string; bg?: string }`, `PALETTE`, `halfBlock(rows: string[]): Segment[][]`, `Mood = 'typing' | 'review' | 'blocked' | 'asleep' | 'party'`, `moodOf(nodes: TreeNode[], batch: BatchCounts | null): Mood`, `spriteFor(mood: Mood, frame: number): string[]`, `moodTag(mood: Mood, frame: number): { text: string; color: string }`, `ROLE_COLOR: Record<Role, string>`, `MINI = '▟▙'`, `CRAB_ROWS = 4` (terminal rows the hero takes).

Each sprite is 16 px wide and 8 px tall, which makes 16 columns × 4 rows. `.` is transparent; the other letters are `PALETTE` keys. Two pixels share one cell: `▀` takes the top pixel as foreground and the bottom one as background, and `▄` is used when only the bottom pixel is set.

- [ ] **Step 1: Write the failing tests**

`agent-tree/hooks/crab.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import type { TreeNode } from '../types'
import { CRAB_ROWS, PALETTE, halfBlock, moodOf, spriteFor } from './crab'

const node = (status: TreeNode['status'], role: TreeNode['role'] = 'implementer'): TreeNode => ({
  pane: 'p', parent: 'R', depth: 0, isLast: true, name: 'n', harness: 'claude', role, status,
  title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '',
})

describe('halfBlock', () => {
  test('two pixel rows per cell row, runs merged', () => {
    expect(halfBlock(['cc.k', '.c.k'])).toEqual([
      [
        { text: '▀', fg: PALETTE.c },
        { text: '▀', fg: PALETTE.c, bg: PALETTE.c },
        { text: ' ' },
        { text: '▀', fg: PALETTE.k, bg: PALETTE.k },
      ],
    ])
    expect(halfBlock(['..', 'cc'])).toEqual([[{ text: '▄▄', fg: PALETTE.c }]])
  })

  test('every sprite of every mood is 16 wide and CRAB_ROWS tall, in both frames', () => {
    for (const mood of ['typing', 'review', 'blocked', 'asleep', 'party'] as const) {
      for (const f of [0, 1]) {
        const rows = spriteFor(mood, f)
        expect(rows).toHaveLength(CRAB_ROWS * 2)
        for (const r of rows) expect(r).toHaveLength(16)
        for (const ch of rows.join('')) expect(ch === '.' || ch in PALETTE).toBe(true)
      }
    }
  })

  test('typing alternates claws', () => {
    expect(spriteFor('typing', 0)).not.toEqual(spriteFor('typing', 1))
  })
})

describe('moodOf', () => {
  test('party > blocked > review-only > typing > asleep', () => {
    expect(moodOf([node('working')], { stamp: 's', fixed: 3, inProgress: 0, open: 0, total: 3 })).toBe('party')
    expect(moodOf([node('working'), node('blocked')], null)).toBe('blocked')
    expect(moodOf([node('working', 'reviewer'), node('idle')], null)).toBe('review')
    expect(moodOf([node('working', 'reviewer'), node('working')], null)).toBe('typing')
    expect(moodOf([node('idle'), node('gone')], null)).toBe('asleep')
    expect(moodOf([], null)).toBe('asleep')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./crab`.

- [ ] **Step 3: Write `hooks/crab.ts`**

```ts
import type { BatchCounts, Role, TreeNode } from '../types'

export type Segment = { text: string; fg?: string; bg?: string }

// Clay body and ink eyes from savvy-progress's pixel Clawd (after DockCrab).
export const PALETTE: Record<string, string> = {
  c: '#D97757', // clay body
  k: '#1F1E1D', // ink: eyes, magnifier rim
  b: '#4A4A48', // keyboard
  w: '#C9CCD2', // keys
  g: '#A9D6F5', // glass
  s: '#6FA8DC', // sweat, confetti
  y: '#F5C542', // confetti
  p: '#B48EF0', // confetti
}

export const CRAB_ROWS = 4

const KEYBOARD = ['bbbbbbbbbbbbbbbb', 'bwbwbwbwbwbwbwbb', 'bbbbbbbbbbbbbbbb']
const EMPTY = '................'

const SPRITES = {
  typingA: ['cc..............', '.cc.cccccccc....', '...cckcccckcc...', '...cccccccccc.c.', '....c.c..c.c.cc.', ...KEYBOARD],
  typingB: ['..............cc', '....cccccccc.cc.', '...cckcccckcc...', '.c.cccccccccc...', '.cc.c.c..c.c....', ...KEYBOARD],
  review: ['...........kkk..', '....ccccccckgggk', '...cckcccckkgggk', '...ccccccccckkk.', '....c.c..c.cc...', EMPTY, EMPTY, EMPTY],
  blocked: ['.............s..', '....cccccccc.ss.', '...cckcccckcc...', '.c.cccccccccc.c.', '.cc.c.c..c.c.cc.', ...KEYBOARD],
  asleep: [EMPTY, '....cccccccc....', '...cccccccccc...', '.c.ckkcccckkc.c.', '.cc.c.c..c.c.cc.', ...KEYBOARD],
  party: ['cc.y......p...cc', '.cc.cccccccc.cc.', '...cckcccckcc...', '.s.cccccccccc.y.', '....c.c..c.c....', '..p.....y....s..', EMPTY, EMPTY],
} as const

export type Mood = 'typing' | 'review' | 'blocked' | 'asleep' | 'party'

export const spriteFor = (mood: Mood, frame: number): string[] => {
  if (mood === 'typing') return [...(frame % 2 ? SPRITES.typingB : SPRITES.typingA)]
  return [...SPRITES[mood]]
}

export const moodTag = (mood: Mood, frame: number): { text: string; color: string } => {
  if (mood === 'blocked') return { text: '!', color: '#D0453F' }
  if (mood === 'asleep') return { text: 'z', color: '#9a9a96' }
  if (mood === 'party') return { text: frame % 2 ? '✦' : '★', color: '#F5C542' }
  if (mood === 'review') return { text: '?', color: '#D85A30' }
  return { text: '', color: '' }
}

export const moodOf = (nodes: TreeNode[], batch: BatchCounts | null): Mood => {
  if (batch && batch.total > 0 && batch.fixed === batch.total) return 'party'
  const live = nodes.filter(n => n.status !== 'gone')
  if (live.some(n => n.status === 'blocked')) return 'blocked'
  const working = live.filter(n => n.status === 'working')
  if (working.length && working.every(n => n.role === 'reviewer')) return 'review'
  return working.length ? 'typing' : 'asleep'
}

/** Pixel rows → cell rows: two pixels per cell, runs of equal cells merged. */
export const halfBlock = (rows: string[]): Segment[][] => {
  const out: Segment[][] = []
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y] ?? ''
    const bot = rows[y + 1] ?? ''
    const segs: Segment[] = []
    for (let x = 0; x < Math.max(top.length, bot.length); x++) {
      const t = PALETTE[top[x] ?? '.']
      const b = PALETTE[bot[x] ?? '.']
      const cell: Segment = !t && !b ? { text: ' ' } : t && !b ? { text: '▀', fg: t } : !t ? { text: '▄', fg: b } : { text: '▀', fg: t, bg: b }
      const last = segs[segs.length - 1]
      if (last && last.text[0] === cell.text && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else segs.push(cell)
    }
    out.push(segs)
  }
  return out
}

export const ROLE_COLOR: Record<Role, string> = {
  lead: '#7F77DD',
  implementer: '#378ADD',
  reviewer: '#D85A30',
  fixer: '#BA7517',
  integrator: '#1D9E75',
  research: '#B48EF0',
  other: '#888780',
}

export const MINI = '▟▙'
```

Note: `halfBlock` builds `Segment` objects with no `undefined` keys, so `toEqual` against `{ text: ' ' }` holds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (crab.test.ts, 4 tests). If a sprite row is not 16 wide, fix that sprite row, not the test.

- [ ] **Step 5: Commit**

```bash
git add agent-tree/hooks/crab.ts agent-tree/hooks/crab.test.ts
git commit -F <scratchpad>/msg-task6.txt   # "agent-tree: half-block crab sprites and moods"
```

---

### Task 7: Refresh loop, pane, command, status line, focus

**Files:**
- Create: `agent-tree/hooks/view.ts`
- Create: `agent-tree/hooks/pane.tsx`
- Modify: `agent-tree/hooks/register.tsx` (add refresh, timers, command, render)
- Test: `agent-tree/hooks/view.test.ts`, `agent-tree/hooks/register.test.tsx` (append)

**Interfaces:**
- Consumes: everything above.
- Produces (`view.ts`): `STATUS_GLYPH: Record<NodeStatus, string>`, `STATUS_COLOR: Record<NodeStatus, string | undefined>`, `isCompact(mode: Panel['compact'], cols: number): boolean`, `treePrefix(n: TreeNode): string`, `groupAll(agents: HerdrAgent[], repos: Record<string, string>): [string, HerdrAgent[]][]`, `totals(nodes: TreeNode[]): { cost: number; tokens: number; time: number }`, `statusLine(nodes: TreeNode[]): string | undefined`, `ctxPercent(u: Usage | null): number`, `ctxBar(pct: number, width: number): string`.
- Produces (`pane.tsx`): `drawPane(ui, model: PaneModel, act: PaneActions)` with `PaneModel = { snap: Snapshot; panel: Panel; frame: number; inproc: InProcRun[]; cols: number; surface: string }` and `PaneActions = { focus(pane: string): void; setPanel(fn: (p: Panel) => Panel): void }`.
- Produces (`register.tsx`): `refresh($, full: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing view tests**

`agent-tree/hooks/view.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import type { HerdrAgent, TreeNode } from '../types'
import { ctxBar, ctxPercent, groupAll, isCompact, statusLine, totals, treePrefix } from './view'

const node = (over: Partial<TreeNode>): TreeNode => ({
  pane: 'p', parent: 'R', depth: 0, isLast: false, name: 'n', harness: 'claude', role: 'other', status: 'working',
  title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '', ...over,
})
const ag = (pane: string, cwd: string): HerdrAgent => ({ pane, name: pane, harness: 'codex', status: 'idle', title: '', label: '', cwd, workspace: '', session: '', terminal: '' })

describe('view', () => {
  test('compact: auto under 60 columns, or forced', () => {
    expect(isCompact('auto', 59)).toBe(true)
    expect(isCompact('auto', 60)).toBe(false)
    expect(isCompact('on', 200)).toBe(true)
    expect(isCompact('off', 20)).toBe(false)
  })

  test('tree prefix by depth and last sibling', () => {
    expect(treePrefix(node({ depth: 0 }))).toBe('')
    expect(treePrefix(node({ depth: 1, isLast: false }))).toBe('├ ')
    expect(treePrefix(node({ depth: 2, isLast: true }))).toBe('  └ ')
  })

  test('All view groups by main repo name, sorted', () => {
    const groups = groupAll([ag('a', '/w/kintsugi-vhvf'), ag('b', '/p/praxis'), ag('c', '/p/kintsugi')], { '/w/kintsugi-vhvf': '/p/kintsugi', '/p/kintsugi': '/p/kintsugi' })
    expect(groups.map(([name, list]) => [name, list.map(a => a.pane)])).toEqual([
      ['kintsugi', ['a', 'c']],
      ['praxis', ['b']],
    ])
  })

  test('totals: cost and tokens of every row with usage; time from first start to last seen', () => {
    const u = { model: 'm', effort: '', contextTokens: 1, tokens: 100, costUsd: 1.5 }
    expect(totals([node({ usage: u, startedAt: 10, lastSeen: 50 }), node({ usage: u, startedAt: 20, lastSeen: 90 }), node({ startedAt: 15, lastSeen: 15 })])).toEqual({ cost: 3, tokens: 200, time: 80 })
    expect(totals([])).toEqual({ cost: 0, tokens: 0, time: 0 })
  })

  test('status line counts live working and blocked; nothing live clears it', () => {
    expect(statusLine([node({ status: 'working' }), node({ status: 'working' }), node({ status: 'blocked' }), node({ status: 'done' })])).toBe('tree 2● 1!')
    expect(statusLine([node({ status: 'idle' })])).toBe('tree 0●')
    expect(statusLine([node({ status: 'gone' }), node({ status: 'done' })])).toBeUndefined()
  })

  test('context percent and bar', () => {
    expect(ctxPercent({ model: 'claude-opus-5-5', effort: '', contextTokens: 410_000, tokens: 0, costUsd: 0 })).toBe(41)
    expect(ctxPercent(null)).toBe(0)
    expect(ctxBar(40, 5)).toBe('▓▓░░░')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./view`.

- [ ] **Step 3: Write `hooks/view.ts`**

```ts
import type { HerdrAgent, NodeStatus, Panel, TreeNode, Usage } from '../types'
import { repoName } from './tickets'
import { isLive } from './tree'
import { windowOf } from './usage'

export const STATUS_GLYPH: Record<NodeStatus, string> = { working: '●', idle: '◌', blocked: '!', done: '✓', gone: '✗' }
export const STATUS_COLOR: Record<NodeStatus, string | undefined> = { working: '#378ADD', idle: undefined, blocked: '#D0453F', done: '#3B9C5F', gone: undefined }

export const COMPACT_BELOW = 60

export const isCompact = (mode: Panel['compact'], cols: number): boolean => (mode === 'auto' ? cols < COMPACT_BELOW : mode === 'on')

export const treePrefix = (n: TreeNode): string => (n.depth === 0 ? '' : '  '.repeat(n.depth - 1) + (n.isLast ? '└ ' : '├ '))

export const groupAll = (agents: HerdrAgent[], repos: Record<string, string>): [string, HerdrAgent[]][] => {
  const groups = new Map<string, HerdrAgent[]>()
  for (const a of agents) {
    const name = repoName(repos[a.cwd] ?? a.cwd)
    groups.set(name, [...(groups.get(name) ?? []), a])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export const totals = (nodes: TreeNode[]): { cost: number; tokens: number; time: number } => {
  if (!nodes.length) return { cost: 0, tokens: 0, time: 0 }
  const cost = nodes.reduce((s, n) => s + (n.usage?.costUsd ?? 0), 0)
  const tokens = nodes.reduce((s, n) => s + (n.usage?.tokens ?? 0), 0)
  const time = Math.max(...nodes.map(n => n.lastSeen)) - Math.min(...nodes.map(n => n.startedAt))
  return { cost, tokens, time }
}

export const statusLine = (nodes: TreeNode[]): string | undefined => {
  const live = nodes.filter(n => isLive(n.status))
  if (!live.length) return undefined
  const working = live.filter(n => n.status === 'working').length
  const blocked = live.filter(n => n.status === 'blocked').length
  return `tree ${working}●${blocked ? ` ${blocked}!` : ''}`
}

export const ctxPercent = (u: Usage | null): number => (u && u.model ? Math.min(100, Math.round((u.contextTokens / windowOf(u.model)) * 100)) : 0)

export const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '▓'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}
```

- [ ] **Step 4: Run view tests to verify they pass**

Run: `claude plugin test agent-tree`
Expected: PASS (view.test.ts, 6 tests).

- [ ] **Step 5: Write the failing refresh tests in `register.test.tsx`**

Add to the imports at the top of the file:
```tsx
import { read } from 'claude-code'

import { refresh, snapshot } from './register'
```

Append at the end of the file:
```tsx
describe('refresh', () => {
  test('herdr not answering: the snapshot says so and nothing throws', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    on('process.run', async () => ({ exitCode: 1, stdout: '', stderr: 'no socket', isStdoutTruncated: false, isStderrTruncated: false }))

    await refresh($, true)

    expect((await read($, snapshot)).error).toBe('herdr is not answering.')
  })

  test('outside herdr: no tree, a plain message', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    mock.store(on)

    await refresh($, true)

    expect((await read($, snapshot)).error).toBe('Not in a herdr pane: no agent tree here.')
  })

  test('a recorded child shows up in the tree with its status', async ($, on) => {
    mock.env(on, { HOME: '/home/me', HERDR_PANE_ID: 'w9:p1' })
    mock.store(on)
    const edgeText = JSON.stringify({ v: 1, parent: 'w9:p1', parentSession: '', child: 'wX:p2', name: 'demo-impl', via: 'claude-mod', at: 1 })
    on('fs.list', async () => [{ name: `${Date.now()}-wX_p2.json`, kind: 'file', size: edgeText.length, mtimeMs: 0, isLink: false }])
    on('fs.read', async () => edgeText)
    on('fs.exists', async () => false)
    on('process.run', async (_$, e) =>
      e.argv[0] === 'herdr'
        ? ok(list(ROOT, { ...agent('wX:p2', 'demo-impl', 's2'), agent: 'codex', agent_status: 'working' }))
        : { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    )

    await refresh($, true)

    const snap = await read($, snapshot)
    expect(snap.error).toBe('')
    expect(snap.nodes.map(n => [n.pane, n.name, n.status, n.role])).toEqual([['wX:p2', 'demo-impl', 'working', 'implementer']])
  })
})
```

Note: the edge file name uses `Date.now()`, which falls inside the 7-day window for any test clock value up to now. The check that matters is that the node appears.

- [ ] **Step 6: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, `refresh` is not exported.

- [ ] **Step 7: Write `hooks/pane.tsx`**

```tsx
import type { HerdrAgent, InProcRun, Panel, Snapshot, TreeNode } from '../types'
import { CRAB_ROWS, MINI, ROLE_COLOR, halfBlock, moodOf, moodTag, spriteFor } from './crab'
import { partition } from './tree'
import { fmtCost, fmtTime, fmtTokens, modelName } from './usage'
import { STATUS_COLOR, STATUS_GLYPH, ctxBar, ctxPercent, groupAll, isCompact, totals, treePrefix } from './view'

export type PaneModel = { snap: Snapshot; panel: Panel; frame: number; inproc: InProcRun[]; cols: number; surface: string }
export type PaneActions = { focus: (pane: string) => void; setPanel: (fn: (p: Panel) => Panel) => void }

// `ui` is `$.ui.resolve(e)` for a Pane render; typed loosely so the terminal and desktop tables both fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

const usageText = (n: TreeNode): string => {
  if (!n.usage) return ''
  const model = n.usage.effort ? `${modelName(n.usage.model)}·${n.usage.effort}` : modelName(n.usage.model)
  return `${model}  ctx ${ctxPercent(n.usage)}% ${ctxBar(ctxPercent(n.usage), 5)} ≈${fmtCost(n.usage.costUsd)}`
}

export function drawPane(ui: UI, m: PaneModel, act: PaneActions) {
  const { Box, Text, Button } = ui
  const { snap, panel } = m
  const compact = isCompact(panel.compact, m.cols)
  const { tree, finished } = partition(snap.nodes)
  const t = totals(snap.nodes)
  const mood = moodOf(snap.nodes, snap.batch)
  const tag = moodTag(mood, m.frame)

  const modeToggle = (
    <Box key="modes" flexDirection="row" gap={1}>
      <Button key="m-tree" label={panel.mode === 'tree' ? '[Tree]' : 'Tree'} plain onPress={() => act.setPanel(p => ({ ...p, mode: 'tree' }))} />
      <Button key="m-all" label={panel.mode === 'all' ? '[All]' : 'All'} plain onPress={() => act.setPanel(p => ({ ...p, mode: 'all' }))} />
      <Button
        key="m-compact"
        label={compact ? 'Expand' : 'Compact'}
        plain
        onPress={() => act.setPanel(p => ({ ...p, compact: compact ? 'off' : 'on' }))}
      />
    </Box>
  )

  const crab = compact ? (
    <Text key="crab-mini" color={ROLE_COLOR.lead}>
      🦀 {mood}
    </Text>
  ) : (
    <Box key="crab" flexDirection="column" width={18} flexShrink={0}>
      {halfBlock(spriteFor(mood, m.frame)).slice(0, CRAB_ROWS).map((segs, y) => (
        <Text key={`c${y}`}>
          {segs.map((s, i) => (
            <Text key={`c${y}-${i}`} color={s.fg} backgroundColor={s.bg}>
              {s.text}
            </Text>
          ))}
          {y === 0 && tag.text ? <Text color={tag.color}> {tag.text}</Text> : null}
        </Text>
      ))}
    </Box>
  )

  const summary = (
    <Box key="summary" flexDirection="column">
      <Text dimColor>
        ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} tok · {fmtTime(t.time)}
      </Text>
      {snap.batch ? (
        <Text wrap="truncate-end">
          batch {snap.batch.stamp} <Text color="#3B9C5F">{ctxBar(snap.batch.total ? (snap.batch.fixed / snap.batch.total) * 100 : 0, 12)}</Text> {snap.batch.fixed}/
          {snap.batch.total} fixed · {snap.batch.inProgress} in-progress
        </Text>
      ) : null}
      {snap.error ? <Text color="#D0453F">{snap.error}</Text> : null}
    </Box>
  )

  const nodeRow = (n: TreeNode) =>
    compact ? (
      <Text key={`${n.pane}-${n.startedAt}`} wrap="truncate-end">
        <Text color={STATUS_COLOR[n.status]}>{STATUS_GLYPH[n.status]}</Text> {n.name} {n.usage ? `${ctxPercent(n.usage)}%` : ''}
      </Text>
    ) : (
      <Box key={`${n.pane}-${n.startedAt}`} flexDirection="row" gap={1}>
        <Text dimColor>{treePrefix(n)}</Text>
        <Text color={STATUS_COLOR[n.status]}>{STATUS_GLYPH[n.status]}</Text>
        <Text color={ROLE_COLOR[n.role]}>{MINI}</Text>
        <Button key={`f-${n.pane}-${n.startedAt}`} label={n.name} plain onPress={() => act.focus(n.pane)} />
        <Text dimColor wrap="truncate-end">
          {n.harness} {usageText(n)} {fmtTime(n.lastSeen - n.startedAt)} {n.ticket}
          {n.status === 'blocked' || n.status === 'done' ? ` ${n.title}` : ''}
        </Text>
      </Box>
    )

  const allRow = (a: HerdrAgent) => (
    <Box key={`all-${a.pane}`} flexDirection="row" gap={1}>
      <Text>{a.status === 'working' ? '●' : a.status === 'blocked' ? '!' : a.status === 'done' ? '✓' : '◌'}</Text>
      <Button key={`fa-${a.pane}`} label={a.name || a.pane} plain onPress={() => act.focus(a.pane)} />
      <Text dimColor wrap="truncate-end">
        {a.harness} {a.title || a.label}
      </Text>
    </Box>
  )

  const section = (key: string, label: string, isOpen: boolean, toggle: (p: Panel) => Panel) => (
    <Button key={key} label={`${isOpen ? '▾' : '▸'} ${label}`} plain onPress={() => act.setPanel(toggle)} />
  )

  const body =
    panel.mode === 'all' ? (
      <Box key="all" flexDirection="column">
        {groupAll(snap.all, snap.repos).map(([repo, list]) => (
          <Box key={`g-${repo}`} flexDirection="column">
            <Text bold>{repo}</Text>
            {list.map(allRow)}
          </Box>
        ))}
      </Box>
    ) : (
      <Box key="tree" flexDirection="column">
        {tree.length === 0 && finished.length === 0 ? <Text dimColor>No workers spawned from this session yet.</Text> : null}
        {tree.map(nodeRow)}
        {finished.length ? section('s-fin', `Finished · ${finished.length}`, panel.isFinishedOpen, p => ({ ...p, isFinishedOpen: !p.isFinishedOpen })) : null}
        {panel.isFinishedOpen ? finished.map(nodeRow) : null}
      </Box>
    )

  const inprocRows = m.inproc.length ? (
    <Box key="inproc" flexDirection="column">
      {section('s-in', `In-process · ${m.inproc.length}`, panel.isInProcessOpen, p => ({ ...p, isInProcessOpen: !p.isInProcessOpen }))}
      {panel.isInProcessOpen
        ? [...m.inproc].reverse().map(r => (
            <Text key={`ip-${r.id}`} dimColor wrap="truncate-end">
              {r.status === 'running' ? '●' : r.status === 'done' ? '✓' : '✗'} {r.description || r.type} · {modelName(r.model)} ≈{fmtCost(r.costUsd)}
            </Text>
          ))
        : null}
    </Box>
  ) : null

  return (
    <Box flexDirection="column">
      {modeToggle}
      <Box key="head" flexDirection={compact ? 'column' : 'row'} gap={1}>
        {crab}
        {summary}
      </Box>
      {body}
      {inprocRows}
    </Box>
  )
}
```

- [ ] **Step 8: Add refresh, timers, command and render to `hooks/register.tsx`**

Add these imports at the top (merge with the existing ones; `read` joins the `claude-code` import):
```tsx
import { atom, read, update } from 'claude-code'
import type { TreeNode } from '../types'
import { drawPane } from './pane'
import { TICKET_GREP_ARGV, batchCounts, batchStamp, parseTicketGrep, repoFromCommonDir, ticketFor } from './tickets'
import type { Ticket } from './tickets'
import { buildTree } from './tree'
import { CHUNK_BYTES, addTranscript, emptyUsage, toUsage, transcriptPath, wholeLines } from './usage'
import type { UsageAcc } from './usage'
import { statusLine } from './view'
```

Add these module-level caches and functions above `register`:
```tsx
const usageCache = new Map<string, { path: string; offset: number; acc: UsageAcc }>()
const repoCache = new Map<string, string>()
let ticketCache: { at: number; byRepo: Map<string, Ticket[]> } = { at: -Infinity, byRepo: new Map() }
const TICKETS_EVERY_MS = 15_000
const MAX_CHUNKS_PER_TICK = 8

async function resolveTranscript($: EngineInterface, home: string, cwd: string, session: string): Promise<string | null> {
  const direct = transcriptPath(home, cwd, session)
  if (await $.fs.exists(direct).catch(() => false)) return direct
  const r = await $.process.run(['find', `${home}/.claude/projects`, '-maxdepth', '2', '-name', `${session}.jsonl`], { timeoutMs: 5000 }).catch(() => null)
  return r?.stdout.split('\n')[0]?.trim() || null
}

/** New transcript bytes for each live Claude node, read in whole-line chunks of at most CHUNK_BYTES. */
async function withUsage($: EngineInterface, home: string, nodes: TreeNode[]): Promise<TreeNode[]> {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.harness !== 'claude' || !n.session || n.status === 'gone') {
      out.push(n)
      continue
    }
    let c = usageCache.get(n.session)
    if (!c) {
      const path = await resolveTranscript($, home, n.cwd, n.session)
      if (!path) {
        out.push(n)
        continue
      }
      c = { path, offset: 0, acc: emptyUsage() }
      usageCache.set(n.session, c)
    }
    for (let i = 0; i < MAX_CHUNKS_PER_TICK; i++) {
      const r = await $.process
        .run(['/bin/sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(c.offset + 1), c.path, String(CHUNK_BYTES)], { timeoutMs: 10_000 })
        .catch(() => null)
      if (!r || r.exitCode !== 0) break
      const { text, bytes } = wholeLines(r.stdout)
      if (!bytes) break
      c.acc = addTranscript(c.acc, text)
      c.offset += bytes
    }
    out.push({ ...n, usage: c.acc.model ? toUsage(c.acc) : n.usage })
  }
  return out
}

async function reposFor($: EngineInterface, cwds: string[]): Promise<Record<string, string>> {
  for (const cwd of new Set(cwds.filter(Boolean))) {
    if (repoCache.has(cwd)) continue
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 5000 }).catch(() => null)
    repoCache.set(cwd, repoFromCommonDir(r && r.exitCode === 0 ? r.stdout : '', cwd))
  }
  return Object.fromEntries(repoCache)
}

async function withTickets($: EngineInterface, nodes: TreeNode[], repos: Record<string, string>, at: number) {
  const roots = [...new Set(nodes.map(n => repos[n.cwd]).filter((r): r is string => Boolean(r)))]
  if (at - ticketCache.at >= TICKETS_EVERY_MS) {
    const byRepo = new Map<string, Ticket[]>()
    for (const root of roots) {
      const r = await $.process.run(TICKET_GREP_ARGV(`${root}/docs/issues`), { timeoutMs: 5000 }).catch(() => null)
      byRepo.set(root, r && r.exitCode === 0 ? parseTicketGrep(r.stdout) : [])
    }
    ticketCache = { at, byRepo }
  }
  // A plain loop: a `let` assigned inside a map callback would be narrowed to null by TypeScript.
  let batch: Snapshot['batch'] = null
  const out: TreeNode[] = []
  for (const n of nodes) {
    const tickets = ticketCache.byRepo.get(repos[n.cwd] ?? '') ?? []
    const t = n.status === 'gone' ? null : ticketFor(tickets, n.cwd)
    if (t?.batch && batch === null) batch = batchCounts(tickets, batchStamp(t.batch))
    out.push(t ? { ...n, ticket: t.id } : n)
  }
  return { nodes: out, batch }
}

export async function refresh($: EngineInterface, full: boolean): Promise<void> {
  const at = await $.clock.now()
  const home = (await $.env.get('HOME')) ?? ''
  const root = (await $.env.get('HERDR_PANE_ID')) ?? ''
  if (!root) {
    await update($, snapshot, s => ({ ...s, at, root: '', error: 'Not in a herdr pane: no agent tree here.' }))
    return
  }
  const agents = await listAgents($)
  if (!agents) {
    await update($, snapshot, s => ({ ...s, at, root, error: 'herdr is not answering.' }))
    return
  }
  const edges = await loadEdges($, home, at)
  const stored = ((await $.store.get('bindings').catch(() => undefined)) ?? {}) as Record<string, string>
  const prev = await read($, snapshot)
  const built = buildTree({ root, edges, agents, bindings: stored, previous: prev.nodes, at })
  if (Object.keys(built.bindings).length !== Object.keys(stored).length) {
    const latest = ((await $.store.get('bindings').catch(() => undefined)) ?? {}) as Record<string, string>
    await $.store.set('bindings', { ...built.bindings, ...latest }).catch(() => undefined)
  }
  let nodes = built.nodes
  let repos = prev.repos
  let batch = prev.batch
  if (full) {
    nodes = await withUsage($, home, nodes)
    repos = await reposFor($, [...nodes.map(n => n.cwd), ...agents.map(a => a.cwd)])
    ;({ nodes, batch } = await withTickets($, nodes, repos, at))
  }
  await update($, snapshot, () => ({ at, root, nodes, all: agents, repos, batch, error: '' }))
  $.ui.status(statusLine(nodes))
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function togglePane($: EngineInterface): Promise<boolean> {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  void refresh($, true).catch(() => undefined)
  return true
}
```

In `recordEdges`, after the `edgeCount` update, add the once-per-session auto-open:
```tsx
  const p = await read($, panel)
  if (!p.isAutoOpened) {
    await update($, panel, prev => ({ ...prev, isAutoOpened: true }))
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
  }
```

Change `export const register: Register = on => {` to `export const register: Register = (on, options) => {` and add these hooks inside it, after the Bash hook:
```tsx
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'agent-tree', description: 'Show or hide the tree of herdr agents this session spawned' })
    let tick = 0
    $.clock.every(2000, () => {
      void (async () => {
        tick++
        if (await isPaneOpen($)) return refresh($, true)
        if (tick % 5 === 0 && (await read($, edgeCount)) > 0) return refresh($, false)
      })().catch(() => undefined)
    })
    $.clock.every(250, () => {
      void (async () => {
        if (options.motion === 'off') return
        const snap = await read($, snapshot)
        if (!snap.nodes.some(n => n.status === 'working') || !(await isPaneOpen($))) return
        await update($, frame, f => f + 1)
      })().catch(() => undefined)
    })
    return started
  })

  on('command.run', { command: 'agent-tree' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? 'Agent tree opened.' : 'Agent tree closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    return drawPane(
      ui,
      {
        snap: await read($, snapshot),
        panel: await read($, panel),
        frame: await read($, frame),
        inproc: await read($, inproc),
        cols: e.props.bodyColumns || 80,
        surface: e.surface,
      },
      {
        focus: pane => void $.process.run(['herdr', 'agent', 'focus', pane], { timeoutMs: 5000 }).catch(() => undefined),
        setPanel: fn => void update($, panel, fn),
      },
    )
  })
```

- [ ] **Step 9: Run the full test lane**

Run: `claude plugin test agent-tree`
Expected: PASS for every file (herdr, ledger, tree, usage, tickets, crab, view, register including the 3 refresh tests).

- [ ] **Step 10: Validate and type-check**

Run: `claude plugin validate agent-tree`
Expected: no errors. It should list the hooks `tool.call` (Bash), `session.start`, `command.run`, `ui.render` (Pane) and the `$.state` keys `snapshot`, `panel`, `frame`, `inproc`, `edgeCount` held to the contract.

Type-check. Before the mod has loaded once, the types folder does not exist yet, so use a tsconfig kept outside the mod:
```bash
SP=<scratchpad>; cat > "$SP/tsconfig.agent-tree.json" <<'EOF'
{ "compilerOptions": { "strict": true, "noEmit": true, "jsx": "react", "jsxFactory": "h", "module": "esnext", "target": "es2022", "moduleResolution": "bundler", "types": [] },
  "include": ["/private/tmp/claude-501/bundled-skills/2.1.293/4fbce35f4489b9495e2f7e63bae8f43a/plugin-authoring/types/claude-code.d.ts", "/Users/ldh/Projects/github.com/claude-mods/agent-tree/hooks", "/Users/ldh/Projects/github.com/claude-mods/agent-tree/types"] }
EOF
npx -p typescript tsc -p "$SP/tsconfig.agent-tree.json"
```
Compare these options with the header of the skill's `claude-code.d.ts`, which prints the exact tsconfig to use, and prefer that one if they differ. Once the mod has loaded, run `npx -p typescript tsc -p agent-tree` instead.
Expected: no errors.

- [ ] **Step 11: Negative control on the status line**

In `statusLine`, temporarily change `isLive(n.status)` to `true`. Run the tests. Expected: the "nothing live clears it" test FAILS. Restore it and re-run: PASS. Paste both outputs.

- [ ] **Step 12: Commit**

```bash
git add agent-tree/hooks/view.ts agent-tree/hooks/view.test.ts agent-tree/hooks/pane.tsx agent-tree/hooks/register.tsx agent-tree/hooks/register.test.tsx
git commit -F <scratchpad>/msg-task7.txt   # "agent-tree: refresh loop, pane, /agent-tree, status line"
```

---

### Task 8: In-process subagents section

**Files:**
- Create: `agent-tree/hooks/inproc.ts`
- Modify: `agent-tree/hooks/register.tsx` (three hooks)
- Test: `agent-tree/hooks/inproc.test.ts`

**Interfaces:**
- Consumes: `InProcRun`, `costOf`, `windowOf` (Task 4).
- Produces: `spawnRun(list: InProcRun[], r: { id: string; agentId?: string; type: string; description: string; model: string; at: number }): InProcRun[]`, `stepRun(list: InProcRun[], agentId: string, model: string, u: RawUsage): InProcRun[]`, `completeRun(list: InProcRun[], agentId: string, ok: boolean, at: number): InProcRun[]`.

This is a pure-reducer port of savvy-progress's `agent.spawn` / `turn.step` / `turn.complete` hooks (lines 760–860 of its `register.tsx`), without the savvy tiers, step tool and rounds.

- [ ] **Step 1: Write the failing tests**

`agent-tree/hooks/inproc.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { completeRun, spawnRun, stepRun } from './inproc'

describe('in-process runs', () => {
  test('spawn, step, complete', () => {
    let list = spawnRun([], { id: 'a1', agentId: 'a1', type: 'Explore', description: 'find x', model: 'claude-haiku-5-5', at: 10 })
    list = stepRun(list, 'a1', 'claude-haiku-5-5', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    list = stepRun(list, 'zz', 'claude-haiku-5-5', { input_tokens: 999 })
    expect(list[0]).toMatchObject({ status: 'running', tokens: 110, contextTokens: 110 })
    expect(list[0]?.costUsd).toBeGreaterThan(0)
    list = completeRun(list, 'a1', true, 50)
    expect(list[0]).toMatchObject({ status: 'done', endedAt: 50 })
    expect(completeRun(list, 'a1', false, 60)[0]?.status).toBe('failed')
  })

  test('keeps the last 50 runs; a re-spawned id replaces its old row', () => {
    let list: ReturnType<typeof spawnRun> = []
    for (let i = 0; i < 60; i++) list = spawnRun(list, { id: `r${i}`, type: 't', description: '', model: '', at: i })
    expect(list).toHaveLength(50)
    expect(spawnRun(list, { id: 'r59', type: 't', description: 'again', model: '', at: 99 }).filter(r => r.id === 'r59')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./inproc`.

- [ ] **Step 3: Write `hooks/inproc.ts`**

```ts
import type { InProcRun } from '../types'
import type { RawUsage } from './usage'
import { costOf } from './usage'

const KEEP = 50

export const spawnRun = (
  list: InProcRun[],
  r: { id: string; agentId?: string; type: string; description: string; model: string; at: number },
): InProcRun[] => {
  const run: InProcRun = {
    id: r.id,
    agentId: r.agentId,
    type: r.type,
    description: r.description,
    model: r.model,
    status: 'running',
    startedAt: r.at,
    contextTokens: 0,
    tokens: 0,
    costUsd: 0,
  }
  return [...list.filter(a => a.id !== run.id), run].slice(-KEEP)
}

export const stepRun = (list: InProcRun[], agentId: string, model: string, u: RawUsage): InProcRun[] => {
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
  return list.map(a => (a.agentId !== agentId ? a : { ...a, model, contextTokens: ctx, tokens: a.tokens + ctx, costUsd: a.costUsd + costOf(model, u) }))
}

export const completeRun = (list: InProcRun[], agentId: string, ok: boolean, at: number): InProcRun[] =>
  list.map(a => (a.agentId !== agentId ? a : { ...a, status: ok ? 'done' : 'failed', endedAt: at }))
```

- [ ] **Step 4: Wire the hooks in `register.tsx`**

Add `import { completeRun, spawnRun, stepRun } from './inproc'` and, inside `register`:
```tsx
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    await update($, inproc, list =>
      spawnRun(list, { id: started.agentId ?? e.tool_use_id, agentId: started.agentId, type: e.subagentType, description: e.description, model: started.model, at }),
    )
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId && result.usage) {
      const agentId = e.agentId
      const usage = result.usage
      await update($, inproc, list => stepRun(list, agentId, usage.model || e.model, usage))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const agentId = e.agentId
      const at = await $.clock.now()
      await update($, inproc, list => completeRun(list, agentId, e.reason === 'answer', at))
    }
    return next(e)
  })
```

- [ ] **Step 5: Run the full test lane**

Run: `claude plugin test agent-tree` then `claude plugin validate agent-tree`.
Expected: PASS; validate also lists `agent.spawn`, `turn.step`, `turn.complete`.

- [ ] **Step 6: Commit**

```bash
git add agent-tree/hooks/inproc.ts agent-tree/hooks/inproc.test.ts agent-tree/hooks/register.tsx
git commit -F <scratchpad>/msg-task8.txt   # "agent-tree: in-process subagents section"
```

---

### Task 9: Desktop SVG crabs

**Files:**
- Create: `agent-tree/hooks/svg-crab.ts`
- Modify: `agent-tree/hooks/pane.tsx` (desktop branch for the hero and row glyphs)
- Test: `agent-tree/hooks/svg-crab.test.ts`

**Interfaces:**
- Consumes: `Role`, `Mood`.
- Produces: `costumeOfRole(role: Role, type?: string): string`, `crabSvg(costume: string, isWalking: boolean): string` (34×32 SVG), `heroSvg(mood: Mood): string` (34×32, typist costume).

Port: copy savvy-progress 1.2.0 `hooks/register.tsx` lines 386–505 (`CLAY`, `INK`, `Fill`, `stamp`, `crabBody`, `CRAB_CSS`, `COSTUMES`, `crab`) verbatim into `svg-crab.ts`. The file is MIT-licensed; keep the attribution comment shown below. Then make these changes:
1. `crab()` calls `colorOf(costume)`; replace that with a local `COSTUME_COLOR` record: `{ fable: '#7F77DD', heavy: '#D85A30', careful: '#BA7517', medium: '#378ADD', light: '#1D9E75', explore: '#888780', typist: '#378ADD', other: '#888780' }`.
2. Add the new `typist` costume (below) to `COSTUMES`.
3. Add the role map and the two wrappers (below).

- [ ] **Step 1: Write the failing tests**

`agent-tree/hooks/svg-crab.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { costumeOfRole, crabSvg, heroSvg } from './svg-crab'

describe('svg crabs', () => {
  test('role → savvy costume', () => {
    expect(costumeOfRole('lead')).toBe('medium')
    expect(costumeOfRole('reviewer')).toBe('heavy')
    expect(costumeOfRole('fixer')).toBe('careful')
    expect(costumeOfRole('implementer')).toBe('typist')
    expect(costumeOfRole('other', 'Explore')).toBe('explore')
    expect(costumeOfRole('research')).toBe('other')
  })

  test('a walking crab carries the run class; the hero sleeps without it', () => {
    expect(crabSvg('typist', true)).toContain('c-typist run')
    expect(crabSvg('heavy', false)).not.toContain(' run"')
    expect(heroSvg('asleep')).not.toContain(' run"')
    expect(heroSvg('typing')).toMatch(/^<svg [^>]*width="34" height="32"/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `claude plugin test agent-tree`
Expected: FAIL, cannot resolve `./svg-crab`.

- [ ] **Step 3: Write `hooks/svg-crab.ts`**

Header, then the verbatim copy of savvy lines 386–505 with change 1 applied:
```ts
// Pixel crab sprites and costumes from savvy-progress 1.2.0 by johnnyvizz (MIT),
// itself after DockCrab (Clawdy). Copied with a typist costume and a role map added.
import type { Role } from '../types'
import type { Mood } from './crab'

// ⟨paste savvy-progress hooks/register.tsx lines 386–505 here, replacing `colorOf(costume)` in crab() with `COSTUME_COLOR[costume] ?? '#888780'`⟩
```

Then add, after the pasted block:
```ts
const COSTUME_COLOR: Record<string, string> = {
  fable: '#7F77DD', heavy: '#D85A30', careful: '#BA7517', medium: '#378ADD', light: '#1D9E75', explore: '#888780', typist: '#378ADD', other: '#888780',
}

// Typist: a keyboard in front; the claws tap it as the crab walks.
COSTUMES.typist = f => {
  crabBody(f, -2)
  f(2, 22, 26, 4, '#4A4A48')
  for (let x = 3; x < 27; x += 3) f(x, 23, 2, 1, '#C9CCD2')
}

const ROLE_COSTUME: Record<Role, string> = {
  lead: 'medium',
  implementer: 'typist',
  reviewer: 'heavy',
  fixer: 'careful',
  integrator: 'light',
  research: 'other',
  other: 'other',
}

export const costumeOfRole = (role: Role, type?: string): string => (type === 'Explore' ? 'explore' : ROLE_COSTUME[role])

const wrap = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="32" viewBox="0 0 34 32">${CRAB_CSS}${body}</svg>`

export const crabSvg = (costume: string, isWalking: boolean): string => wrap(crab(0, 0, costume, false, isWalking))

export const heroSvg = (mood: Mood): string => wrap(crab(0, 0, mood === 'review' ? 'heavy' : 'typist', mood === 'asleep', mood === 'typing' || mood === 'party'))
```
The `⟨paste …⟩` line is an instruction to the implementer: replace it with the copied source. It must not be left in the file. `COSTUMES` in the pasted block is a `const` object, and adding the `typist` key at runtime works because it is typed `Record<string, …>`.

- [ ] **Step 4: Use the SVGs on desktop in `pane.tsx`**

At the top of `drawPane`, after `const { Box, Text, Button } = ui`:
```tsx
  const Svg = m.surface === 'desktop' && 'Svg' in ui ? ui.Svg : null
```
Replace the non-compact `crab` element's `<Box key="crab" …>…</Box>` with `Svg ? <Svg key="crab" source={heroSvg(mood)} alt={`crab: ${mood}`} width={34} height={32} /> : <Box key="crab" …>…</Box>` (keeping the existing Box branch as the else).
In `nodeRow`'s non-compact branch, replace `<Text color={ROLE_COLOR[n.role]}>{MINI}</Text>` with:
```tsx
        {Svg ? (
          <Svg key={`cr-${n.pane}`} source={crabSvg(costumeOfRole(n.role), n.status === 'working')} alt={n.role} width={34} height={32} />
        ) : (
          <Text color={ROLE_COLOR[n.role]}>{MINI}</Text>
        )}
```
Add `import { costumeOfRole, crabSvg, heroSvg } from './svg-crab'`.

- [ ] **Step 5: Run the full test lane, validate, type-check**

Run: `claude plugin test agent-tree && claude plugin validate agent-tree`, then the tsc command from Task 7 Step 10.
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add agent-tree/hooks/svg-crab.ts agent-tree/hooks/svg-crab.test.ts agent-tree/hooks/pane.tsx
git commit -F <scratchpad>/msg-task9.txt   # "agent-tree: desktop SVG crabs by role"
```

---

### Task 10: Docs, load and live verification

**Files:**
- Create: `agent-tree/README.md`
- Modify: `README.md` (repo root: mods table)

**Interfaces:** none new.

- [ ] **Step 1: Write `agent-tree/README.md`**

```markdown
# agent-tree

A pane for herdr users: the agents this Claude session spawned, the agents those spawned, and so on, each with status, model, context, estimated cost and ticket. `/agent-tree` toggles it.

- **Tree view**: rooted at this session's herdr pane. `●` working, `◌` idle, `!` blocked (herdr status or a `BLOCKED:` title), `✓` done (or `DONE:`), `✗` pane gone (last numbers kept). Click a name to focus that pane.
- **All view**: every herdr agent, grouped by repo; worktrees fold into their repo.
- **Batch bar**: when a worker's cwd is a ticket's `workspace:`, the header shows that ticket's batch: fixed / in-progress of total.
- **Crab**: types while workers work, holds a magnifier when only reviewers do, sweats when something is blocked, sleeps when all is idle, parties when the batch is all fixed. Set `motion` to `off` to keep it still.
- **Status line**: `tree 3● 1!` while the tree has live members.

## How it knows the tree

herdr does not record which pane spawned which. Every Claude session running this mod writes one small file per `herdr agent start` it runs to `~/.local/state/agent-tree/edges/` (`{"v":1,"parent","parentSession","child","name","via","at"}`). Agents started by a non-Claude lead (codex, opencode, pi) are not linked yet. A collector for those can write the same files with its own `via`.

Cost is an estimate from token counts and a price table (`hooks/usage.ts`), not a bill.

## Credits

The SVG crab sprites and costumes come from [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz (MIT), which credits DockCrab.
```

- [ ] **Step 2: Add the row to the root `README.md` mods table**

Below the `outputs-pane` row:
```markdown
| [agent-tree](agent-tree/) | Pane of the herdr agents this session spawned, and theirs: status, model, context, cost and ticket, with a global view and a crab. `/agent-tree` toggles it. |
```

- [ ] **Step 3: Full test lane and validate**

Run: `claude plugin test agent-tree && claude plugin validate agent-tree`
Expected: all PASS. Paste the summary lines.

- [ ] **Step 4: Live load (ask the owner first)**

Ask the owner whether to (a) add `~/Projects/github.com/claude-mods/agent-tree` to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (every session, as outputs-pane is), or (b) test in one session with `claude --plugin-dir ~/Projects/github.com/claude-mods/agent-tree`. Do whichever they pick. Then, in a new herdr pane, start `claude --debug-file <scratchpad>/agent-tree-live.log` (adding `--plugin-dir …` for option b) and confirm the log has `hooks module agent-tree@inline loaded`.

- [ ] **Step 5: Live check**

In that session:
1. `/agent-tree`: the pane opens and says "No workers spawned from this session yet." The status line is empty.
2. Have it run `herdr pane split --current --direction right --no-focus`, then `herdr agent start agent-tree-probe-impl --kind claude --pane <new pane>`.
3. `ls ~/.local/state/agent-tree/edges/` shows one new file whose `child` is the new pane. Quote its contents.
4. Within 2 s the pane shows `agent-tree-probe-impl` with `●` or `◌`, the implementer glyph, model and ctx once it has answered a prompt, and the status line shows `tree 1●` or `tree 0●`.
5. Click the name: herdr focuses the probe pane.
6. Switch to All: the probe and the other herdr agents appear, grouped by repo.
7. Close the probe pane (`herdr pane close <pane>`): the row turns `✗` and moves under Finished.
8. Negative control: have it run `echo 'herdr agent start nope'`. No new edge file appears.

Record each observation with the command run and its output in the task report.

- [ ] **Step 6: Commit**

```bash
git add agent-tree/README.md README.md
git commit -F <scratchpad>/msg-task10.txt   # "agent-tree: README and repo index"
```

- [ ] **Step 7: Hand back**

Report to the owner: the mod path, how it now loads, the live-check results, and that `savvy-progress` can be uninstalled with `/plugin uninstall savvy-progress` whenever they like.
