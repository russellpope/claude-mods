import type { HerdrAgent, InProcRun, Panel, Snapshot, TreeNode } from '../types'
import { CRAB_ROWS, MINI, ROLE_COLOR, halfBlock, moodOf, moodTag, spriteFor } from './crab'
import { costumeOfRole, crabSvg, heroSvg } from './svg-crab'
import { partition } from './tree'
import { fmtCost, fmtTime, fmtTokens, modelName } from './usage'
import { STATUS_COLOR, STATUS_GLYPH, ctxBar, ctxPercent, groupAll, isCompact, totals, treePrefix } from './view'

export type PaneModel = { snap: Snapshot; panel: Panel; frame: number; inproc: InProcRun[]; cols: number; surface: string }
export type PaneActions = { focus: (pane: string) => void; setPanel: (fn: (p: Panel) => Panel) => void }

// `ui` is `$.ui.resolve(e)` for a Pane render; typed loosely so the terminal and desktop tables both fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

const usageText = (n: TreeNode): string => {
  if (!n.usage) return ''
  const model = n.usage.effort ? `${modelName(n.usage.model)}·${n.usage.effort}` : modelName(n.usage.model)
  return `${model}  ctx ${ctxPercent(n.usage)}% ${ctxBar(ctxPercent(n.usage), 5)} ≈${fmtCost(n.usage.costUsd)}`
}

export function drawPane(ui: UI, m: PaneModel, act: PaneActions) {
  const { Box, Text, Button } = ui
  const Svg = m.surface === 'desktop' && 'Svg' in ui ? ui.Svg : null
  const { snap, panel } = m
  const compact = isCompact(panel.compact, m.cols)
  const { tree, finished } = partition(snap.nodes)
  const t = totals(snap.nodes)
  const mood = moodOf(snap.nodes, snap.batch)
  const tag = moodTag(mood, m.frame)

  const modeToggle = (
    <Box key="modes" flexDirection="row" gap={1}>
      <Button key="m-tree" label={panel.mode === 'tree' ? '[Tree]' : 'Tree'} plain onPress={() => act.setPanel(p => ({ ...p, mode: 'tree' }))} />
      <Button key="m-all" label={panel.mode === 'all' ? '[All]' : 'All'} plain onPress={() => act.setPanel(p => ({ ...p, mode: 'all' }))} />
      <Button
        key="m-compact"
        label={compact ? 'Expand' : 'Compact'}
        plain
        onPress={() => act.setPanel(p => ({ ...p, compact: compact ? 'off' : 'on' }))}
      />
    </Box>
  )

  const crab = compact ? (
    <Text key="crab-mini" color={ROLE_COLOR.lead}>
      🦀 {mood}
    </Text>
  ) : Svg ? (
    <Svg key="crab" source={heroSvg(mood)} alt={`crab: ${mood}`} width={34} height={32} />
  ) : (
    <Box key="crab" flexDirection="column" width={18} flexShrink={0}>
      {halfBlock(spriteFor(mood, m.frame)).slice(0, CRAB_ROWS).map((segs, y) => (
        <Text key={`c${y}`}>
          {segs.map((s, i) => (
            <Text key={`c${y}-${i}`} color={s.fg} backgroundColor={s.bg}>
              {s.text}
            </Text>
          ))}
          {y === 0 && tag.text ? <Text color={tag.color}> {tag.text}</Text> : null}
        </Text>
      ))}
    </Box>
  )

  const summary = (
    <Box key="summary" flexDirection="column">
      <Text dimColor>
        ≈{fmtCost(t.cost)} · {fmtTokens(t.tokens)} tok · {fmtTime(t.time)}
      </Text>
      {snap.batch ? (
        <Text wrap="truncate-end">
          batch {snap.batch.stamp} <Text color="#3B9C5F">{ctxBar(snap.batch.total ? (snap.batch.fixed / snap.batch.total) * 100 : 0, 12)}</Text> {snap.batch.fixed}/
          {snap.batch.total} fixed · {snap.batch.inProgress} in-progress
        </Text>
      ) : null}
      {snap.error ? <Text color="#D0453F">{snap.error}</Text> : null}
    </Box>
  )

  // The name is the row's button in both layouts: pressing it focuses that agent's herdr pane.
  const nameButton = (n: TreeNode) => <Button key={`f-${n.pane}-${n.startedAt}`} label={n.name} plain onPress={() => act.focus(n.pane)} />

  const nodeRow = (n: TreeNode) =>
    compact ? (
      <Box key={`${n.pane}-${n.startedAt}`} flexDirection="row" gap={1}>
        <Text color={STATUS_COLOR[n.status]}>{STATUS_GLYPH[n.status]}</Text>
        {nameButton(n)}
        {n.usage ? <Text dimColor>{ctxPercent(n.usage)}%</Text> : null}
      </Box>
    ) : (
      <Box key={`${n.pane}-${n.startedAt}`} flexDirection="row" gap={1}>
        <Text dimColor>{treePrefix(n)}</Text>
        <Text color={STATUS_COLOR[n.status]}>{STATUS_GLYPH[n.status]}</Text>
        {Svg ? (
          <Svg key={`cr-${n.pane}`} source={crabSvg(costumeOfRole(n.role), n.status === 'working')} alt={n.role} width={34} height={32} />
        ) : (
          <Text color={ROLE_COLOR[n.role]}>{MINI}</Text>
        )}
        {nameButton(n)}
        <Text dimColor wrap="truncate-end">
          {n.harness} {usageText(n)} {fmtTime(n.lastSeen - n.startedAt)} {n.ticket}
          {n.status === 'blocked' || n.status === 'done' ? ` ${n.title}` : ''}
        </Text>
      </Box>
    )

  const allRow = (a: HerdrAgent) => (
    <Box key={`all-${a.pane}`} flexDirection="row" gap={1}>
      <Text>{a.status === 'working' ? '●' : a.status === 'blocked' ? '!' : a.status === 'done' ? '✓' : '◌'}</Text>
      <Button key={`fa-${a.pane}`} label={a.name || a.pane} plain onPress={() => act.focus(a.pane)} />
      <Text dimColor wrap="truncate-end">
        {a.harness} {a.title || a.label}
      </Text>
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
    <Box flexDirection="column">
      {modeToggle}
      <Box key="head" flexDirection={compact ? 'column' : 'row'} gap={1}>
        {crab}
        {summary}
      </Box>
      {body}
      {inprocRows}
    </Box>
  )
}
