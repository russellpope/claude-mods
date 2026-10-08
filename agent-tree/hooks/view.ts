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
