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

// herdr's `done` only says a turn ended. Finished work is a `DONE:` title (or a gone pane).
export const statusOf = (a: HerdrAgent | null): NodeStatus => {
  if (!a) return 'gone'
  if (a.status === 'blocked') return 'blocked'
  if (a.status === 'working') return 'working'
  if (/^BLOCKED:/i.test(a.title)) return 'blocked'
  if (/^DONE:/i.test(a.title)) return 'done'
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
  // The live agent an edge holds: its pane's newest edge, on the terminal it was first seen on.
  const holderOf = (e: Edge): HerdrAgent | null => {
    const a = byPane.get(e.child)
    const bound = bindings[edgeFileName(e)]
    return a && nextIncarnationAt(e) === Infinity && (bound === undefined || bound === a.terminal) ? a : null
  }
  const wsOf = (pane: string): string => byPane.get(pane)?.workspace || pane.split(':')[0] || pane
  // Agents some edge accounts for (in any session's tree) are never inferred.
  const claimed = new Set([root, ...sorted.map(holderOf).flatMap(a => (a ? [a.pane] : []))])
  // A team lead puts its workers in its own workspace. The first live node in a workspace owns it
  // and adopts the unrecorded agents there. The root's workspace is the user's, never a team's.
  const owned = new Set([wsOf(root)])
  const nodes: TreeNode[] = []

  type Kid = { at: number; edge?: Edge; agent?: HerdrAgent; prev?: TreeNode }
  const visit = (pane: string, from: number, until: number, depth: number, path: Set<string>, isHeld: boolean) => {
    const inWindow = (t: number) => t >= from && t < until
    const kids: Kid[] = sorted.filter(e => e.parent === pane && inWindow(e.at) && !path.has(e.child)).map(e => ({ at: e.at, edge: e }))
    const ws = wsOf(pane)
    const adopted = isHeld && !owned.has(ws) ? agents.filter(a => a.workspace === ws && !claimed.has(a.pane) && !path.has(a.pane)) : []
    if (isHeld) owned.add(ws)
    const priorInferred = previous.filter(p => p.inferred && p.parent === pane && inWindow(p.startedAt))
    const inferred: Kid[] = [
      ...adopted.map(a => {
        const prev = priorInferred.find(p => p.pane === a.pane && p.terminal === a.terminal)
        return { at: prev?.startedAt ?? at, agent: a, prev }
      }),
      ...priorInferred.filter(p => !adopted.some(a => a.pane === p.pane && a.terminal === p.terminal)).map(p => ({ at: p.startedAt, prev: p })),
    ].sort((a, b) => a.at - b.at)
    const all = [...kids, ...inferred]
    all.forEach((k, i) => {
      const isLast = i === all.length - 1
      const e = k.edge
      if (!e) {
        const a = k.agent ?? null
        const name = a?.name || k.prev?.name || k.prev?.pane || ''
        nodes.push({
          pane: a?.pane ?? k.prev?.pane ?? '',
          parent: pane,
          depth,
          isLast,
          name,
          harness: a?.harness ?? k.prev?.harness ?? '',
          role: roleOf(name),
          status: statusOf(a),
          title: a?.title ?? k.prev?.title ?? '',
          cwd: a?.cwd ?? k.prev?.cwd ?? '',
          session: a?.session ?? k.prev?.session ?? '',
          startedAt: k.at,
          lastSeen: a ? at : (k.prev?.lastSeen ?? k.at),
          usage: k.prev?.usage ?? null,
          ticket: k.prev?.ticket ?? '',
          inferred: true,
          terminal: a?.terminal ?? k.prev?.terminal ?? '',
        })
        return
      }
      const key = edgeFileName(e)
      const holder = holderOf(e)
      if (holder && bindings[key] === undefined) bindings[key] = holder.terminal
      const prev = previous.find(p => p.pane === e.child && p.startedAt === e.at && !p.inferred)
      nodes.push({
        pane: e.child,
        parent: e.parent,
        depth,
        isLast,
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
      visit(e.child, e.at, nextIncarnationAt(e), depth + 1, new Set([...path, e.child]), holder !== null)
    })
  }
  visit(root, -Infinity, Infinity, 0, new Set([root]), false)
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
