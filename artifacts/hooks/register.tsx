import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HistoryView, PaneView, Shown } from '../types'
import { ShowError, historyDir, keepInRepo, post, readArtifact, readHistory, tilde } from './history'
import { drawPane } from './pane'
import type { PaneActions } from './pane'
import { checkShow, listText, matchesQuery, newestFirst } from './store'

export const PANE = 'artifacts'
export const COMMAND = 'artifacts-pane'
const TITLE = 'artifacts'
const POLL_MS = 5000
const DEFAULT_EDITOR = 'zed'

export const EMPTY_HISTORY: HistoryView = { dir: '', project: '', items: [], error: '', postError: '' }
export const history = atom({ plugin: 'artifacts', key: 'history' } as const, EMPTY_HISTORY)
export const pane = atom({ plugin: 'artifacts', key: 'pane' } as const, { view: 'list' } as PaneView)
export const query = atom({ plugin: 'artifacts', key: 'query' } as const, '')
export const mine = atom({ plugin: 'artifacts', key: 'mine' } as const, [] as string[])
export const shown = atom({ plugin: 'artifacts', key: 'shown' } as const, null as Shown | null)

const SHOW_DESCRIPTION = [
  "Post an artifact to the owner's artifacts pane and this project's history, kept across sessions in ~/.claude/artifacts/.",
  'Post without being asked when it helps: a design, a plan, a flow or architecture diagram, a comparison of options, or a map of what you built after a substantial change.',
  "Don't post small edits or answers that fit in chat. Always post when the owner asks to see something.",
  'Write `body` in markdown. Draw diagrams with box-drawing characters, at most 64 columns wide.',
  'To revise an earlier artifact, pass its `id` (from this tool\'s result or mcp__artifacts__list): that adds a version instead of a near-duplicate.',
].join(' ')

const LIST_DESCRIPTION =
  "List this project's artifacts, newest first: id, kind, version, when updated, title. Use it to find one to revise (pass its id to mcp__artifacts__show) or to read in full (Read <folder>/<id>.md)."

// The editor setting is a command line: the first word is the program, the rest come before the file.
export const editorArgv = (setting: unknown, path: string): string[] => {
  const words = (typeof setting === 'string' ? setting : '').trim().split(/\s+/).filter(Boolean)
  return [...(words.length ? words : [DEFAULT_EDITOR]), path]
}

// True from the moment this session opens the pane until ui.panes says it is gone.
let mayBeOpen = false
// Opens not yet answered: until ui.open answers, ui.panes may not list the pane, so a poll then can't clear the flag.
let opening = 0

/**
 * Where the pane is: `shown` (placed, its tab shown), `undrawn` (listed but waiting, as an unasked open on a
 * narrow terminal does), or `none`.
 */
async function paneState($: EngineInterface): Promise<'none' | 'undrawn' | 'shown'> {
  if (!mayBeOpen) return 'none'
  const p = (await $.ui.panes()).find(x => x.id === PANE)
  if (!opening) mayBeOpen = Boolean(p)
  return !p ? 'none' : p.isPlaced && p.isShown ? 'shown' : 'undrawn'
}

const isPaneShown = async ($: EngineInterface) => (await paneState($)) === 'shown'

// A docked pane's frame, in cells, beside its body.
const DOCK_FRAME = 1
// The terminal's width as last measured: exact from a command's presentation, else estimated from a render. 0 before either.
let terminalColumns = 0

/** Opens the pane, asking the dock for half the terminal (at most 100) once its width is known. */
export async function openPane($: EngineInterface) {
  mayBeOpen = true
  const columns = terminalColumns ? Math.min(100, Math.floor(terminalColumns / 2)) : undefined
  opening++
  try {
    return await $.ui.open({ id: PANE, title: TITLE, ...(columns ? { columns } : {}) })
  } finally {
    opening--
  }
}

/** Reads the history into the atom; a failure is kept as the pane's error line. */
export async function refresh($: EngineInterface): Promise<HistoryView> {
  try {
    const { dir, project } = await historyDir($)
    const items = await readHistory($, dir)
    // A failed post's error stays until the next post: a read that works says nothing about the write.
    // `?? ''`: a history saved by a build before postError existed has none.
    return await update($, history, h => ({ dir, project, items, error: '', postError: h.postError ?? '' }))
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, history, h => ({ ...h, error }))
    return { ...(await read($, history)), error }
  }
}

/** Shows one artifact in the reader: its latest version, or `version`. */
export async function openReader($: EngineInterface, id: string, version?: number) {
  const { dir } = await historyDir($)
  const s = await readArtifact($, dir, id, version)
  await update($, shown, () => s)
  await update($, pane, () => ({ view: 'reader', id }) as PaneView)
}

/** A version another session added shows in the reader's count and buttons; the version on screen stays. */
async function catchUpReader($: EngineInterface, items: HistoryView['items']) {
  const s = await read($, shown)
  const now = s && items.find(a => a.id === s.meta.id)
  if (now && now.version > s.latest) await update($, shown, prev => (prev ? { ...prev, latest: now.version } : prev))
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'show',
      description: SHOW_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short title, as the pane lists it' },
          body: { type: 'string', description: 'The artifact, in markdown' },
          kind: { type: 'string', description: 'design, plan, diagram, comparison, summary, notes or exploration' },
          id: { type: 'string', description: 'An earlier artifact to add a version to' },
        },
        required: ['title', 'body'],
      },
    })
    await $.tool.register({
      name: 'list',
      description: LIST_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Matches title, kind or id, ignoring case' },
          limit: { type: 'number', description: 'How many to list; default 20' },
        },
      },
    })
    // A resumed session may still have the pane open: the poll finds out.
    mayBeOpen = true
    await isPaneShown($).catch(() => false)
    $.clock.every(POLL_MS, () => {
      void (async () => {
        if (await isPaneShown($)) await catchUpReader($, (await refresh($)).items)
      })().catch(() => undefined)
    })
    // Last, after the timer: a refused registration throws, and must not stop the poll.
    // Claude Code has a built-in /artifacts, and refuses a plugin command by that name.
    await $.command.register({ name: COMMAND, description: 'Show or hide the designs, plans and diagrams posted for this project' })
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    mayBeOpen = true
    if (e.presentation?.columns) terminalColumns = e.presentation.columns
    const state = await paneState($)
    if (state === 'shown') {
      await $.ui.close({ id: PANE })
      return { text: 'artifacts closed.' }
    }
    // A pane waiting undrawn shows what the post set, the reader on it; a closed one opens on the list.
    if (state === 'none') await update($, pane, () => ({ view: 'list' }) as PaneView)
    await openPane($)
    await refresh($)
    return { text: 'artifacts opened.' }
  })

  on('tool.call', { tool: 'mcp__artifacts__show' }, async ($, e) => {
    const args = checkShow(e as unknown as Record<string, unknown>)
    if ('error' in args) return { deny: args.error }
    try {
      const { dir, home } = await historyDir($)
      const meta = await post($, dir, args, await $.clock.now())
      await update($, history, h => ({ ...h, postError: '' }))
      await update($, mine, ids => (ids.includes(meta.id) ? ids : [...ids, meta.id]))
      await refresh($)
      await openReader($, meta.id).catch(() => undefined)
      const placed = await openPane($).catch(() => ({ isPlaced: false as const }))
      if (!placed.isPlaced) $.ui.toast(`posted ${meta.title} · /${COMMAND}`)
      return { result: `posted ${meta.id} v${meta.version} · ${tilde(`${dir}/${meta.id}.md`, home)}` }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!(err instanceof ShowError)) await update($, history, h => ({ ...h, postError: reason }))
      return { deny: reason }
    }
  })

  on('tool.call', { tool: 'mcp__artifacts__list' }, async ($, e) => {
    const input = e as unknown as { query?: unknown; limit?: unknown }
    try {
      const { dir, home } = await historyDir($)
      const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.floor(input.limit) : 20
      return { result: listText(tilde(dir, home), await readHistory($, dir), typeof input.query === 'string' ? input.query : '', limit) }
    } catch (err) {
      return { deny: err instanceof Error ? err.message : String(err) }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Docked, the viewport is the transcript beside the pane: the terminal is that, the pane's body and its frame.
    if (e.viewport?.columns) terminalColumns = e.props.placement === 'dock' ? e.viewport.columns + e.props.bodyColumns + DOCK_FRAME : e.viewport.columns
    const h = await read($, history)
    const sNow = await read($, shown)
    const editorName = editorArgv(options.editor, '')[0]?.split('/').pop() ?? DEFAULT_EDITOR
    const act: PaneActions = {
      filter: text => void update($, query, () => text).catch(() => undefined),
      openFirst: text =>
        void (async () => {
          await update($, query, () => text)
          const first = newestFirst(h.items).find(a => matchesQuery(a, text))
          if (first) await openReader($, first.id)
          else $.ui.toast(`no artifact matches ${text.trim()}`)
        })().catch(() => undefined),
      open: id => void openReader($, id).catch(() => undefined),
      back: () => void update($, pane, () => ({ view: 'list' }) as PaneView).catch(() => undefined),
      version: n => {
        const s0 = sNow
        if (s0) void openReader($, s0.meta.id, n).catch(() => undefined)
      },
      editor: () => {
        const s0 = sNow
        if (!s0) return
        void (async () => {
          const ran = await $.process.run(editorArgv(options.editor, s0.path)).catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
          if (ran.exitCode !== 0) $.ui.toast(`${editorName} failed: ${ran.stderr.slice(0, 80)}`)
        })()
      },
      keep: () => {
        const s0 = sNow
        if (!s0) return
        void (async () => {
          try {
            const { dir } = await historyDir($)
            const path = await keepInRepo($, dir, s0.meta.id)
            const root = await $.session.root()
            $.ui.toast(`kept · ${path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path}`)
          } catch (err) {
            $.ui.toast(`keep in repo failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        })()
      },
    }
    return drawPane($.ui.resolve(e), {
      history: h,
      pane: await read($, pane),
      query: await read($, query),
      mine: await read($, mine),
      shown: sNow,
      now: await $.clock.now(),
      cols: e.props.bodyColumns || 60,
      surface: e.surface,
      editor: editorName,
      act,
    })
  })
}
