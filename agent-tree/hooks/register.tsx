import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Edge, HerdrAgent, InProcRun, Panel, Snapshot } from '../types'
import { invokesAgentStart, newAgents, parseAgentList, parseStarted } from './herdr'
import { WEEK_MS, edgeAt, edgeFileName, ledgerDir, makeEdge, parseEdge } from './ledger'
import type { TreeNode } from '../types'
import { drawPane } from './pane'
import { TICKET_GREP_ARGV, batchCounts, batchStamp, parseTicketGrep, repoFromCommonDir, ticketFor } from './tickets'
import type { Ticket } from './tickets'
import { buildTree } from './tree'
import { CHUNK_BYTES, addTranscript, emptyUsage, toUsage, transcriptPath, wholeLines } from './usage'
import type { UsageAcc } from './usage'
import { statusLine } from './view'

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
  const p = await read($, panel)
  if (!p.isAutoOpened) {
    await update($, panel, prev => ({ ...prev, isAutoOpened: true }))
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
  }
}

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
  // Awaited, so the pane's first draw has data.
  await refresh($, true).catch(() => undefined)
  return true
}

export const register: Register = (on, options) => {
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
}
