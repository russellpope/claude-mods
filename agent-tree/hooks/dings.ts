import type { Ding, Edge, HerdrAgent, TreeNode } from '../types'
import { isLive, statusOf } from './tree'

/** pane → the pane that spawned it. A pane with no entry is a top-level session. */
export type Parents = Record<string, string>

export type DingInput = { prev: HerdrAgent[]; prevAt: number; next: HerdrAgent[]; at: number; parents: Parents }

export const KEEP_DINGS = 50

// The poll runs every 2 s with the pane open, every 10 s without. A list older than this missed
// turns that began and ended unseen, so comparing with it would put old dings at the wrong time.
const STALE_MS = 30_000

/** Who an agent's ding needs: `why` is empty when it needs you. */
const judge = (a: HerdrAgent, kind: Ding['kind'], byPane: Map<string, HerdrAgent>, parents: Parents): string => {
  if (kind === 'asking') return ''
  const lead = parents[a.pane]
  if (lead === undefined) return ''
  // Spawned by a top-level session: a lead, which ends turns while it waits on its workers.
  if (parents[lead] === undefined) return /^DONE:/i.test(a.title) ? '' : 'turn ended, not DONE:'
  const l = byPane.get(lead)
  return l && isLive(statusOf(l)) ? `${l.name || lead} still running` : ''
}

/**
 * The changes herdr plays a sound for between two agent lists: a turn that ended in a background
 * tab (working → done) and an agent that started asking for input (→ blocked).
 */
export const findDings = ({ prev, prevAt, next, at, parents }: DingInput): Ding[] => {
  if (!prevAt || at - prevAt > STALE_MS) return []
  const before = new Map(prev.map(a => [a.pane, a]))
  const byPane = new Map(next.map(a => [a.pane, a]))
  const found: Ding[] = []
  for (const a of next) {
    const b = before.get(a.pane)
    if (!b || b.terminal !== a.terminal) continue
    const isAsking = a.status === 'blocked' && b.status !== 'blocked'
    if (!isAsking && !(b.status === 'working' && a.status === 'done')) continue
    const kind = isAsking || /^BLOCKED:/i.test(a.title) ? 'asking' : 'finished'
    const why = judge(a, kind, byPane, parents)
    found.push({ at, pane: a.pane, terminal: a.terminal, name: a.name || a.pane, kind, title: a.title || a.label, why, needsYou: !why, isOpen: !why })
  }
  return found
}

/** Appends new dings, closing the older open ones of the same panes, and keeps the newest KEEP_DINGS. */
export const addDings = (list: Ding[], found: Ding[]): Ding[] => {
  if (!found.length) return list
  const panes = new Set(found.map(d => d.pane))
  return [...list.map(d => (d.isOpen && panes.has(d.pane) ? { ...d, isOpen: false } : d)), ...found].slice(-KEEP_DINGS)
}

/** An open ding closes once its agent works again or has left its pane. */
export const settleDings = (list: Ding[], agents: HerdrAgent[]): Ding[] => {
  if (!list.some(d => d.isOpen)) return list
  const byPane = new Map(agents.map(a => [a.pane, a]))
  return list.map(d => {
    if (!d.isOpen) return d
    const a = byPane.get(d.pane)
    return a && a.terminal === d.terminal && a.status !== 'working' ? d : { ...d, isOpen: false }
  })
}

/** How many dings still need you. */
export const needYou = (list: Ding[]): number => list.filter(d => d.isOpen).length

export const markSeen =(list: Ding[], pane: string): Ding[] => list.map(d => (d.isOpen && d.pane === pane ? { ...d, isOpen: false } : d))

/** Parents from every recorded spawn (a pane's newest wins) and from the tree's inferred workers. */
export const parentsOf = (edges: Edge[], nodes: TreeNode[]): Parents => {
  const parents: Parents = {}
  for (const e of [...edges].sort((a, b) => a.at - b.at)) parents[e.child] = e.parent
  for (const n of nodes) if (n.inferred) parents[n.pane] = n.parent
  return parents
}
