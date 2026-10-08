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
