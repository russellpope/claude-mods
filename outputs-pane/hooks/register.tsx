import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OutputFile, Section } from '../types'
import { iconFor } from './icons'

const PANE = 'outputs'
const TITLE = 'Outputs'
// Requested size only: a dock width the person dragged or keyed (pluginPanes.dockColumns) wins.
const SIZE = { columns: 36, rows: 10 }
const DEFAULT_EDITOR = 'zed'
const DEFAULT_MARKDOWN_VIEWER = ['glow', '-p']
const DEFAULT_CODE_VIEWER = ['bat', '--paging=always']
const DEFAULT_SCRATCH = 'msg-*'
const ACCENT = '#61afef'
const NEW = '#98c379'
const EDIT = '#e5c07b'
const HOVER_BG = '#2c313c'
const files = atom({ plugin: 'outputs-pane', key: 'files' } as const, [])
const folded = atom({ plugin: 'outputs-pane', key: 'folded' } as const, ['scratch'])
const query = atom({ plugin: 'outputs-pane', key: 'query' } as const, '')
// The Rex block of the last viewer split, closed before the next one opens.
const viewer = atom({ plugin: 'outputs-pane', key: 'viewer' } as const, '')

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

// A viewer setting is a command line like the editor's; planning files get the markdown viewer.
export const viewerArgv = (options: Record<string, unknown>, path: string) => {
  const isPlanning = PLANNING.test(path)
  const setting = isPlanning ? options.markdownViewer : options.codeViewer
  const words = (typeof setting === 'string' ? setting : '').trim().split(/\s+/).filter(Boolean)

  return [...(words.length > 0 ? words : isPlanning ? DEFAULT_MARKDOWN_VIEWER : DEFAULT_CODE_VIEWER), path]
}

// The label of the Rex app that owns a block, from `session.view` and `client ls --json` output.
export const ownerLabel = (view: string, clients: string, block: string) => {
  try {
    let owner: string | undefined
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk)
      else if (node && typeof node === 'object') {
        const one = node as { block_id?: unknown; owner?: unknown }
        if (one.block_id === block && typeof one.owner === 'string') owner ??= one.owner
        Object.values(node).forEach(walk)
      }
    }
    walk(JSON.parse(view))
    const list = (JSON.parse(clients) as { clients?: { client_id?: string; info?: { label?: string } }[] }).clients ?? []

    return owner ? list.find(client => client.client_id === owner)?.info?.label : undefined
  } catch {
    return undefined
  }
}

type Place = { kind: 'local' } | { kind: 'remote'; session: string; block: string; label: string }

// In Rex, a click belongs to the app that owns Claude's pane: this Mac opens the editor, another
// machine gets a viewer split. Asked on every click, since the person can walk between machines.
// Anything Rex can't answer counts as local, so a click always does something.
async function placeOf($: EngineInterface): Promise<Place> {
  const session = await $.env.get('REX_SESSION').catch(() => undefined)
  const block = await $.env.get('REX_BLOCK').catch(() => undefined)
  if (!session || !block) return { kind: 'local' }

  const failed = { exitCode: -1, stdout: '', stderr: '' }
  const [view, clients, here] = await Promise.all([
    $.process.run(['rex', 'api', 'call', '-s', session, 'session.view']).catch(() => failed),
    $.process.run(['rex', 'client', 'ls', '--json']).catch(() => failed),
    $.process.run(['scutil', '--get', 'ComputerName']).catch(() => failed),
  ])
  // A failed call prints nothing to parse, which leaves no label and so counts as local.
  const label = ownerLabel(view.stdout, clients.stdout, block)
  const machine = here.stdout.trim()

  return !label || !machine || label === machine ? { kind: 'local' } : { kind: 'remote', session, block, label }
}

// Opens the file in a split right of Claude's pane, replacing the last viewer split if it is still open.
async function openViewer($: EngineInterface, place: Extract<Place, { kind: 'remote' }>, argv: string[]) {
  const last = await read($, viewer)
  if (last) await $.process.run(['rex', 'block', 'close', '-s', place.session, last]).catch(() => undefined)

  const name = argv[argv.length - 1]?.split('/').pop() ?? ''
  const ran = await $.process.run(['rex', 'split', '-s', place.session, '-b', place.block, '--split=right',
    '--label', name, '--json', '--', ...argv]).catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: String(error) }))
  let opened = ''
  try {
    opened = (JSON.parse(ran.stdout) as { block_ids?: string[] }).block_ids?.[0] ?? ''
  } catch { /* not JSON: the split failed */ }
  await update($, viewer, () => opened)

  return ran
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
      const place = await placeOf($)
      if (place.kind === 'remote') {
        const argv = viewerArgv(options, path)
        const program = argv[0]?.split('/').pop() ?? ''
        const { exitCode, stderr } = await openViewer($, place, argv)
        $.ui.toast(exitCode === 0 ? `${program} → ${shorten(path, cwd, home)} (${place.label})` : `${program} failed: ${stderr.slice(0, 80)}`)

        return
      }

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
