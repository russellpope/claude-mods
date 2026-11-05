import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DrawerView, Exploration, FrontierView, Pending, Question } from '../types'
import { drawBand, exploredKey, focusTarget, NO_QUESTIONS } from './drawer'
import type { DrawerActions } from './drawer'
import { findFrontier, hashText, parseFrontier } from './frontier'
import { artifactBody, failure, forkPrompt, listingPrompt, summaryPrompt, summaryText, takeText } from './prompts'

export const COMMAND = 'explore'
const ARTIFACTS_SHOW = 'mcp__artifacts__show'
const FRAME_MS = 250
/** The fewest parsed questions an answer needs for the hint. */
const HINT_MIN = 3

export const drawer = atom({ plugin: 'explore', key: 'drawer' } as const, { view: 'closed' } as DrawerView)
export const frontier = atom({ plugin: 'explore', key: 'frontier' } as const, null as FrontierView | null)
export const explorations = atom({ plugin: 'explore', key: 'explorations' } as const, {} as Record<string, Exploration>)
export const listed = atom({ plugin: 'explore', key: 'listed' } as const, {} as Record<string, Question[]>)
export const hint = atom({ plugin: 'explore', key: 'hint' } as const, 0)
export const frame = atom({ plugin: 'explore', key: 'frame' } as const, 0)
// What opening the drawer last asked `$.ui.focus` for, written once the call settles, with how it settled: 'moved',
// or the deny or rejection text. The kit can't see the call, but only a real call settles with the kit's rejection,
// so tests asserting that outcome prove the call was made.
export const focusAsked = atom({ plugin: 'explore', key: 'focusAsked' } as const, null as { requestId: string; key: string; outcome: string } | null)

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
  const r = await $.ui.focus(target).catch((err: unknown) => ({ deny: String(err) }))
  await update($, focusAsked, () => ({ ...target, outcome: r.deny ? r.deny : 'moved' }))
}

/** Opens the drawer on `view` and moves the keyboard there: what `/explore` and the hint button do. */
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

/** Puts `text` at the cursor in the owner's draft; under a dialog or headless, on the clipboard with a toast. */
async function takeBack($: EngineInterface, key: string, text: string) {
  const filled = await $.prompt.fill({ text, mode: 'insert' }).catch(() => ({ isFilled: false }))
  if (!filled.isFilled) {
    const copied = await $.ui.copy({ text }).catch(() => ({ isCopied: false }))
    $.ui.toast(copied.isCopied ? `copied, to paste into your reply: ${text}` : `could not insert or copy: ${text}`)
  }
  await setEx($, key, e => ({ ...e, taken: [...e.taken, text] }))
}

/** One more fork, at low effort, for where the owner lands in their own words; taken back as `n: <summary>`. */
async function takeSummary($: EngineInterface, key: string) {
  const ex = await getEx($, key)
  if (!ex || ex.status === 'thinking' || !ex.turns.length) return
  await setEx($, key, e => ({ ...e, status: 'thinking', pending: { kind: 'summary' }, error: '', canRetry: false }))
  const r = await $.model.fork({ prompt: summaryPrompt(ex), effort: 'low' }).catch(rejected)
  if (!r.isAnswered) {
    const f = failure(r)
    await setEx($, key, e => ({ ...e, status: 'failed', error: f.error, canRetry: f.canRetry }))
    return
  }
  await setEx($, key, e => ({ ...e, status: 'idle', pending: null }))
  await takeBack($, key, summaryText(ex.n, r.text))
}

async function retry($: EngineInterface, key: string) {
  const ex = await getEx($, key)
  const p: Pending | null = ex?.status === 'failed' ? ex.pending : null
  if (p?.kind === 'summary') {
    await setEx($, key, e => ({ ...e, status: 'idle' }))
    return takeSummary($, key)
  }
  if (p?.kind === 'ask') return runFork($, key, p.ask)
}

/** A failed save on the status line (left alone while a fork runs there, whose spinner and guard it would clobber) and as a toast. */
async function saveFailed($: EngineInterface, key: string, why: string) {
  const error = `save to artifacts failed: ${why}`
  await setEx($, key, e => (e.status === 'thinking' ? e : { ...e, status: 'failed', pending: { kind: 'save' }, error, canRetry: false }))
  $.ui.toast(error)
}

/**
 * Saves the whole exploration through the artifacts mod's tool; a second save passes the id the first returned.
 * A failed save (a deny, the tool's error, or a rejection when no tool has the name) shows on the status line, unless
 * a fork is running there, and as a toast. A save that posts clears an earlier save's failure.
 */
async function save($: EngineInterface, key: string) {
  const ex = await getEx($, key)
  if (!ex) return
  const r = await $.tool
    .call({ tool: ARTIFACTS_SHOW, title: ex.title, kind: 'exploration', body: artifactBody(ex), ...(ex.savedId ? { id: ex.savedId } : {}) })
    .catch((err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) }))
  if (r.deny !== undefined) return saveFailed($, key, r.deny)
  if (r.isError) return saveFailed($, key, r.text ?? String(r.result ?? 'the tool reported an error'))
  const posted = /^posted (\S+) (v\d+)/.exec(typeof r.result === 'string' ? r.result : String(r.text ?? ''))
  await setEx($, key, e => ({
    ...e,
    ...(posted?.[1] ? { savedId: posted[1] } : {}),
    ...(e.pending?.kind === 'save' ? { status: 'idle' as const, pending: null, error: '' } : {}),
  }))
  $.ui.toast(posted ? `saved to artifacts · ${posted[1]} ${posted[2]}` : 'saved to artifacts')
}

/** The picker's note for an argument naming no question of the frontier. */
const missing = (arg: string) => (/^\d+$/.test(arg) ? `no Q${arg} in these questions` : "explore takes a question's number · /btw for a side question")

/**
 * Opens the drawer for `/explore [arg]` and the hint button (arg ''): Q`arg`'s exploration, or the picker, with a note
 * for an argument naming no question; with no frontier, the line saying why.
 */
async function openFor($: EngineInterface, arg: string) {
  const { view, note } = await loadFrontier($)
  await update($, frontier, () => view)
  if (!view) return openDrawer($, { view: 'empty', note })
  const q = /^\d+$/.test(arg) ? view.questions.find(x => x.n === Number(arg)) : undefined
  if (q) return exploreQuestion($, view, q, true)
  return openDrawer($, { view: 'picker', note: arg ? missing(arg) : '' })
}

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
    await openFor($, e.args.trim())
    return {}
  })

  // The hint: the main thread's answer's parsed question count, kept from three up until the next submit.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) {
      const n = parseFrontier(e.answer).length
      await update($, hint, () => (n >= HINT_MIN ? n : 0))
    }
    return done
  })

  on('prompt.submit', async ($, e, next) => {
    if (await read($, hint)) await update($, hint, () => 0)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Kept from every drawing, so opening the drawer can name the band to `$.ui.focus`.
    bandId = e.requestId
    if (e.props.hasSurvey) return next(e)
    const view = await read($, drawer)
    const hinted = await read($, hint)
    if (view.view === 'closed' && !hinted) return next(e)
    const key = view.view === 'exploration' ? view.key : ''
    const act: DrawerActions = {
      open: () => void openFor($, '').catch(() => undefined),
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
      take: (letter, name) =>
        void (async () => {
          const ex = await getEx($, key)
          if (ex) await takeBack($, key, takeText(ex.n, letter, name))
        })().catch(() => undefined),
      takeSummary: () => void takeSummary($, key).catch(() => undefined),
      save: () => void save($, key).catch(() => undefined),
    }
    const canSave = view.view === 'exploration' && (await $.tool.list().catch(() => [])).some(t => t.name === ARTIFACTS_SHOW)
    return drawBand($.ui.resolve(e), {
      view,
      hint: hinted,
      frontier: await read($, frontier),
      explorations: await read($, explorations),
      frame: await read($, frame),
      cols: e.props.bodyColumns || 80,
      surface: e.surface,
      canSave,
      act,
    })
  })
}
