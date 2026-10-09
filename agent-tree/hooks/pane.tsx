import type { HerdrAgent, InProcRun, Panel, Snapshot, TreeNode } from '../types'
import { CRAB_ROWS, CRAB_WIDTH, MINI, ROLE_COLOR, halfBlock, moodOf, moodWord, spriteFor } from './crab'
import { costumeOfRole, crabSvg, heroSvg } from './svg-crab'
import { partition } from './tree'
import { fmtCost, fmtTime, fmtTokens, modelName } from './usage'
import {
  STATUS_COLOR,
  STATUS_GLYPH,
  clip,
  costText,
  countsLine,
  ctxPercent,
  dots,
  groupAll,
  isCompact,
  meterColor,
  modelLabel,
  rowColumns,
  spanText,
  totals,
  treePrefix,
} from './view'

export type PaneModel = { snap: Snapshot; panel: Panel; frame: number; inproc: InProcRun[]; cols: number; surface: string }
export type PaneActions = { focus: (pane: string) => void; setPanel: (fn: (p: Panel) => Panel) => void }

// `ui` is `$.ui.resolve(e)` for a Pane render; typed loosely so the terminal and desktop tables both fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

const NAME_MAX = 32
const METER_DOTS = 10
const TIME_WIDTH = 8

export function drawPane(ui: UI, m: PaneModel, act: PaneActions) {
  const { Box, Text, Button } = ui
  const Svg = m.surface === 'desktop' && 'Svg' in ui ? ui.Svg : null
  const { snap, panel } = m
  const compact = isCompact(panel.compact, m.cols)
  const { tree, finished } = partition(snap.nodes)
  const t = totals(snap.nodes)
  const mood = moodOf(snap.nodes, snap.batch)
  const shown = [...tree, ...(panel.isFinishedOpen ? finished : [])]
  const cols = rowColumns(shown, NAME_MAX)
  const hasUsage = shown.some(n => n.usage)
  // Fixed column widths line the rows up on the terminal; other surfaces lay them out themselves.
  const fixed = (width: number) => (m.surface === 'terminal' ? { width, flexShrink: 0 } : {})
  const dim = (isOn: boolean) => (isOn ? {} : { dimColor: true })

  const modeToggle = (
    <Box key="modes" flexDirection="row" gap={2}>
      <Button key="m-tree" label="Tree" plain {...dim(panel.mode === 'tree')} onPress={() => act.setPanel(p => ({ ...p, mode: 'tree' }))} />
      <Button key="m-all" label="All" plain {...dim(panel.mode === 'all')} onPress={() => act.setPanel(p => ({ ...p, mode: 'all' }))} />
      <Button
        key="m-compact"
        label={compact ? 'Expand' : 'Compact'}
        plain
        dimColor
        onPress={() => act.setPanel(p => ({ ...p, compact: compact ? 'off' : 'on' }))}
      />
    </Box>
  )

  const crab = compact ? (
    <Text key="crab-mini" color={ROLE_COLOR.lead}>
      🦀 {moodWord(mood)}
    </Text>
  ) : Svg ? (
    <Svg key="crab" source={heroSvg(mood)} alt={`crab: ${mood}`} width={34} height={32} />
  ) : (
    <Box key="crab" flexDirection="column" width={CRAB_WIDTH} flexShrink={0}>
      {halfBlock(spriteFor(mood, m.frame))
        .slice(0, CRAB_ROWS)
        .map((segs, y) => (
          <Text key={`c${y}`}>
            {segs.map((s, i) => (
              <Text key={`c${y}-${i}`} color={s.fg} backgroundColor={s.bg}>
                {s.text}
              </Text>
            ))}
          </Text>
        ))}
    </Box>
  )

  const batchPct = snap.batch && snap.batch.total ? (snap.batch.fixed / snap.batch.total) * 100 : 0
  const batchLine = snap.batch ? (
    <Box key="batch" flexDirection="row" gap={1}>
      <Text dimColor>batch {snap.batch.stamp}</Text>
      <Box flexDirection="row">
        {dots(batchPct, 12).filled ? <Text color="#3B9C5F">{dots(batchPct, 12).filled}</Text> : null}
        {dots(batchPct, 12).empty ? <Text dimColor>{dots(batchPct, 12).empty}</Text> : null}
      </Box>
      <Text dimColor>{`${snap.batch.fixed}/${snap.batch.total} fixed · ${snap.batch.inProgress} in progress`}</Text>
    </Box>
  ) : null

  const summary = (
    <Box key="summary" flexDirection="column">
      <Text bold wrap="truncate-end">{`${moodWord(mood)} · ${countsLine(snap.nodes)}`}</Text>
      <Text dimColor wrap="truncate-end">{`≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} tok · ${fmtTime(t.time)} elapsed`}</Text>
      {batchLine}
      {snap.error ? <Text color="#D0453F">{snap.error}</Text> : null}
    </Box>
  )

  // The name is the row's button in both layouts: pressing it focuses that agent's herdr pane.
  const nameButton = (n: TreeNode, width: number) => (
    <Button key={`f-${n.pane}-${n.startedAt}`} label={clip(n.name, Math.max(4, width))} plain onPress={() => act.focus(n.pane)} />
  )

  const meter = (n: TreeNode) => {
    if (!n.usage) return null
    const pct = ctxPercent(n.usage)
    const d = dots(pct, METER_DOTS)
    return (
      <Box key="meter" flexDirection="row" gap={1}>
        <Box flexDirection="row">
          {d.filled ? <Text color={meterColor(pct)}>{d.filled}</Text> : null}
          {d.empty ? <Text dimColor>{d.empty}</Text> : null}
        </Box>
        <Text color={meterColor(pct)}>{`${pct}%`}</Text>
      </Box>
    )
  }

  const nodeRow = (n: TreeNode) => {
    if (compact)
      return (
        <Box key={`${n.pane}-${n.startedAt}`} flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[n.status]}>{STATUS_GLYPH[n.status]}</Text>
          {nameButton(n, m.cols - 8)}
          {n.usage ? <Text color={meterColor(ctxPercent(n.usage))}>{`${ctxPercent(n.usage)}%`}</Text> : null}
        </Box>
      )
    const prefix = treePrefix(n)
    const note = [n.ticket, n.status === 'blocked' || n.status === 'done' ? n.title : ''].filter(Boolean).join(' ')
    return (
      <Box key={`${n.pane}-${n.startedAt}`} flexDirection="row" gap={1}>
        <Box key="name" flexDirection="row" {...fixed(cols.name + 5)}>
          {prefix ? <Text dimColor>{prefix}</Text> : null}
          <Text color={STATUS_COLOR[n.status]}>{`${STATUS_GLYPH[n.status]} `}</Text>
          {Svg ? (
            <Svg key={`cr-${n.pane}`} source={crabSvg(costumeOfRole(n.role), n.status === 'working')} alt={n.role} width={34} height={32} />
          ) : (
            <Text color={ROLE_COLOR[n.role]}>{`${MINI} `}</Text>
          )}
          {nameButton(n, cols.name - prefix.length)}
        </Box>
        {cols.harness ? (
          <Box key="harness" {...fixed(cols.harness)}>
            <Text dimColor>{n.harness}</Text>
          </Box>
        ) : null}
        {hasUsage ? (
          <Box key="model" {...fixed(cols.model)}>
            <Text dimColor>{modelLabel(n.usage)}</Text>
          </Box>
        ) : null}
        {hasUsage ? (
          <Box key="ctx" {...fixed(METER_DOTS + 5)}>
            {meter(n)}
          </Box>
        ) : null}
        {hasUsage ? (
          <Box key="cost" {...fixed(cols.cost)}>
            <Text dimColor>{costText(n.usage)}</Text>
          </Box>
        ) : null}
        <Box key="time" {...fixed(TIME_WIDTH)}>
          <Text dimColor>{spanText(n)}</Text>
        </Box>
        {note ? (
          <Text key="note" dimColor wrap="truncate-end">
            {note}
          </Text>
        ) : null}
      </Box>
    )
  }

  const allName = Math.min(NAME_MAX, snap.all.reduce((w, a) => Math.max(w, (a.name || a.pane).length), 0))
  const allHarness = snap.all.reduce((w, a) => Math.max(w, a.harness.length), 0)
  const allRow = (a: HerdrAgent) => (
    <Box key={`all-${a.pane}`} flexDirection="row" gap={1}>
      <Text>{a.status === 'working' ? '●' : a.status === 'blocked' ? '!' : a.status === 'done' ? '✓' : '◌'}</Text>
      <Box key="name" {...(compact ? {} : fixed(allName))}>
        <Button key={`fa-${a.pane}`} label={clip(a.name || a.pane, compact ? Math.max(4, m.cols - 4) : allName)} plain onPress={() => act.focus(a.pane)} />
      </Box>
      {compact ? null : (
        <Box key="harness" {...fixed(allHarness)}>
          <Text dimColor>{a.harness}</Text>
        </Box>
      )}
      {compact ? null : (
        <Text key="title" dimColor wrap="truncate-end">
          {a.title || a.label}
        </Text>
      )}
    </Box>
  )

  const section = (key: string, label: string, isOpen: boolean, toggle: (p: Panel) => Panel) => (
    <Button key={key} label={`${isOpen ? '▾' : '▸'} ${label}`} plain onPress={() => act.setPanel(toggle)} />
  )

  const body =
    panel.mode === 'all' ? (
      <Box key="all" flexDirection="column">
        {groupAll(snap.all, snap.repos).map(([repo, list]) => (
          <Box key={`g-${repo}`} flexDirection="column">
            <Text bold>{repo}</Text>
            {list.map(allRow)}
          </Box>
        ))}
      </Box>
    ) : (
      <Box key="tree" flexDirection="column">
        {tree.length === 0 && finished.length === 0 ? <Text dimColor>No workers spawned from this session yet.</Text> : null}
        {tree.map(nodeRow)}
        {finished.length ? section('s-fin', `Finished · ${finished.length}`, panel.isFinishedOpen, p => ({ ...p, isFinishedOpen: !p.isFinishedOpen })) : null}
        {panel.isFinishedOpen ? finished.map(nodeRow) : null}
      </Box>
    )

  const inprocRows = m.inproc.length ? (
    <Box key="inproc" flexDirection="column">
      {section('s-in', `In-process · ${m.inproc.length}`, panel.isInProcessOpen, p => ({ ...p, isInProcessOpen: !p.isInProcessOpen }))}
      {panel.isInProcessOpen
        ? [...m.inproc].reverse().map(r => (
            <Text key={`ip-${r.id}`} dimColor wrap="truncate-end">
              {r.status === 'running' ? '●' : r.status === 'done' ? '✓' : '✗'} {r.description || r.type} · {modelName(r.model)} ≈{fmtCost(r.costUsd)}
            </Text>
          ))
        : null}
    </Box>
  ) : null

  return (
    <Box flexDirection="column" gap={compact ? 0 : 1}>
      {modeToggle}
      <Box key="head" flexDirection={compact ? 'column' : 'row'} gap={2}>
        {crab}
        {summary}
      </Box>
      {body}
      {inprocRows}
    </Box>
  )
}
