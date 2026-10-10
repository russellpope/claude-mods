import type { Panel, Run, Snapshot, Stage } from '../types'
import { bar, columns, fmtAgo, fmtDuration, glyph, pickRuns, runDuration, stageDuration, stateColor, stateWord } from './kintsugi'

export type PaneModel = { snap: Snapshot; panel: Panel; frame: number; now: number; cols: number; surface: string }
export type PaneActions = { pin: (id: string) => void }

// `ui` is `$.ui.resolve(e)` for a Pane render; typed loosely so the terminal and desktop tables both fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

export function drawPane(ui: UI, m: PaneModel, act: PaneActions) {
  const { Box, Text, Button } = ui
  const { snap, panel, frame, now } = m
  // Fixed column widths line the rows up on the terminal; other surfaces lay them out themselves.
  const fixed = (width: number) => (m.surface === 'terminal' ? { width, flexShrink: 0 } : {})
  const paint = (state: string) => {
    const c = stateColor(state)
    return c ? { color: c } : { dimColor: true }
  }
  const isAll = snap.isResolved && !snap.project
  const { current, recent } = pickRuns(snap.runs, snap.project?.id ?? null, panel.pinned)

  // The project is named only when the tab covers every project; the state keeps its width
  // so a narrow dock truncates the title instead of wrapping the state under it.
  const header = (run: Run) => (
    <Box key="head" flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold wrap="truncate-end">
          {[isAll ? run.project : '', run.title, run.ref, run.sha].filter(Boolean).join(' · ')}
        </Text>
        <Box key="state" flexShrink={0}>
          <Text {...paint(run.state)}>{`${glyph(run.state, frame)} ${stateWord(run.state)}`}</Text>
        </Box>
      </Box>
      <Text dimColor>{`started ${fmtAgo(now - run.createdAt)}`}</Text>
    </Box>
  )

  const pipeline = (run: Run) => (
    <Text key="pipe">
      {run.stages.flatMap((s, i) => [
        i ? (
          <Text key={`a${i}`} dimColor>
            {' → '}
          </Text>
        ) : null,
        <Text key={`s${i}`} {...paint(s.state)}>{`${glyph(s.state, frame)} ${s.name}`}</Text>,
      ])}
    </Text>
  )

  const jobs = (run: Run) => {
    const c = columns(m.cols, run.stages)
    const row = (s: Stage) => {
      const d = stageDuration(s, now)
      const b = c.timing ? bar(s, run, now, c.timing) : null
      return (
        <Box key={`job-${s.name}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Box {...fixed(c.state)}>
            <Text {...paint(s.state)}>{`${glyph(s.state, frame)} ${stateWord(s.state)}`}</Text>
          </Box>
          <Box {...fixed(c.stage)}>
            <Text wrap="truncate-end">{s.name}</Text>
          </Box>
          {c.exit ? (
            <Box {...fixed(c.exit)} justifyContent="flex-end">
              <Text dimColor>{s.exitCode === null ? '—' : String(s.exitCode)}</Text>
            </Box>
          ) : null}
          <Box {...fixed(c.time)} justifyContent="flex-end">
            <Text dimColor>{d === null ? '—' : fmtDuration(d)}</Text>
          </Box>
          {b && b.fill ? (
            <Box key={`bar-${s.name}`} flexDirection="row" {...fixed(c.timing)}>
              {b.lead ? <Text dimColor>{'·'.repeat(b.lead)}</Text> : null}
              <Text {...paint(s.state)}>{'━'.repeat(b.fill)}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }
    return (
      <Box key="jobs" flexDirection="column">
        {run.stages.map(row)}
      </Box>
    )
  }

  const recentRows = recent.length ? (
    <Box key="recent" flexDirection="column">
      <Box key="recent-head" flexDirection="row" gap={2}>
        <Text bold>Recent</Text>
        {panel.pinned && current?.id === panel.pinned ? <Button key="follow" label="Follow" plain onPress={() => act.pin('')} /> : null}
      </Box>
      {recent.map(r => (
        <Box key={`rr-${r.id}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Text {...paint(r.state)}>{glyph(r.state, frame)}</Text>
          <Button
            key={`r-${r.id}`}
            plain
            label={clip([isAll ? r.project : '', r.sha, r.title, fmtDuration(runDuration(r, now)), fmtAgo(now - r.createdAt)].filter(Boolean).join('  '), Math.max(8, m.cols - 6))}
            onPress={() => act.pin(r.id)}
          />
        </Box>
      ))}
    </Box>
  ) : null

  const scopeNote = isAll ? (
    <Text key="scope" dimColor>
      This repo is not enrolled in kintsugi · all projects
    </Text>
  ) : null

  const empty = !current ? (
    <Text key="empty" dimColor>
      {!snap.seenAt && !snap.error ? 'Reading kintsugi…' : snap.project ? `No kintsugi runs yet for ${snap.project.name}.` : 'No kintsugi runs yet.'}
    </Text>
  ) : null

  const footer = (
    <Box key="foot" flexDirection="column">
      {snap.error ? <Text color="error">{snap.error}</Text> : null}
      {snap.seenAt ? <Text dimColor>{`seen ${fmtAgo(now - snap.seenAt)}`}</Text> : null}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {scopeNote}
      {current ? (
        <Box key="run" flexDirection="column">
          {header(current)}
          {current.detail ? <Text dimColor>{current.detail}</Text> : null}
          {pipeline(current)}
        </Box>
      ) : (
        empty
      )}
      {current ? jobs(current) : null}
      {recentRows}
      {footer}
    </Box>
  )
}
