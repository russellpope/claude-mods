import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DrawerView, Exploration, FrontierView, Pending, Question } from '../types'
import { drawBand, exploredKey, focusTarget, NO_QUESTIONS } from './drawer'
import type { DrawerActions } from './drawer'
import { findFrontier, hashText, parseFrontier } from './frontier'
import { failure, forkPrompt, listingPrompt } from './prompts'

export const COMMAND = 'explore'
const FRAME_MS = 250

export const drawer = atom({ plugin: 'explore', key: 'drawer' } as const, { view: 'closed' } as DrawerView)
export const frontier = atom({ plugin: 'explore', key: 'frontier' } as const, null as FrontierView | null)
export const explorations = atom({ plugin: 'explore', key: 'explorations' } as const, {} as Record<string, Exploration>)
export const listed = atom({ plugin: 'explore', key: 'listed' } as const, {} as Record<string, Question[]>)
export const hint = atom({ plugin: 'explore', key: 'hint' } as const, 0)
export const frame = atom({ plugin: 'explore', key: 'frame' } as const, 0)
// What opening the drawer last asked `$.ui.focus` for: the kit can't see the call itself, so tests watch this.
export const focusAsked = atom({ plugin: 'explore', key: 'focusAsked' } as const, null as { requestId: string; key: string } | null)

// The band's `requestId`, from its last drawing; '' before one. Not state: a render hook may not write state.
let bandId = ''

const blank = (key: string, q: Question): Exploration => ({
  key, n: q.n, title: q.title, body: q.body, rec: q.rec, turns: [], status: 'idle', pending: null, error: '', canRetry: false, taken: [], savedId: '',
})

const setEx = ($: EngineInterface, key: string, fn: (ex: Exploration) => Exploration) =>
  update($, explorations, all => {
    const ex = all[key]
    return ex ? { ...all, [key]: fn(ex) } : all
  })

const getEx = async ($: EngineInterface, key: string) => (await read($, explorations))[key]

// A fork that rejects instead of answering is a failure like any other.
const rejected = (err: unknown) => ({ isAnswered: false as const, reason: 'rejected', error: err instanceof Error ? err.message : String(err) })

/** The frontier from the transcript: parsed, or listed once by Haiku for a message of `?` lines. With none, the note says why. */
export async function loadFrontier($: EngineInterface): Promise<{ view: FrontierView | null; note: string }> {
  const f = findFrontier(await $.session.messages())
  if (!f) return { view: null, note: NO_QUESTIONS }
  const hash = hashText(f.text)
  if (f.kind === 'parsed') return { view: { hash, ago: f.ago, questions: f.questions }, note: '' }
  const kept = (await read($, listed))[hash]
  if (kept) return { view: { hash, ago: f.ago, questions: kept }, note: '' }
  const r = await $.model.complete({ model: 'haiku', prompt: listingPrompt(f.text), maxTokens: 2048 }).catch(rejected)
  const questions = r.isAnswered ? parseFrontier(r.text) : []
  if (!questions.length) return { view: null, note: `couldn't list the questions: ${r.isAnswered ? 'the listing had none' : failure(r).error}` }
  await update($, listed, all => ({ ...all, [hash]: questions }))
  return { view: { hash, ago: f.ago, questions }, note: '' }
}

/** Moves the keyboard into the band, onto `view`'s first element (focusTarget). No band drawn yet, or a refusal, leaves it where it is. */
async function focusDrawer($: EngineInterface, view: DrawerView) {
  const target = focusTarget(bandId, view, await read($, frontier), await read($, explorations))
  if (!target) return
  await update($, focusAsked, () => target)
  await $.ui.focus(target)
}

/** Opens the drawer on `view` and moves the keyboard there: what `/explore` does, and the hint button will. */
export async function openDrawer($: EngineInterface, view: DrawerView) {
  await update($, drawer, () => view)
  // In the background: the engine waits, bounded, for an element not drawn yet. A `{ deny }` is ignored.
  void focusDrawer($, view).catch(() => undefined)
}

/** One fork: the question itself (`ask` ''), or a follow-up. A fork already running for this exploration starts no second. */
export async function runFork($: EngineInterface, key: string, ask: string) {
  const ex = await getEx($, key)
  if (!ex || ex.status === 'thinking') return
  await setEx($, key, e => ({ ...e, status: 'thinking', pending: { kind: 'ask', ask }, error: '', canRetry: false }))
  const started = await $.clock.now()
  const r = await $.model.fork({ prompt: forkPrompt(ex, ask) }).catch(rejected)
  const ms = (await $.clock.now()) - started
  if (r.isAnswered) {
    await setEx($, key, e => ({ ...e, status: 'idle', pending: null, turns: [...e.turns, { ask, answer: r.text, ms, tokens: r.usage.output_tokens }] }))
  } else {
    const f = failure(r)
    await setEx($, key, e => ({ ...e, status: 'failed', error: f.error, canRetry: f.canRetry }))
  }
}

/** Shows `q`'s exploration, forking its first answer if it has none; `open` also moves the keyboard there. */
async function exploreQuestion($: EngineInterface, f: FrontierView, q: Question, open: boolean) {
  const key = exploredKey(f.hash, q.n)
  await update($, explorations, all => (all[key] ? all : { ...all, [key]: blank(key, q) }))
  const view: DrawerView = { view: 'exploration', key }
  if (open) await openDrawer($, view)
  else await update($, drawer, () => view)
  const ex = await getEx($, key)
  if (ex && !ex.turns.length && ex.status === 'idle') void runFork($, key, '').catch(() => undefined)
}

async function retry($: EngineInterface, key: string) {
  const ex = await getEx($, key)
  const p: Pending | null = ex?.status === 'failed' ? ex.pending : null
  if (p?.kind === 'ask') return runFork($, key, p.ask)
}

/** The picker's note for an argument naming no question of the frontier. */
const missing = (arg: string) => (/^\d+$/.test(arg) ? `no Q${arg} in these questions` : "explore takes a question's number · /btw for a side question")

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The spinner steps only while a fork runs.
    $.clock.every(FRAME_MS, () => {
      void (async () => {
        if (Object.values(await read($, explorations)).some(x => x.status === 'thinking')) await update($, frame, f => f + 1)
      })().catch(() => undefined)
    })
    await $.command.register({
      name: COMMAND,
      description: 'Explore one question of the last grilling round beside the conversation',
      argumentHint: '[n]',
      immediate: true,
    })
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    const { view, note } = await loadFrontier($)
    await update($, frontier, () => view)
    if (!view) {
      await openDrawer($, { view: 'empty', note })
      return {}
    }
    const q = /^\d+$/.test(arg) ? view.questions.find(x => x.n === Number(arg)) : undefined
    if (q) await exploreQuestion($, view, q, true)
    else await openDrawer($, { view: 'picker', note: arg ? missing(arg) : '' })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Kept from every drawing, so opening the drawer can name the band to `$.ui.focus`.
    bandId = e.requestId
    if (e.props.hasSurvey) return next(e)
    const view = await read($, drawer)
    if (view.view === 'closed') return next(e)
    const key = view.view === 'exploration' ? view.key : ''
    const act: DrawerActions = {
      close: () => void update($, drawer, () => ({ view: 'closed' }) as DrawerView).catch(() => undefined),
      pick: n =>
        void (async () => {
          const f = await read($, frontier)
          const q = f?.questions.find(x => x.n === n)
          if (f && q) await exploreQuestion($, f, q, false)
        })().catch(() => undefined),
      back: () => void update($, drawer, () => ({ view: 'picker', note: '' }) as DrawerView).catch(() => undefined),
      followUp: text => {
        if (key && text.trim()) void runFork($, key, text.trim()).catch(() => undefined)
      },
      retry: () => void retry($, key).catch(() => undefined),
    }
    return drawBand($.ui.resolve(e), {
      view,
      frontier: await read($, frontier),
      explorations: await read($, explorations),
      frame: await read($, frame),
      cols: e.props.bodyColumns || 80,
      surface: e.surface,
      act,
    })
  })
}
