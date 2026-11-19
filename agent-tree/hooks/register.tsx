import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ding, Edge, HerdrAgent, InProcRun, Pace, Panel, Snapshot } from '../types'
import { ackAll, addDings, findDings, markSeen, nameDings, needYou, parentsOf, settleDings } from './dings'
import { herdrError, invokesAgentStart, mayStartHerdr, newAgents, parseAgentList, parseStarted, parseTabList } from './herdr'
import { WEEK_MS, edgeAt, edgeFileName, ledgerDir, makeEdge, parseEdge } from './ledger'
import { CODEX_THREAD_ARGV, LIST_ARGV, focusArgvs, invokesRexSpawn, keepNames, namesHarness, parseClaudeSessionFile, parseRexList, parseRexStarted, pidOf, promptArgvs } from './rex'
import type { RexList } from './rex'
import type { TreeNode, Usage } from '../types'
import { addRollout, codexUsage } from './codex'
import { completeRun, spawnRun, stepRun } from './inproc'
import { drawPane } from './pane'
import { observeBatch } from './pace'
import { teamStatusText } from './status'
import type { StatusScope } from './status'
import { TICKET_GREP_ARGV, batchCounts, batchStamp, parseTicketGrep, repoFromCommonDir, ticketFor } from './tickets'
import type { Ticket } from './tickets'
import { buildTree, markErrors, roleOf } from './tree'
import { CHUNK_BYTES, addTranscript, consumeChunk, emptyUsage, toUsage, transcriptPath } from './usage'
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
  isDingsOpen: true,
  isAckedOpen: false,
} as Panel)
export const frame = atom({ plugin: 'agent-tree', key: 'frame' } as const, 0)
export const inproc = atom({ plugin: 'agent-tree', key: 'inproc' } as const, [] as InProcRun[])
export const edgeCount = atom({ plugin: 'agent-tree', key: 'edgeCount' } as const, 0)
export const dings = atom({ plugin: 'agent-tree', key: 'dings' } as const, [] as Ding[])
// Session state, so a reload keeps the batch's observed closes.
export const pace = atom({ plugin: 'agent-tree', key: 'pace' } as const, null as Pace | null)

export const TEAM_STATUS = 'team_status'
export const TEAM_STATUS_TOOL = 'mcp__agent-tree__team_status'
export const DEFAULT_CONTINUE = 'Continue your dispatch from where you stopped.'
// team_status answers from a snapshot no older than this; an older one is refreshed first.
const FRESH_MS = 2000

export const TEAM_STATUS_DESCRIPTION = [
  'The state of the workers this session spawned in herdr or Rex panes, and the agents those spawned: one line each, in tree order, with name, role, status, ticket, model and effort, context percent, time in the tree, a DONE: or BLOCKED: title and the pane id.',
  'An errored row is a worker whose turn ended on an API error; a model change says what the model was.',
  'The first line has the counts, the dings that need you, and the batch with its fixed count and ETA.',
  'Call this for worker state in place of reading panes (herdr pane read, rex output) or sleeping and polling.',
  'It reports the state now and does not wait for anything to change: to see a change, call it again later. It never sends anything to a pane.',
  "scope: 'tree' (default) for this session's tree; 'all' for every listed agent, grouped by repo.",
].join(' ')

// Module caches: a reload starts them over, which only costs a re-read.
// Only edges that parsed: a sibling session's file caught mid-write is read again next time.
const edgeCache = new Map<string, Edge>()

/** The multiplexer this session runs in and its pane there. herdr wins: a herdr inside Rex is the nearer one. */
export type Mux = { kind: 'herdr' | 'rex'; root: string } | null

export async function muxOf($: EngineInterface): Promise<Mux> {
  const herdr = await $.env.get('HERDR_PANE_ID')
  if (herdr) return { kind: 'herdr', root: herdr }
  const rex = await $.env.get('REX_BLOCK')
  return rex ? { kind: 'rex', root: rex } : null
}

const muxName = (mux: Mux): string => (mux?.kind === 'rex' ? 'Rex' : 'herdr')

/** Rex sessions also see herdr teams when available. Failure of the session's own backend stays an error. */
export async function listAgents($: EngineInterface, mux: Mux): Promise<HerdrAgent[] | null> {
  if (mux?.kind === 'rex') {
    const [rex, herdr] = await Promise.all([listRex($), listHerdr($)])
    return rex ? [...rex.agents, ...(herdr ?? [])] : null
  }
  return listHerdr($)
}

async function listHerdr($: EngineInterface): Promise<HerdrAgent[] | null> {
  try {
    const r = await $.process.run(['herdr', 'agent', 'list'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? parseAgentList(r.stdout) : null
  } catch {
    return null
  }
}

// The newest Rex list: its window labels name dings, its block owners pick the app to focus in.
let lastRex: RexList = { agents: [], labels: {}, owners: {}, names: {}, down: [] }
// codex pid → its thread, and when a miss was last looked up: codex logs the thread only while it works.
const codexThreads = new Map<number, { id: string; at: number }>()
const CODEX_RETRY_MS = 60_000
// Each Rex agent's last name, by terminal: a worker's DONE: label replaces its name.
const rexNames = new Map<string, string>()

async function listRex($: EngineInterface): Promise<RexList | null> {
  try {
    const r = await $.process.run(LIST_ARGV, { timeoutMs: 5000 })
    if (r.exitCode !== 0) return null
    const list = parseRexList(r.stdout)
    lastRex = { ...list, agents: await withRexSessions($, keepNames(list.agents, rexNames)) }
    return lastRex
  } catch {
    return null
  }
}

/** Rex knows processes, not sessions: Claude Code names its session in a file per pid, codex in its logs. */
async function withRexSessions($: EngineInterface, agents: HerdrAgent[]): Promise<HerdrAgent[]> {
  const home = (await $.env.get('HOME')) ?? ''
  const at = await $.clock.now()
  const out: HerdrAgent[] = []
  for (const a of agents) {
    const pid = pidOf(a)
    let session = ''
    // A remote host's pid names a process there: its session files and logs are not on this machine.
    if (a.server) {
      out.push(a)
      continue
    }
    if (Number.isFinite(pid) && a.harness === 'claude') {
      session = parseClaudeSessionFile(String(await $.fs.read(`${home}/.claude/sessions/${pid}.json`).catch(() => '')))
    } else if (Number.isFinite(pid) && a.harness === 'codex') {
      let c = codexThreads.get(pid)
      if (!c || (!c.id && at - c.at >= CODEX_RETRY_MS)) {
        const r = await $.process.run(CODEX_THREAD_ARGV(home, pid), { timeoutMs: 5000 }).catch(() => null)
        c = { id: r?.stdout.split('\n')[0]?.trim() ?? '', at }
        codexThreads.set(pid, c)
      }
      session = c.id
    }
    out.push(session ? { ...a, session } : a)
  }
  return out
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
    let e = edgeCache.get(name)
    if (!e) {
      e = (await $.fs.read(`${dir}/${name}`).then(text => parseEdge(String(text)), () => null)) ?? undefined
      if (e) edgeCache.set(name, e)
    }
    if (e) edges.push(e)
  }
  return edges
}

export async function recordEdges($: EngineInterface, root: string, parentSession: string, started: HerdrAgent[], since: number): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  const at = await $.clock.now()
  // rex-team writes before Bash returns. Re-read the ledger, not just our cache,
  // so the hook does not turn that same spawn into a second incarnation.
  const recent = await loadEdges($, home, at)
  for (const child of started) {
    if (recent.some(e => e.parent === root && e.child === child.pane && e.server === child.server && e.at >= since && e.at <= at && at - e.at <= 180_000)) continue
    const edge = makeEdge(root, parentSession, child, at)
    await $.fs.write(`${ledgerDir(home)}/${edgeFileName(edge)}`, JSON.stringify(edge))
    edgeCache.set(edgeFileName(edge), edge)
    recent.push(edge)
  }
  await update($, edgeCount, n => n + started.length)
  const p = await read($, panel)
  if (!p.isAutoOpened) {
    await update($, panel, prev => ({ ...prev, isAutoOpened: true }))
    mayBeOpen = true
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
  }
}

const usageCache = new Map<string, { path: string; offset: number; isSkipping: boolean; acc: UsageAcc }>()
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

// A codex session's rollout, in any codex home named ~/.codex* (workers also run with CODEX_HOME=~/.codex-alt).
async function resolveRollout($: EngineInterface, home: string, session: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(session)) return null
  const r = await $.process
    .run(['/bin/sh', '-c', 'find "$1"/.codex*/sessions -name "rollout-*-$2.jsonl" 2>/dev/null | head -n 1', 'sh', home, session], { timeoutMs: 5000 })
    .catch(() => null)
  return r?.stdout.split('\n')[0]?.trim() || null
}

// How each harness's usage file reads; usagePath finds the file.
const READERS: Record<string, { add: (acc: UsageAcc, text: string) => UsageAcc; usage: (acc: UsageAcc) => Usage }> = {
  claude: { add: addTranscript, usage: toUsage },
  codex: { add: addRollout, usage: codexUsage },
}

async function usagePath($: EngineInterface, home: string, n: TreeNode): Promise<string | null> {
  return n.harness === 'codex' ? resolveRollout($, home, n.session) : resolveTranscript($, home, n.cwd, n.session)
}

/** New transcript bytes for each live Claude or codex node, read in whole-line chunks of at most CHUNK_BYTES. */
async function withUsage($: EngineInterface, home: string, nodes: TreeNode[]): Promise<TreeNode[]> {
  const out: TreeNode[] = []
  for (const n of nodes) {
    const reader = READERS[n.harness]
    if (!reader || !n.session || n.status === 'gone') {
      out.push(n)
      continue
    }
    let c = usageCache.get(n.session)
    if (!c) {
      const path = await usagePath($, home, n)
      if (!path) {
        out.push(n)
        continue
      }
      c = { path, offset: 0, isSkipping: false, acc: emptyUsage() }
      usageCache.set(n.session, c)
    }
    for (let i = 0; i < MAX_CHUNKS_PER_TICK; i++) {
      const r = await $.process
        .run(['/bin/sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(c.offset + 1), c.path, String(CHUNK_BYTES)], { timeoutMs: 10_000 })
        .catch(() => null)
      if (!r || r.exitCode !== 0) break
      const read = consumeChunk(r.stdout, c.isSkipping)
      if (!read.bytes) break
      c.acc = reader.add(c.acc, read.text)
      c.offset += read.bytes
      c.isSkipping = read.isSkipping
    }
    // A first turn that died on an API error has no model yet, and still shows as errored.
    out.push({ ...n, usage: c.acc.model || c.acc.apiError ? reader.usage(c.acc) : withoutError(n.usage) })
  }
  return out
}

const withoutError = (u: Usage | null): Usage | null => {
  if (!u?.apiError) return u
  const { apiError: _gone, ...rest } = u
  return rest
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

/** A Rex block recorded before its agent shows: only its id and label are known. */
const rexPlaceholder = (pane: string, name: string): HerdrAgent => ({
  mux: 'rex',
  pane,
  name,
  harness: '',
  status: 'unknown',
  title: '',
  label: '',
  cwd: '',
  workspace: '',
  session: '',
  terminal: pane,
})

// One refresh at a time: two would read the same transcript bytes and advance the offset twice.
let running: Promise<void> | null = null
// When the last full refresh (usage and tickets read) finished its snapshot.
let fullAt = -Infinity

// A press always answers: the multiplexer jumps to the pane, or a toast says why it could not.
async function focusPane($: EngineInterface, pane: string): Promise<boolean> {
  const target = (await read($, snapshot)).all.find(a => a.pane === pane)
  // Old snapshots and dings may outlive the live row. Pane ids also distinguish the backends.
  if ((target?.mux ?? (pane.startsWith('block:') ? 'rex' : 'herdr')) === 'rex') {
    return focusRexPane($, (await muxOf($))?.root ?? '', pane)
  }
  const r = await $.process.run(['herdr', 'agent', 'focus', pane], { timeoutMs: 5000 }).catch((err: unknown) => String(err))
  if (typeof r !== 'string' && r.exitCode === 0) return true
  const reason = typeof r === 'string' ? r : herdrError(r.stdout) || r.stderr.trim() || `exit ${r.exitCode}`
  $.ui.toast(`agent-tree: could not focus ${pane}: ${reason}`)
  return false
}

// Rex focuses a block within its session; the app that owns this session's block is then asked to show it.
async function focusRexPane($: EngineInterface, root: string, pane: string): Promise<boolean> {
  const target = (await read($, snapshot)).all.find(a => a.pane === pane)
  if (!target?.workspace) {
    $.ui.toast(`agent-tree: could not focus ${pane}: Rex no longer lists it`)
    return false
  }
  for (const argv of focusArgvs(target, lastRex.owners[root] ?? '')) {
    const r = await $.process.run(argv, { timeoutMs: 5000 }).catch((err: unknown) => String(err))
    if (typeof r !== 'string' && r.exitCode === 0) continue
    $.ui.toast(`agent-tree: could not focus ${pane}: ${typeof r === 'string' ? r : r.stderr.trim() || `exit ${r.exitCode}`}`)
    return false
  }
  return true
}

/** Each tab's label by id; none when the multiplexer does not answer. */
async function tabLabels($: EngineInterface, kind: 'herdr' | 'rex'): Promise<Record<string, string>> {
  if (kind === 'rex') return lastRex.labels
  const r = await $.process.run(['herdr', 'tab', 'list'], { timeoutMs: 5000 }).catch(() => null)
  return r && r.exitCode === 0 ? parseTabList(r.stdout) : {}
}

/** Acks a pane's open dings, or with no pane every open ding, and recounts the status line. */
async function ackDings($: EngineInterface, pane?: string) {
  const list = await update($, dings, l => (pane === undefined ? ackAll(l) : markSeen(l, pane)))
  $.ui.status(statusLine((await read($, snapshot)).nodes, needYou(list)))
}

// A row press puts the pane in front of you, which answers its open dings.
async function focusRow($: EngineInterface, pane: string) {
  if (await focusPane($, pane)) await ackDings($, pane)
}

export function refresh($: EngineInterface, full: boolean): Promise<void> {
  running ??= refreshOnce($, full).finally(() => {
    running = null
  })
  return running
}

async function refreshOnce($: EngineInterface, full: boolean): Promise<void> {
  const at = await $.clock.now()
  const home = (await $.env.get('HOME')) ?? ''
  const mux = await muxOf($)
  const root = mux?.root ?? ''
  if (!mux) {
    await update($, snapshot, s => ({ ...s, at, root: '', error: 'Not in a herdr or Rex pane: no agent tree here.' }))
    return
  }
  const agents = await listAgents($, mux)
  if (!agents) {
    await update($, snapshot, s => ({ ...s, at, root, error: `${muxName(mux)} is not answering.` }))
    return
  }
  const edges = await loadEdges($, home, at)
  const stored = ((await $.store.get('bindings').catch(() => undefined)) ?? {}) as Record<string, string>
  const prev = await read($, snapshot)
  const built = buildTree({ root, edges, agents, bindings: stored, previous: prev.nodes, at })
  const treePanes = new Set(built.nodes.map(n => n.pane))
  const presentTreePanes = new Set(built.nodes.filter(n => n.status !== 'gone').map(n => n.pane))
  if (Object.keys(built.bindings).length !== Object.keys(stored).length) {
    const latest = ((await $.store.get('bindings').catch(() => undefined)) ?? {}) as Record<string, string>
    await $.store.set('bindings', { ...built.bindings, ...latest }).catch(() => undefined)
  }
  // A list from before an error is stale: the turns since then were never seen.
  let found = findDings({ prev: prev.all, prevAt: prev.error ? 0 : prev.at, next: agents, at, root, parents: parentsOf(edges, built.nodes) }).filter(d => presentTreePanes.has(d.pane))
  // Tab ids belong to a backend: identical ids in the two lists must not exchange labels.
  for (const kind of ['rex', 'herdr'] as const) {
    const group = agents.filter(a => a.mux === kind)
    const unnamed = found.filter(d => !d.name && group.some(a => a.pane === d.pane))
    if (!unnamed.length) continue
    const named = new Map(nameDings(unnamed, group, await tabLabels($, kind)).map(d => [d.pane, d]))
    found = found.map(d => named.get(d.pane) ?? d)
  }
  // A reload can retain dings from before they were scoped to this session's tree.
  const log = await update($, dings, l => settleDings(addDings(l.filter(d => treePanes.has(d.pane)), found), agents.filter(a => presentTreePanes.has(a.pane))))
  let nodes = built.nodes
  let repos = prev.repos
  let batch = prev.batch
  if (full) {
    nodes = await withUsage($, home, nodes)
    repos = await reposFor($, [...nodes.map(n => n.cwd), ...agents.map(a => a.cwd)])
    ;({ nodes, batch } = await withTickets($, nodes, repos, at))
    const seen = batch
    const before = await read($, pace)
    if (observeBatch(before, seen, at) !== before) await update($, pace, p => observeBatch(p, seen, at))
  }
  nodes = markErrors(nodes)
  await update($, snapshot, () => ({ at, root, nodes, all: agents, repos, batch, error: '' }))
  if (full) fullAt = at
  $.ui.status(statusLine(nodes, needYou(log)))
}

/** The snapshot, refreshed first when the last full refresh is older than FRESH_MS. It never waits for a change. */
async function freshSnapshot($: EngineInterface): Promise<Snapshot> {
  // A refresh already running may be a light one (no usage): then one more, full.
  for (let i = 0; i < 2 && (await $.clock.now()) - fullAt >= FRESH_MS; i++) await refresh($, true)
  return read($, snapshot)
}

async function teamStatus($: EngineInterface, scope: StatusScope): Promise<string> {
  const snap = await freshSnapshot($)
  return teamStatusText({ snap, dings: await read($, dings), pace: await read($, pace), scope })
}

/**
 * Sends one prompt to an errored agent, by its own multiplexer, after a fresh look at its status: an agent
 * working by then gets nothing. Every press ends in a toast: sent, or why not.
 */
async function continueAgent($: EngineInterface, pane: string, text: string): Promise<void> {
  const say = (msg: string) => $.ui.toast(`agent-tree: ${msg}`)
  const mux = await muxOf($)
  const agents = mux ? await listAgents($, mux) : null
  const known = (await read($, snapshot)).nodes.find(n => n.pane === pane)
  const name = known?.name || pane
  if (!agents) return say(`did not send continue to ${name}: ${mux ? `${muxName(mux)} is not answering` : 'not in a herdr or Rex pane'}`)
  const target = agents.find(a => a.pane === pane && (!known?.mux || a.mux === known.mux))
  if (!target) return say(`did not send continue to ${name}: it is no longer listed`)
  if (target.status === 'working') return say(`did not send continue to ${name}: it is working`)
  const argvs = promptArgvs(target, text)
  if (!argvs.length) return say(`did not send continue to ${name}: its Rex session is not known`)
  for (const argv of argvs) {
    const r = await $.process.run(argv, { timeoutMs: 5000 }).catch((err: unknown) => String(err))
    if (typeof r !== 'string' && r.exitCode === 0) continue
    const reason = typeof r === 'string' ? r : (argv[0] === 'herdr' ? herdrError(r.stdout) : '') || r.stderr.trim() || `exit ${r.exitCode}`
    return say(`could not send continue to ${name}: ${reason}`)
  }
  say(`sent continue to ${name}`)
}

// True from the moment this session opens the pane until ui.panes says it is gone: a session
// that never opened it asks nothing every 2 s (the mod loads in every session).
let mayBeOpen = false

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  if (!mayBeOpen) return false
  mayBeOpen = (await $.ui.panes()).some(p => p.id === PANE)
  return mayBeOpen
}

async function togglePane($: EngineInterface): Promise<boolean> {
  // A person asked: look, whatever the flag says.
  mayBeOpen = true
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return false
  }
  mayBeOpen = true
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  // Awaited, so the pane's first draw has data.
  await refresh($, true).catch(() => undefined)
  return true
}

export const register: Register = (on, options) => {
  // A spawn from this session becomes an edge. The call itself is never held up or refused.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.command ?? '')
    const isHerdr = invokesAgentStart(command)
    const watchHerdr = mayStartHerdr(command)
    const watchRex = invokesRexSpawn(command)
    if (!watchHerdr && !watchRex) return next(e)
    const mux = await muxOf($)
    // A herdr session keeps its original detection. A Rex session can start either kind of team.
    if (!mux || (mux.kind === 'herdr' && !isHerdr)) return next(e)
    const root = mux.root

    const before = await listAgents($, mux)
    const since = await $.clock.now()
    const res = await next(e)
    try {
      const out = res.result as { stdout?: unknown } | undefined
      const stdout = typeof out?.stdout === 'string' ? out.stdout : ''
      let started = mux.kind === 'herdr' ? parseStarted(stdout) : []
      if (!started.length && before) {
        const after = await listAgents($, mux)
        if (after) {
          started = newAgents(before, after).filter(a => a.pane !== root && (mux.kind === 'herdr' || (a.mux === 'herdr' ? watchHerdr : watchRex)))
          // A launcher may start the whole team at once. Record its lead; workspace adoption
          // then puts the new workers beneath that lead instead of beside it under Rex.
          if (mux.kind === 'rex') {
            const leads = started.filter(a => a.mux === 'herdr' && a.workspace && roleOf(a.name) === 'lead')
            started = started.filter(a => a.mux !== 'herdr' || roleOf(a.name) === 'lead' || !leads.some(l => l.workspace === a.workspace))
          }
        }
        // A block Rex just made may not run its agent yet: it is recorded by id, named by its label.
        if (after && mux.kind === 'rex' && watchRex && namesHarness(command)) {
          for (const id of parseRexStarted(stdout).filter(id => id !== root && !started.some(a => a.pane === id))) {
            started.push(after.find(a => a.pane === id) ?? rexPlaceholder(id, lastRex.names[id] ?? ''))
          }
        }
      }
      if (started.length) {
        const parentSession = before?.find(a => a.pane === root)?.session ?? ''
        await recordEdges($, root, parentSession, started, since)
      }
    } catch {
      $.ui.toast('agent-tree: the new worker was not recorded')
    }
    return res
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'agent-tree', description: 'Show or hide the tree of herdr or Rex agents this session spawned' })
    // A reload keeps an open pane but starts the module's flag over: look once.
    mayBeOpen = true
    await isPaneOpen($).catch(() => false)
    // A lead's view of its workers, without reading panes. Only where there is a tree to report.
    if (await muxOf($)) {
      await $.tool.register({
        name: TEAM_STATUS,
        description: TEAM_STATUS_DESCRIPTION,
        isDeferred: false,
        inputSchema: {
          type: 'object',
          properties: { scope: { type: 'string', enum: ['tree', 'all'], description: "tree (default): this session's tree; all: every listed agent, grouped by repo" } },
        },
      }).catch(() => undefined)
    }
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
        if (!mayBeOpen || !snap.nodes.some(n => n.status === 'working') || !(await isPaneOpen($))) return
        await update($, frame, f => f + 1)
      })().catch(() => undefined)
    })
    return started
  })

  on('tool.call', { tool: TEAM_STATUS_TOOL }, async ($, e) => {
    const scope = e.scope === 'all' ? 'all' : 'tree'
    try {
      return { result: await teamStatus($, scope) }
    } catch (err) {
      return { deny: `agent-tree: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  const continuePrompt = typeof options.continuePrompt === 'string' && options.continuePrompt.trim() ? options.continuePrompt : DEFAULT_CONTINUE

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
        dings: await read($, dings),
        pace: await read($, pace),
        cols: e.props.bodyColumns || 80,
        surface: e.surface,
      },
      {
        focus: pane => void focusRow($, pane),
        ack: pane => void ackDings($, pane),
        setPanel: fn => void update($, panel, fn),
        cont: pane => void continueAgent($, pane, continuePrompt).catch(() => undefined),
      },
    )
  })

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
}
