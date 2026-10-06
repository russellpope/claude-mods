import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OutputFile, Section } from '../types'
import { iconFor } from './icons'

const PANE = 'outputs'
const TITLE = 'Outputs'
// Requested size only: a dock width the person dragged or keyed (pluginPanes.dockColumns) wins.
const SIZE = { columns: 36, rows: 10 }
const DEFAULT_EDITOR = 'zed'
const DEFAULT_SCRATCH = 'msg-*'
const ACCENT = '#61afef'
const NEW = '#98c379'
const EDIT = '#e5c07b'
const HOVER_BG = '#2c313c'
const files = atom({ plugin: 'outputs-pane', key: 'files' } as const, [])
const folded = atom({ plugin: 'outputs-pane', key: 'folded' } as const, ['scratch'])
const query = atom({ plugin: 'outputs-pane', key: 'query' } as const, '')

const SECTIONS: { id: Section; label: string; glyph: string; color: string }[] = [
  { id: 'planning', label: 'planning', glyph: '', color: '#c678dd' },
  { id: 'code', label: 'code', glyph: '', color: '#56b6c2' },
  { id: 'scratch', label: 'scratch', glyph: '', color: '#7a7f88' },
]
const PLANNING = /\.(md|mdx|markdown|txt)$/i

// One glob of the scratch setting, matched against a file name: * and ? are wildcards, the rest is literal.
const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')

// The scratch setting is a comma-separated list of globs: blank means none, unset means msg-*.
export const scratchPatterns = (setting: unknown) =>
  (typeof setting === 'string' ? setting : DEFAULT_SCRATCH)
    .split(',').map(glob => glob.trim()).filter(Boolean).map(globToRegExp)

// A scratch name wins over the extension; then markdown and text are planning, the rest code.
export const sectionOf = (path: string, scratch: readonly RegExp[] = []): Section => {
  const name = path.split('/').pop() ?? path
  if (scratch.some(pattern => pattern.test(name))) return 'scratch'

  return PLANNING.test(path) ? 'planning' : 'code'
}

// The filter matches the path as the pane shows it; a blank filter matches everything.
export const matches = (shown: string, typed: string) => shown.toLowerCase().includes(typed.trim().toLowerCase())

// Newest first, one row per path; a file Claude created stays 'new' after later edits.
export const remember = (list: OutputFile[], path: string, kind: OutputFile['kind'], at: number) => {
  const prior = list.find(one => one.path === path)
  const entry: OutputFile = { path, kind: prior?.kind === 'new' ? 'new' : kind, at }

  return [entry, ...list.filter(one => one.path !== path)].slice(0, 200)
}

export const shorten = (path: string, cwd: string, home: string) =>
  path.startsWith(cwd + '/') ? path.slice(cwd.length + 1)
    : home && path.startsWith(home + '/') ? '~' + path.slice(home.length)
      : path

export const splitPath = (shown: string) => {
  const cut = shown.lastIndexOf('/')

  return cut < 0 ? { dir: '', name: shown } : { dir: shown.slice(0, cut + 1), name: shown.slice(cut + 1) }
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 5)

// Opening an open pane only retitles it, so this is safe to call on every write.
const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, ...SIZE })

// The editor setting is a command line: the first word is the program, the rest come before the file.
export const editorArgv = (setting: unknown, path: string) => {
  const words = (typeof setting === 'string' ? setting : '').trim().split(/\s+/).filter(Boolean)

  return [...(words.length > 0 ? words : [DEFAULT_EDITOR]), path]
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'outputs', description: 'Show files written this session (click to open in your editor)' })
    void openPane($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'outputs' }, async $ => {
    await openPane($)

    return { text: 'Outputs pane opened.' }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await update($, files, list => remember(list, e.file_path, 'new', Date.now()))
      void openPane($).catch(() => undefined)
    }

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await update($, files, list => remember(list, e.file_path, 'edit', Date.now()))
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The mobile app draws no Input yet; there the pane goes without the filter.
    const Input = 'Input' in elements ? elements.Input : undefined
    const list = await read($, files)
    const cwd = await $.session.cwd()
    const home = cwd.match(/^\/(Users|home)\/[^/]+/)?.[0] ?? ''
    const shut = await read($, folded)
    const typed = await read($, query)
    const scratch = scratchPatterns(options.scratch)

    const editor = editorArgv(options.editor, '')[0]?.split('/').pop() ?? DEFAULT_EDITOR

    const open = async (path: string) => {
      const argv = editorArgv(options.editor, path)
      const ran = await $.process.run(argv).catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }))
      const { exitCode, stderr } = ran
      $.ui.toast(exitCode === 0 ? `${editor} ← ${shorten(path, cwd, home)}` : `${editor} failed: ${stderr.slice(0, 80)}`)
    }

    // Matches for a filter, in the order the sections draw them.
    const hitsFor = (text: string) => SECTIONS.flatMap(section =>
      list.filter(file => sectionOf(file.path, scratch) === section.id && matches(shorten(file.path, cwd, home), text)))

    const filter = (text: string) => void update($, query, () => text)
      .then(() => $.ui.scroll({ in: PANE, to: 'start' }))
      .catch(() => undefined)

    // Enter opens the first match, a folded section's included.
    const openFirst = async (text: string) => {
      await update($, query, () => text)
      const first = hitsFor(text)[0]
      if (first) await open(first.path)
      else $.ui.toast(`no file matches ${text.trim()}`)
    }

    const isFiltering = typed.trim() !== ''
    const hits = hitsFor(typed)
    const created = list.filter(file => file.kind === 'new').length
    // Scratch shows only once something lands in it; a filter hides the sections it empties.
    const drawn = SECTIONS.filter(section => {
      const count = hits.filter(file => sectionOf(file.path, scratch) === section.id).length

      return count > 0 || (!isFiltering && section.id !== 'scratch')
    })

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1}>
            <Text bold color={ACCENT}>{''}  outputs</Text>
            <Box flexDirection="row" flexShrink={0}>
              {list.length > 0 && isFiltering && <Text dimColor>{`${hits.length} of ${list.length}`}</Text>}
              {list.length > 0 && !isFiltering && (
                <Text>
                  <Text color={NEW}>{''} {created}</Text>
                  <Text dimColor>  </Text>
                  <Text color={EDIT}>{''} {list.length - created}</Text>
                </Text>
              )}
            </Box>
          </Box>

          {list.length > 0 && Input && (
            <Box marginBottom={1}>
              <Input key="filter" label={' '} placeholder="filter" value={typed} submitLabel="open"
                onInput={filter} onSubmit={text => void openFirst(text)} />
            </Box>
          )}

          {list.length === 0 && (
            <Box flexDirection="column" alignItems="center" marginTop={1}>
              <Text dimColor>{''}  nothing written yet</Text>
              <Text dimColor italic>files Claude writes or edits land here</Text>
            </Box>
          )}

          {list.length > 0 && drawn.map(section => {
            const inSection = hits.filter(file => sectionOf(file.path, scratch) === section.id)
            const isShut = shut.includes(section.id)
            const toggle = () => void update($, folded, now =>
              now.includes(section.id) ? now.filter(id => id !== section.id) : [...now, section.id])

            return (
              <Box flexDirection="column" key={`section:${section.id}`} marginBottom={1}>
                <Box flexDirection="row" key={`head:${section.id}`} hover={{ backgroundColor: HOVER_BG }}>
                  <Text color={section.color}>{isShut ? '' : ''} {section.glyph} </Text>
                  <Button plain key={`fold:${section.id}`} label={section.label} hover={{ color: section.color, bold: true }} onPress={toggle} />
                  <Text dimColor> {inSection.length}</Text>
                </Box>
                {!isShut && inSection.length === 0 && <Text dimColor italic>    none yet</Text>}
                {!isShut && inSection.map(file => {
                  const icon = iconFor(file.path)
                  const { dir, name } = splitPath(shorten(file.path, cwd, home))

                  return (
                    <Box flexDirection="row" key={`row:${file.path}`} hover={{ backgroundColor: HOVER_BG }}>
                      <Box flexShrink={0}>
                        <Text>  </Text>
                        <Text color={file.kind === 'new' ? NEW : EDIT}>{file.kind === 'new' ? ' ' : ' '}</Text>
                        <Text color={icon.color}>{icon.glyph} </Text>
                      </Box>
                      <Box flexGrow={1} flexShrink={1} flexDirection="row" overflow="hidden">
                        <Button plain key={`open:${file.path}`} label={name} hover={{ color: ACCENT, bold: true, underline: true }} onPress={() => void open(file.path)} />
                        {dir && <Text dimColor wrap="truncate-start" hover={{ dimColor: false }}> {dir}</Text>}
                      </Box>
                      <Box flexShrink={0}>
                        <Text dimColor> {clock(file.at)}</Text>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            )
          })}
        </Box>

        {list.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor wrap="truncate-end">{''} click a name for {editor}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
