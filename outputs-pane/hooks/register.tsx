import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OutputFile } from '../types'
import { iconFor } from './icons'

const PANE = 'outputs'
const TITLE = 'Outputs'
// Requested size only: a dock width the person dragged or keyed (pluginPanes.dockColumns) wins.
const SIZE = { columns: 36, rows: 10 }
const DEFAULT_EDITOR = 'zed'
const ACCENT = '#61afef'
const NEW = '#98c379'
const EDIT = '#e5c07b'
const HOVER_BG = '#2c313c'
const files = atom({ plugin: 'outputs-pane', key: 'files' } as const, [])
const folded = atom({ plugin: 'outputs-pane', key: 'folded' } as const, [])

export type Section = 'planning' | 'code'
const SECTIONS: { id: Section; label: string; glyph: string; color: string }[] = [
  { id: 'planning', label: 'planning', glyph: '\uf0eb', color: '#c678dd' },
  { id: 'code', label: 'code', glyph: '\uf121', color: '#56b6c2' },
]
const PLANNING = /\.(md|mdx|markdown|txt)$/i

export const sectionOf = (path: string): Section => (PLANNING.test(path) ? 'planning' : 'code')

// Rows per section: planning takes up to half, code takes what planning leaves.
export const budget = (planning: number, code: number, shut: readonly Section[], room: number) => {
  const plan = shut.includes('planning') ? 0 : Math.min(planning, Math.max(1, Math.ceil(room / 2)))
  const rest = shut.includes('code') ? 0 : Math.min(code, Math.max(1, room - plan))

  return { planning: plan, code: rest }
}

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
    await $.command.register({ name: 'outputs', description: 'Show files written this session (click to open in Zed)' })
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const cwd = await $.session.cwd()
    const home = cwd.match(/^\/(Users|home)\/[^/]+/)?.[0] ?? ''
    const height = e.viewport?.rows ?? 24
    const shut = await read($, folded)

    const editor = editorArgv(options.editor, '')[0]?.split('/').pop() ?? DEFAULT_EDITOR

    const open = async (path: string) => {
      const argv = editorArgv(options.editor, path)
      const ran = await $.process.run(argv).catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }))
      const { exitCode, stderr } = ran
      $.ui.toast(exitCode === 0 ? `${editor} \u2190 ${shorten(path, cwd, home)}` : `${editor} failed: ${stderr.slice(0, 80)}`)
    }


    const room = Math.max(2, height - 10)
    const created = list.filter(file => file.kind === 'new').length
    const rows = budget(
      list.filter(file => sectionOf(file.path) === 'planning').length,
      list.filter(file => sectionOf(file.path) === 'code').length,
      shut, room)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1}>
            <Text bold color={ACCENT}>{''}  outputs</Text>
            <Box flexDirection="row" flexShrink={0}>
              {list.length > 0 && (
                <Text>
                  <Text color={NEW}>{''} {created}</Text>
                  <Text dimColor>  </Text>
                  <Text color={EDIT}>{''} {list.length - created}</Text>
                </Text>
              )}
            </Box>
          </Box>

          {list.length === 0 && (
            <Box flexDirection="column" alignItems="center" marginTop={1}>
              <Text dimColor>{''}  nothing written yet</Text>
              <Text dimColor italic>files Claude writes or edits land here</Text>
            </Box>
          )}

          {list.length > 0 && SECTIONS.map(section => {
            const inSection = list.filter(file => sectionOf(file.path) === section.id)
            const isShut = shut.includes(section.id)
            const shown = inSection.slice(0, rows[section.id])
            const toggle = () => void update($, folded, now =>
              now.includes(section.id) ? now.filter(id => id !== section.id) : [...now, section.id])

            return (
              <Box flexDirection="column" key={`section:${section.id}`} marginBottom={1}>
                <Box flexDirection="row" key={`head:${section.id}`} hover={{ backgroundColor: HOVER_BG }}>
                  <Text color={section.color}>{isShut ? '\uf105' : '\uf107'} {section.glyph} </Text>
                  <Button plain key={`fold:${section.id}`} label={section.label} hover={{ color: section.color, bold: true }} onPress={toggle} />
                  <Text dimColor> {inSection.length}</Text>
                </Box>
                {!isShut && inSection.length === 0 && <Text dimColor italic>    none yet</Text>}
                {shown.map(file => {
                  const icon = iconFor(file.path)
                  const { dir, name } = splitPath(shorten(file.path, cwd, home))

                  return (
                    <Box flexDirection="row" key={`row:${file.path}`} hover={{ backgroundColor: HOVER_BG }}>
                      <Box flexShrink={0}>
                        <Text>  </Text>
                        <Text color={file.kind === 'new' ? NEW : EDIT}>{file.kind === 'new' ? '\uf457 ' : '\uf459 '}</Text>
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
                {!isShut && inSection.length > shown.length && <Text dimColor italic>    {'\u2026'} {inSection.length - shown.length} more</Text>}
              </Box>
            )
          })}
        </Box>

        {list.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor wrap="truncate-end">{'\uf245'} click a name for {editor}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
