import type { ArtifactMeta, HistoryView, PaneView, Shown } from '../types'
import { fmtAge, matchesQuery, newestFirst } from './store'

export type PaneActions = {
  filter: (text: string) => void
  openFirst: (text: string) => void
  open: (id: string) => void
  back: () => void
  version: (n: number) => void
  editor: () => void
  keep: () => void
}

export type PaneModel = {
  history: HistoryView
  pane: PaneView
  query: string
  mine: string[]
  shown: Shown | null
  now: number
  cols: number
  surface: string
  /** The editor's program name, for the open button. */
  editor: string
  act: PaneActions
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UI = any

const MARK = 2
const MIN_TITLE = 12
const VERSION_W = 3 // 'v12'
const AGE_W = 3 // '59m'

/** As the dock narrows the kind goes first, then the version; the title takes the rest, the age stays. */
export function listColumns(cols: number, kindWidth: number): { kind: number; version: number } {
  const row = (kind: number, version: number) => MARK + MIN_TITLE + (kind ? kind + 1 : 0) + (version ? version + 1 : 0) + 1 + AGE_W
  if (row(kindWidth, VERSION_W) <= cols) return { kind: kindWidth, version: VERSION_W }
  if (row(0, VERSION_W) <= cols) return { kind: 0, version: VERSION_W }
  return { kind: 0, version: 0 }
}

export function drawPane(ui: UI, m: PaneModel) {
  return m.pane.view === 'reader' && m.shown ? drawReader(ui, m, m.shown) : drawList(ui, m)
}

function drawList(ui: UI, m: PaneModel) {
  const { Box, Text, Button } = ui
  const Input = 'Input' in ui ? ui.Input : undefined
  const fixed = (width: number) => (m.surface === 'terminal' ? { width, flexShrink: 0 } : {})
  const items = newestFirst(m.history.items)
  const hits = items.filter(a => matchesQuery(a, m.query))
  const c = listColumns(m.cols, Math.max(4, ...items.map(a => a.kind.length)))
  const row = (a: ArtifactMeta) => (
    <Box key={`row-${a.id}`} flexDirection="row" gap={1}>
      <Box {...fixed(MARK - 1)}>
        <Text color="success">{m.mine.includes(a.id) ? '●' : ' '}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Button plain key={`open-${a.id}`} label={a.title} onPress={() => m.act.open(a.id)} />
      </Box>
      {c.kind ? (
        <Box {...fixed(c.kind)}>
          <Text dimColor>{a.kind}</Text>
        </Box>
      ) : null}
      {c.version ? (
        <Box {...fixed(c.version)} justifyContent="flex-end">
          <Text dimColor>{a.version > 1 ? `v${a.version}` : ''}</Text>
        </Box>
      ) : null}
      <Box {...fixed(AGE_W)} justifyContent="flex-end">
        <Text dimColor>{fmtAge(m.now - Date.parse(a.updated))}</Text>
      </Box>
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box key="head" flexDirection="row" justifyContent="space-between" gap={2}>
        <Text bold wrap="truncate-end">{`artifacts${m.history.project ? ` · ${m.history.project}` : ''}`}</Text>
        <Text dimColor>{m.query.trim() ? `${hits.length} of ${items.length}` : String(items.length)}</Text>
      </Box>
      {m.history.error ? (
        <Box key="error">
          <Text color="error">{m.history.error}</Text>
        </Box>
      ) : null}
      {items.length && Input ? (
        <Input key="filter" label=" " placeholder="filter" value={m.query} submitLabel="open" onInput={m.act.filter} onSubmit={m.act.openFirst} />
      ) : null}
      {items.length ? (
        <Box key="rows" flexDirection="column">
          {hits.map(row)}
        </Box>
      ) : m.history.error ? null : (
        <Box key="empty">
          <Text dimColor>{`nothing posted yet${m.history.project ? ` for ${m.history.project}` : ''}`}</Text>
        </Box>
      )}
    </Box>
  )
}

function drawReader(ui: UI, m: PaneModel, s: Shown) {
  const { Box, Text, Button, Markdown } = ui
  const meta = [s.meta.kind, `v${s.meta.version} of ${s.latest}`, `${fmtAge(m.now - Date.parse(s.meta.updated))} ago`, s.meta.branch].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Button plain key="back" label="← list" onPress={m.act.back} />
        <Box key="title">
          <Text bold wrap="truncate-end">{s.meta.title}</Text>
        </Box>
        <Box key="meta">
          <Text dimColor wrap="truncate-end">{meta}</Text>
        </Box>
      </Box>
      <Box key="body" flexDirection="column">
        <Markdown text={s.body} />
      </Box>
      <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={2}>
        {s.latest > 1
          ? Array.from({ length: s.latest }, (_, i) => i + 1).map(n =>
              // A Button takes no bold: the version shown wears brackets, the others are dim.
              n === s.meta.version ? (
                <Button key={`version-${n}`} plain label={`[v${n}]`} onPress={() => m.act.version(n)} />
              ) : (
                <Button key={`version-${n}`} plain dimColor label={`v${n}`} onPress={() => m.act.version(n)} />
              ),
            )
          : null}
        <Button key="editor" plain label={`open in ${m.editor}`} onPress={m.act.editor} />
        <Button key="keep" plain label="keep in repo" onPress={m.act.keep} />
      </Box>
    </Box>
  )
}
