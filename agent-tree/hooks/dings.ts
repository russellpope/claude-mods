import type { Ding, Edge, HerdrAgent, TreeNode } from '../types'
import { isLive, statusOf } from './tree'

/** pane → the pane that spawned it. A pane with no entry is a top-level session. */
export type Parents = Record<string, string>

export type DingInput = { prev: HerdrAgent[]; prevAt: number; next: HerdrAgent[]; at: number; root: string; parents: Parents }

// Open dings are all kept (a pane has at most one); of the acknowledged ones, the newest this many.
export const KEEP_ACKED = 10

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
export const findDings = ({ prev, prevAt, next, at, root, parents }: DingInput): Ding[] => {
  if (!prevAt || at - prevAt > STALE_MS) return []
  const before = new Map(prev.map(a => [a.pane, a]))
  const byPane = new Map(next.map(a => [a.pane, a]))
  const found: Ding[] = []
  for (const a of next) {
    // The session drawing the pane: you are reading it.
    if (a.pane === root) continue
    const b = before.get(a.pane)
    if (!b || b.terminal !== a.terminal) continue
    const isAsking = a.status === 'blocked' && b.status !== 'blocked'
    if (!isAsking && !(b.status === 'working' && a.status === 'done')) continue
    const kind = isAsking || /^BLOCKED:/i.test(a.title) ? 'asking' : 'finished'
    const why = judge(a, kind, byPane, parents)
    found.push({ at, pane: a.pane, terminal: a.terminal, name: a.name, kind, title: a.title || a.label, why, needsYou: !why, isOpen: !why })
  }
  return found
}

/** Every open ding, and the newest KEEP_ACKED closed ones, in the order they came. */
const trim = (list: Ding[]): Ding[] => {
  const closed = list.filter(d => !d.isOpen)
  if (closed.length <= KEEP_ACKED) return list
  const dropped = new Set(closed.slice(0, closed.length - KEEP_ACKED))
  return list.filter(d => !dropped.has(d))
}

/** Appends new dings, closing the older open ones of the same panes. */
export const addDings = (list: Ding[], found: Ding[]): Ding[] => {
  if (!found.length) return list
  const panes = new Set(found.map(d => d.pane))
  return trim([...list.map(d => (d.isOpen && panes.has(d.pane) ? { ...d, isOpen: false } : d)), ...found])
}

/** An open ding closes once its agent works again or has left its pane. */
export const settleDings = (list: Ding[], agents: HerdrAgent[]): Ding[] => {
  if (!list.some(d => d.isOpen)) return list
  const byPane = new Map(agents.map(a => [a.pane, a]))
  return trim(
    list.map(d => {
      if (!d.isOpen) return d
      const a = byPane.get(d.pane)
      return a && a.terminal === d.terminal && a.status !== 'working' ? d : { ...d, isOpen: false }
    }),
  )
}

/** How many dings still need you. */
export const needYou = (list: Ding[]): number => list.filter(d => d.isOpen).length

/** Acks a pane's open dings: you pressed its ✓, or its name and went there. */
export const markSeen = (list: Ding[], pane: string): Ding[] => trim(list.map(d => (d.isOpen && d.pane === pane ? { ...d, isOpen: false } : d)))

export const ackAll = (list: Ding[]): Ding[] => trim(list.map(d => (d.isOpen ? { ...d, isOpen: false } : d)))

/** Parents from every recorded spawn (a pane's newest wins) and from the tree's inferred workers. */
export const parentsOf = (edges: Edge[], nodes: TreeNode[]): Parents => {
  const parents: Parents = {}
  for (const e of [...edges].sort((a, b) => a.at - b.at)) parents[e.child] = e.parent
  for (const n of nodes) if (n.inferred) parents[n.pane] = n.parent
  return parents
}

/** A ding herdr has no agent name for takes its tab's label, as herdr's tab bar shows it, else its pane. */
export const nameDings = (found: Ding[], agents: HerdrAgent[], labels: Record<string, string>): Ding[] =>
  found.map(d => (d.name ? d : { ...d, name: labels[agents.find(a => a.pane === d.pane)?.tab ?? ''] || d.pane }))
