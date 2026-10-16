import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HistoryView, PaneView, Shown } from '../types'
import { ShowError, historyDir, post, readHistory, tilde } from './history'
import { checkShow, listText } from './store'

export const PANE = 'artifacts'

export const EMPTY_HISTORY: HistoryView = { dir: '', project: '', items: [], error: '' }
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

/** Reads the history into the atom; a failure is kept as the pane's error line. */
export async function refresh($: EngineInterface): Promise<HistoryView> {
  try {
    const { dir, project } = await historyDir($)
    const next: HistoryView = { dir, project, items: await readHistory($, dir), error: '' }
    await update($, history, () => next)
    return next
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, history, h => ({ ...h, error }))
    return { ...(await read($, history)), error }
  }
}

export const register: Register = on => {
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
    return started
  })

  on('tool.call', { tool: 'mcp__artifacts__show' }, async ($, e) => {
    const args = checkShow(e as unknown as Record<string, unknown>)
    if ('error' in args) return { deny: args.error }
    try {
      const { dir, home } = await historyDir($)
      const meta = await post($, dir, args, await $.clock.now())
      await update($, mine, ids => (ids.includes(meta.id) ? ids : [...ids, meta.id]))
      await refresh($)
      return { result: `posted ${meta.id} v${meta.version} · ${tilde(`${dir}/${meta.id}.md`, home)}` }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!(err instanceof ShowError)) await update($, history, h => ({ ...h, error: reason }))
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
}
