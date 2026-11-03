import type { Run, Snapshot, Stage } from '../types'
import { columns, currentRun, fmtAgo, fmtDuration, glyph, queuedBehind, stageDuration, stateColor, stateWord, timeline, timingHead, timingTrack, usualDurations } from './kintsugi'
import type { Segment } from './kintsugi'

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
  const queued = queuedBehind(snap.runs, snap.project?.id ?? null, current)

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
      {/* A wrapping row, so a narrow dock puts the queue on its own line instead of splitting it. */}
      <Box key="since" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Box key="since-age">
          <Text dimColor>{`started ${fmtAgo(now - run.createdAt)}${queued ? ' ·' : ''}`}</Text>
        </Box>
        {queued ? (
          <Box key="since-queue">
            <Text dimColor>{`${queued} queued behind it`}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  )

  // One box per stage in a wrapping row, so a narrow dock breaks the line between stages
  // (the arrow ending the line), never between a stage's glyph and its name.
  const pipeline = (run: Run) => (
    <Box key="pipe" flexDirection="row" flexWrap="wrap" columnGap={1}>
      {run.stages.map((s, i) => (
        <Box key={`pipe-${s.name}`}>
          <Text wrap="truncate-end">
            <Text {...paint(s.state)}>{`${glyph(s.state, frame)} ${s.name}`}</Text>
            {i < run.stages.length - 1 ? <Text dimColor>{' →'}</Text> : null}
          </Text>
        </Box>
      ))}
    </Box>
  )

  const jobs = (run: Run) => {
    const c = columns(m.cols, run.stages)
    const row = (s: Stage) => {
      const d = stageDuration(s, now)
      return (
        <Box key={`job-${s.name}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Box {...fixed(c.state)}>
            {/* A one-cell state column holds the coloured glyph alone. */}
            <Text {...paint(s.state)}>{c.state > 1 ? `${glyph(s.state, frame)} ${stateWord(s.state)}` : glyph(s.state, frame)}</Text>
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

  // The console's TIMING block across the panel width. While a long stage runs, the finished
  // stages share the left half to scale and the running one fills the right half against its
  // usual length; see timeline().
  const timing = (run: Run) => {
    const track = timingTrack(m.cols, run.stages)
    if (!track) return null
    const name = Math.max(5, ...run.stages.map(s => s.name.length))
    const usual = usualDurations(snap.runs, run)
    const rows = timeline(run, now, track, usual, frame)
    const cell = (s: Stage, seg: Segment, i: number) =>
      seg.n === 0 ? null : seg.kind === 'gap' ? (
        <Text key={i}>{' '.repeat(seg.n)}</Text>
      ) : seg.kind === 'fill' ? (
        <Text key={i} {...paint(s.state)}>
          {'━'.repeat(seg.n)}
        </Text>
      ) : (
        <Text key={i} dimColor>
          {'╌'.repeat(seg.n)}
        </Text>
      )
    return (
      <Box key="timing" flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={2}>
          <Text bold>Timing</Text>
          <Text dimColor wrap="truncate-end">
            {timingHead(run, now, usual)}
          </Text>
        </Box>
        {run.stages.map((s, i) => {
          const segs = rows[i] ?? []
          return (
            <Box key={`tl-${s.name}`} flexDirection="row" gap={1}>
              <Box {...fixed(name)}>
                <Text dimColor wrap="truncate-end">
                  {s.name}
                </Text>
              </Box>
              {segs.length ? (
                <Box key={`bar-${s.name}`} flexDirection="row" {...fixed(track)}>
                  {segs.map((seg, j) => cell(s, seg, j))}
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
