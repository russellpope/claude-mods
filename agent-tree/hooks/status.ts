import type { Ding, HerdrAgent, Snapshot, TreeNode } from '../types'
import { batchText } from './pace'
import type { Pace } from './pace'
import { countsLine, ctxPercent, errorNote, groupAll, modelLabel, needText, spanText, wasText } from './view'

export type StatusScope = 'tree' | 'all'

export type StatusInput = { snap: Snapshot; dings: Ding[]; pace: Pace | null; scope: StatusScope }

const TITLE = /^(DONE|BLOCKED):/i

/** One node: indent by depth, then its fields; an empty field is left out. */
const nodeLine = (n: TreeNode): string => {
  const model = modelLabel(n.usage)
  const parts = [
    n.name,
    n.role,
    n.status,
    n.apiError ? errorNote(n.apiError) : '',
    n.ticket,
    model && n.usage?.was ? `${model} (${wasText(n.usage.was)})` : model,
    n.usage?.model ? `ctx ${ctxPercent(n.usage)}%` : '',
    `${spanText(n)} in tree`,
    TITLE.test(n.title) ? n.title : '',
    `pane ${n.pane}`,
  ]
  return `${'  '.repeat(n.depth)}${parts.filter(Boolean).join(' · ')}`
}

const agentLine = (a: HerdrAgent): string => `  ${[a.name || a.pane, a.harness, a.status, a.title || a.label, `pane ${a.pane}`].filter(Boolean).join(' · ')}`

/**
 * team_status's answer, plain text for a model: a header with the counts, the dings that need you and the batch,
 * then one line per tree node (or, for `all`, every listed agent by repo).
 */
export const teamStatusText = ({ snap, dings, pace, scope }: StatusInput): string => {
  const open = dings.filter(d => d.isOpen)
  const names = [...new Set(open.map(d => d.name || d.pane))]
  const header = [
    countsLine(snap.nodes),
    open.length ? `${needText(open.length)}: ${names.join(', ')}` : '',
    snap.batch ? `batch ${snap.batch.stamp} ${batchText(snap.batch, pace)}` : '',
    scope === 'all' ? `${snap.all.length} agent${snap.all.length === 1 ? '' : 's'} listed` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const stale = snap.error ? [`${snap.error} Last state seen:`] : []
  if (scope === 'all') return [...stale, header, ...groupAll(snap.all, snap.repos).flatMap(([repo, list]) => [repo, ...list.map(agentLine)])].join('\n')
  if (!snap.nodes.length) return [...stale, 'No workers spawned from this session yet.'].join('\n')
  return [...stale, header, ...snap.nodes.map(nodeLine)].join('\n')
}
