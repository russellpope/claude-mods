import type { Run, Snapshot, Stage } from '../types'
import { bar, columns, currentRun, fmtAgo, fmtDuration, glyph, runDuration, stageDuration, stateColor, stateWord, timingTrack } from './kintsugi'

export type PaneModel = { snap: Snapshot; frame: number; now: number; cols: number; surface: string }

// `ui` is `$.ui.resolve(e)` for a Pane render; typed loosely so the terminal and desktop tables both fit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

export function drawPane(ui: UI, m: PaneModel) {
  const { Box, Text } = ui
  const { snap, frame, now } = m
  // Fixed column widths line the rows up on the terminal; other surfaces lay them out themselves.
  const fixed = (width: number) => (m.surface === 'terminal' ? { width, flexShrink: 0 } : {})
  const paint = (state: string) => {
    const c = stateColor(state)
    return c ? { color: c } : { dimColor: true }
  }
  const isAll = snap.isResolved && !snap.project
  const current = currentRun(snap.runs, snap.project?.id ?? null)

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
        </Box>
      )
    }
    return (
      <Box key="jobs" flexDirection="column">
        {run.stages.map(row)}
      </Box>
    )
  }

  // The whole run spread across the panel width beside the stage names, as the console's TIMING block.
  const timing = (run: Run) => {
    const track = timingTrack(m.cols, run.stages)
    if (!track) return null
    const name = Math.max(5, ...run.stages.map(s => s.name.length))
    return (
      <Box key="timing" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>Timing</Text>
          <Text dimColor>{fmtDuration(runDuration(run, now))}</Text>
        </Box>
        {run.stages.map(s => {
          const b = bar(s, run, now, track)
          return (
            <Box key={`tl-${s.name}`} flexDirection="row" gap={1}>
              <Box {...fixed(name)}>
                <Text dimColor wrap="truncate-end">
                  {s.name}
                </Text>
              </Box>
              {b.fill ? (
                <Box key={`bar-${s.name}`} flexDirection="row" {...fixed(track)}>
                  {b.lead ? <Text dimColor>{'·'.repeat(b.lead)}</Text> : null}
                  <Text {...paint(s.state)}>{'━'.repeat(b.fill)}</Text>
                </Box>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  }

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
      {current ? timing(current) : null}
      {footer}
    </Box>
  )
}
