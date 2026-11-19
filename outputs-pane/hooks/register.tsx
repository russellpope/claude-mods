import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OutputFile, Section, Ship } from '../types'
import { globList, globWords } from './globs'
import { iconFor, isCode } from './icons'
import { birthArgv, findArgv, isSkipped, kindOf, namedPaths, parseBirths, SCAN_CAP, SCAN_TIMEOUT_MS, stampOf } from './scan'
import { defaultBranchOf, isShipped, parseBranches, parseStatus, parseWorktrees, shipLine, shipOf, shipStatus } from './ship'

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
// The working directory's ship state; null outside a git repository or when git fails.
const ship = atom({ plugin: 'outputs-pane', key: 'ship' } as const, null)
// Whether the ship line is unfolded to the names behind its counts.
const shipOpen = atom({ plugin: 'outputs-pane', key: 'shipOpen' } as const, false)
// How often the open pane rereads git, and how long each git read may take.
const SHIP_POLL_MS = 30_000
const GIT_TIMEOUT_MS = 3000
const MISC_TINT = '#d19a66'

const SECTIONS: { id: Section; label: string; glyph: string; color: string }[] = [
  { id: 'planning', label: 'planning', glyph: '', color: '#c678dd' },
  { id: 'code', label: 'code', glyph: '', color: '#56b6c2' },
  { id: 'misc', label: 'misc', glyph: '', color: MISC_TINT },
  { id: 'scratch', label: 'scratch', glyph: '', color: '#7a7f88' },
]
const PLANNING = /\.(md|mdx|markdown|txt)$/i

// The scratch setting is a comma-separated list of globs: blank means none, unset means msg-*.
export const scratchPatterns = (setting: unknown) => globList(setting, DEFAULT_SCRATCH)

// What a file is, by name alone: markdown and text are planning, known source, config and markup is code
// (see icons.ts), and everything else (office files, media, archives, binaries, data) is misc.
export const fileKind = (path: string): Exclude<Section, 'scratch'> =>
  PLANNING.test(path) ? 'planning' : isCode(path) ? 'code' : 'misc'

// One classifier for every file, however it was made: a scratch name wins, then the file's kind.
export const sectionOf = (path: string, scratch: readonly RegExp[] = []): Section => {
  const name = path.split('/').pop() ?? path
  if (scratch.some(pattern => pattern.test(name))) return 'scratch'

  return fileKind(path)
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

// The miscOpener setting is a command line like the editor's; blank is the platform's opener: `open` on
// macOS (and wherever the platform is unknown), `xdg-open` on Linux, which has no `open` of that kind.
export const miscArgv = (setting: unknown, path: string, platform: string | undefined) => {
  const words = (typeof setting === 'string' ? setting : '').trim().split(/\s+/).filter(Boolean)
  const fallback = platform === 'linux' || platform === 'wsl' ? 'xdg-open' : 'open'

  return [...(words.length > 0 ? words : [fallback]), path]
}

const platformOf = async ($: EngineInterface) => (await $.session.info().catch(() => undefined))?.platform

// After a Bash call: one find for files under the working directory modified since the call began, plus the
// absolute and ~ paths its command names. A failed or slow listing lists nothing. Returns whether a file
// landed in misc.
async function listBashFiles($: EngineInterface, command: string, startedAt: number, options: Record<string, unknown>) {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? cwd.match(/^\/(Users|home)\/[^/]+/)?.[0] ?? ''
  const ignore = globList(options.ignore)
  const stamp = stampOf(startedAt)
  const stampMs = Math.floor(startedAt / 1000) * 1000

  const listing = await $.process.run(findArgv(cwd, stamp, globWords(options.ignore)), { env: { TZ: 'UTC' }, timeoutMs: SCAN_TIMEOUT_MS })
    .catch(() => undefined)
  if (!listing || listing.exitCode !== 0 || listing.isStdoutTruncated) return false
  const found = listing.stdout.split('\n').filter(line => line.startsWith('/') && !isSkipped(line, ignore))
  const scanned = found.length > SCAN_CAP ? [] : found

  const named: string[] = []
  for (const path of namedPaths(command, home)) {
    if (scanned.includes(path) || isSkipped(path, ignore)) continue
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind === 'file' && stat.mtimeMs >= stampMs) named.push(path)
  }

  const paths = [...scanned, ...named]
  if (paths.length === 0) return false
  const argv = birthArgv(await platformOf($), paths)
  const births = argv
    ? parseBirths((await $.process.run(argv, { timeoutMs: SCAN_TIMEOUT_MS }).catch(() => undefined))?.stdout ?? '')
    : new Map<string, number>()
  const at = Date.now()
  await update($, files, list => paths.reduce((next, path) =>
    remember(next, path, kindOf(births.get(path), stampMs, next.find(one => one.path === path)?.kind), at), list))
  const scratch = scratchPatterns(options.scratch)

  return paths.some(path => sectionOf(path, scratch) === 'misc')
}

// Local git reads only, each with a short timeout and optional locks off, so nothing is written: never a
// fetch, so "behind" is as of the last fetch. Undefined outside a git repository or when git fails.
async function readShip($: EngineInterface, options: Record<string, unknown>): Promise<Ship | undefined> {
  const cwd = await $.session.cwd()
  const git = (...args: string[]) => $.process.run(['git', '-C', cwd, '--no-optional-locks', ...args], { timeoutMs: GIT_TIMEOUT_MS })
    .catch(() => ({ exitCode: -1, stdout: '' }))
  const [status, branchList, originHead, worktreeList] = await Promise.all([
    git('status', '--porcelain=v2', '--branch'),
    git('for-each-ref', '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)', 'refs/heads'),
    git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD'),
    git('worktree', 'list', '--porcelain'),
  ])
  const parsed = status.exitCode === 0 ? parseStatus(status.stdout) : undefined
  if (!parsed) return undefined
  const branches = branchList.exitCode === 0 ? parseBranches(branchList.stdout) : []
  const defaultBranch = defaultBranchOf(originHead.exitCode === 0 ? originHead.stdout : '', branches.map(b => b.name))
  const merged = defaultBranch
    ? await git('for-each-ref', `--merged=${defaultBranch}`, '--format=%(refname:short)', 'refs/heads')
    : undefined

  return shipOf({
    status: parsed,
    branches,
    merged: merged?.exitCode === 0 ? merged.stdout.split('\n').filter(Boolean) : [],
    worktrees: worktreeList.exitCode === 0 ? parseWorktrees(worktreeList.stdout) : [],
    defaultBranch,
    ignore: globList(options.shipIgnore),
  })
}

// Rereads the ship state into the pane and the status line; any failure shows nothing.
async function refreshShip($: EngineInterface, options: Record<string, unknown>) {
  const read = await readShip($, options).catch(() => undefined)
  await update($, ship, () => read ?? null)
  try {
    $.ui.status(shipStatus(read))
  } catch { /* no status line on this surface */ }
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

type Place = { kind: 'local' } | { kind: 'remote'; session: string; block: string; label: string; machine: string }

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

  return !label || !machine || label === machine ? { kind: 'local' } : { kind: 'remote', session, block, label, machine }
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
    void refreshShip($, options).catch(() => undefined)
    // While the pane is open, reread git now and then: another terminal may commit or push.
    $.clock.every(SHIP_POLL_MS, () => {
      void (async () => {
        if ((await $.ui.panes()).some(pane => pane.id === PANE)) await refreshShip($, options)
      })().catch(() => undefined)
    })

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
      void refreshShip($, options).catch(() => undefined)
    }

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await update($, files, list => remember(list, e.file_path, 'edit', Date.now()))
      void refreshShip($, options).catch(() => undefined)
    }

    return ran
  })

  // Files a Bash call made reach the pane after it returns: the call is never held up or refused. Only a
  // file landing in misc pops the pane, as built things (decks, videos) are what the person wants to see.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedAt = await $.clock.now().catch(() => undefined)
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && startedAt !== undefined) {
      void listBashFiles($, e.command, startedAt, options)
        .then(isMisc => isMisc ? openPane($) : undefined)
        .catch(() => undefined)
    }
    if (/\bgit\b/.test(e.command)) void refreshShip($, options).catch(() => undefined)

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
    const repo = await read($, ship)
    const isShipOpen = await read($, shipOpen)
    const platform = await platformOf($)

    const editor = editorArgv(options.editor, '')[0]?.split('/').pop() ?? DEFAULT_EDITOR
    const opener = miscArgv(options.miscOpener, '', platform)[0]?.split('/').pop() ?? 'open'
    const hasMisc = list.some(file => fileKind(file.path) === 'misc')
    const toggleShip = () => void update($, shipOpen, now => !now)

    const open = async (path: string) => {
      const place = await placeOf($)
      const isMisc = fileKind(path) === 'misc'
      if (place.kind === 'remote' && isMisc) {
        $.ui.toast(`${splitPath(path).name} opens only on the machine Claude runs on (${place.machine})`)

        return
      }
      if (isMisc) {
        const argv = miscArgv(options.miscOpener, path, platform)
        const program = argv[0]?.split('/').pop() ?? ''
        const { exitCode, stderr } = await $.process.run(argv).catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }))
        $.ui.toast(exitCode === 0 ? `${program} ← ${shorten(path, cwd, home)}` : `${program} failed: ${stderr.slice(0, 80)}`)

        return
      }
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
    // Misc and scratch show only once something lands in them; a filter hides the sections it empties.
    const drawn = SECTIONS.filter(section => {
      const count = hits.filter(file => sectionOf(file.path, scratch) === section.id).length

      return count > 0 || (!isFiltering && section.id !== 'scratch' && section.id !== 'misc')
    })

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={repo ? 0 : 1}>
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

          {repo && (
            <Box flexDirection="column" marginBottom={1}>
              <Box flexDirection="row" key="ship-row" hover={{ backgroundColor: HOVER_BG }}>
                <Text color={isShipped(repo) ? NEW : EDIT}>{'\ue0a0'} </Text>
                <Button plain key="ship" label={shipLine(repo)} hover={{ color: ACCENT, bold: true }} onPress={toggleShip} />
              </Box>
              {isShipOpen && repo.unpushed.length > 0 && <Text dimColor>  unpushed branches</Text>}
              {isShipOpen && repo.unpushed.map(branch => (
                <Box flexDirection="row" key={`unpushed:${branch.name}`}>
                  <Text>    </Text>
                  <Text color={EDIT}>{branch.name}</Text>
                  <Text dimColor> {branch.why === 'ahead' ? `↑${branch.ahead}` : branch.why === 'gone' ? 'upstream gone' : 'no upstream'}</Text>
                </Box>
              ))}
              {isShipOpen && repo.merged.length > 0 && <Text dimColor>  merged worktrees</Text>}
              {isShipOpen && repo.merged.map(worktree => (
                <Box flexDirection="row" key={`merged:${worktree.path}`}>
                  <Text>    </Text>
                  <Text color={NEW}>{worktree.branch}</Text>
                  <Text dimColor wrap="truncate-start"> {shorten(worktree.path, cwd, home)}</Text>
                </Box>
              ))}
            </Box>
          )}

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
            <Text dimColor wrap="truncate-end">{''} click a name for {editor}{hasMisc ? ` · misc in ${opener}` : ''}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
