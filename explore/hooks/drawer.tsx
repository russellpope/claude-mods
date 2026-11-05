import type { DrawerView, Exploration, FrontierView } from '../types'
import { shortRec } from './frontier'
import { fmtCall } from './prompts'

export type DrawerActions = {
  close: () => void
  pick: (n: number) => void
  back: () => void
  followUp: (text: string) => void
  retry: () => void
}

export type BandModel = {
  view: DrawerView
  frontier: FrontierView | null
  explorations: Record<string, Exploration>
  frame: number
  cols: number
  surface: string
  act: DrawerActions
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

export const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const REC_MAX = 24

/** What the drawer says with no frontier. */
export const NO_QUESTIONS = 'no questions to explore · /btw for a side question'

export const exploredKey = (hash: string, n: number): string => `${hash}:${n}`

/**
 * Where `$.ui.focus` moves the keyboard when the drawer opens on `view`: the band (`requestId`, from its last drawing),
 * onto the first picker row, or an exploration's follow-up field. The field is drawn only once the exploration has an
 * answer, so before that the keyboard lands on `back`. Null with no band drawn yet, or nothing to land on.
 */
export function focusTarget(
  requestId: string,
  view: DrawerView,
  f: FrontierView | null,
  explorations: Record<string, Exploration>,
): { requestId: string; key: string } | null {
  const first = f?.questions[0]
  const key =
    view.view === 'exploration'
      ? explorations[view.key]?.turns.length
        ? 'follow-up'
        : 'back'
      : view.view === 'picker' && first
        ? `pick-${first.n}`
        : ''
  return requestId && key ? { requestId, key } : null
}

const fromWhere = (ago: number): string => (ago === 0 ? 'from the last message' : `from ${ago} message${ago === 1 ? '' : 's'} ago`)

/** The drawer: its picker, one exploration, or one line saying why there is nothing to pick. */
export function drawBand(ui: UI, m: BandModel) {
  const v = m.view
  if (v.view === 'exploration') {
    const ex = m.explorations[v.key]
    if (ex) return drawExploration(ui, m, ex)
  }
  if (v.view === 'picker' && m.frontier) return drawPicker(ui, m, m.frontier, v.note)
  return drawEmpty(ui, m, v.view === 'empty' && v.note ? v.note : NO_QUESTIONS)
}

function closeButton(ui: UI, m: BandModel) {
  const { Button } = ui
  return <Button plain key="close" label="close" onPress={m.act.close} />
}

function head(ui: UI, m: BandModel, title: string) {
  const { Box, Text } = ui
  return (
    <Box key="head" flexDirection="row" justifyContent="space-between" gap={2}>
      <Box flexShrink={1}>
        <Text bold wrap="truncate-end">
          {title}
        </Text>
      </Box>
      {closeButton(ui, m)}
    </Box>
  )
}

function note(ui: UI, text: string) {
  const { Box, Text } = ui
  return text ? (
    <Box key="note">
      <Text color="warning">{text}</Text>
    </Box>
  ) : null
}

function drawEmpty(ui: UI, m: BandModel, why: string) {
  const { Box, Text } = ui
  return (
    <Box key="head" flexDirection="row" justifyContent="space-between" gap={2}>
      <Box key="note" flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {why}
        </Text>
      </Box>
      {closeButton(ui, m)}
    </Box>
  )
}

function drawPicker(ui: UI, m: BandModel, f: FrontierView, why: string) {
  const { Box, Text, Button } = ui
  const fixed = (width: number) => (m.surface === 'terminal' ? { width, flexShrink: 0 } : {})
  const recWidth = Math.min(REC_MAX, Math.max(0, m.cols - 40))
  return (
    <Box flexDirection="column">
      {head(ui, m, `explore · ${f.questions.length} questions · ${fromWhere(f.ago)}`)}
      {note(ui, why)}
      {f.questions.map(q => (
        <Box key={`row-${q.n}`} flexDirection="row" gap={1}>
          <Box {...fixed(1)}>
            <Text color="success">{m.explorations[exploredKey(f.hash, q.n)] ? '●' : ' '}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Button plain key={`pick-${q.n}`} {...(q.n <= 9 ? { hotkey: String(q.n) } : {})} label={`${String(q.n).padStart(2)}  ${q.title}`} onPress={() => m.act.pick(q.n)} />
          </Box>
          {recWidth >= 8 && q.rec ? (
            <Box {...fixed(recWidth)}>
              <Text dimColor wrap="truncate-end">{`➡️ ${shortRec(q.rec)}`}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

function drawExploration(ui: UI, m: BandModel, ex: Exploration) {
  const { Box, Text, Button, Markdown } = ui
  const Input = 'Input' in ui ? ui.Input : undefined
  const first = ex.turns[0]
  const last = ex.turns.at(-1)
  const status =
    ex.status === 'thinking' ? `${SPINNER[m.frame % SPINNER.length]} thinking…` : ex.status === 'failed' ? ex.error : last ? fmtCall(last.ms, last.tokens) : ''
  return (
    <Box flexDirection="column" gap={1}>
      <Box key="head" flexDirection="row" gap={2}>
        <Button plain key="back" label="← questions" onPress={m.act.back} />
        <Box key="title" flexGrow={1} flexShrink={1}>
          <Text bold wrap="truncate-end">
            {`Q${ex.n} · ${ex.title}`}
          </Text>
        </Box>
        {closeButton(ui, m)}
      </Box>
      {ex.turns.map((t, i) => (
        <Box key={`turn-${i}`} flexDirection="column">
          {t.ask ? <Text color="suggestion">{`› ${t.ask}`}</Text> : null}
          <Markdown text={t.answer} />
        </Box>
      ))}
      <Box key="status" flexDirection="row" gap={2}>
        {ex.status === 'failed' ? <Text color="error">{status}</Text> : <Text dimColor>{status}</Text>}
        {ex.status === 'failed' && ex.canRetry ? <Button plain key="retry" label="retry" onPress={m.act.retry} /> : null}
      </Box>
      {first && Input ? <Input key="follow-up" label="follow-up" placeholder="ask about this" submitLabel="ask" onSubmit={m.act.followUp} /> : null}
    </Box>
  )
}
