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
