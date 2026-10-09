import type { HerdrAgent, NodeStatus, Panel, TreeNode, Usage } from '../types'
import { repoName } from './tickets'
import { isLive } from './tree'
import { fmtCost, fmtTime, modelName, windowOf } from './usage'

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

// The colours and thresholds of build_bar in ~/.claude/statusline.sh, so the pane reads like the status line.
export const meterColor = (pct: number): string => (pct >= 90 ? '#FF5555' : pct >= 70 ? '#E6C800' : pct >= 50 ? '#FFB055' : '#00A000')

/** ● filled (rounded down, as build_bar does) and ○ empty. */
export const dots = (pct: number, width: number): { filled: string; empty: string } => {
  const filled = Math.floor((Math.min(100, Math.max(0, pct)) * width) / 100)
  return { filled: '●'.repeat(filled), empty: '○'.repeat(width - filled) }
}

/** How long a row has run. A row recorded after its pane closed was never seen running: no time. */
export const spanText = (n: TreeNode): string => (n.status === 'gone' && n.lastSeen <= n.startedAt ? '—' : fmtTime(n.lastSeen - n.startedAt))

export const modelLabel = (u: Usage | null): string => (!u || !u.model ? '' : u.effort ? `${modelName(u.model)}·${u.effort}` : modelName(u.model))

export const countsLine = (nodes: TreeNode[]): string => {
  if (!nodes.length) return 'no workers yet'
  const count = (f: (n: TreeNode) => boolean) => nodes.filter(f).length
  const parts: [number, string][] = [
    [count(n => n.status === 'working'), 'working'],
    [count(n => n.status === 'idle'), 'idle'],
    [count(n => n.status === 'blocked'), 'blocked'],
    [count(n => n.status === 'done' || n.status === 'gone'), 'finished'],
  ]
  return parts
    .filter(([k]) => k > 0)
    .map(([k, label]) => `${k} ${label}`)
    .join(' · ')
}

export const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

export const costText = (u: Usage | null): string => (u ? `≈${fmtCost(u.costUsd)}` : '')

/** Column widths so rows line up: the name column holds the tree prefix too, capped at `maxName`. */
export const rowColumns = (nodes: TreeNode[], maxName: number): { name: number; harness: number; model: number; cost: number } => {
  const widest = (f: (n: TreeNode) => number) => nodes.reduce((w, n) => Math.max(w, f(n)), 0)
  return {
    name: Math.min(maxName, widest(n => treePrefix(n).length + n.name.length)),
    harness: widest(n => n.harness.length),
    model: widest(n => modelLabel(n.usage).length),
    cost: widest(n => costText(n.usage).length),
  }
}
