import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Exploration } from '../types'
import { focusTarget, NO_QUESTIONS } from './drawer'
import { GRILL_ROUND_1 } from './fixtures'
import { parseFrontier } from './frontier'
import { summaryPrompt } from './prompts'

type On = Parameters<TestBody>[1]
type E = Parameters<TestBody>[0]

const NOW = new Date(2026, 9, 15, 14, 2, 11).getTime()
const PLAIN = 'Done. The tests pass.'
const QUESTION_MARKS = 'Before I start:\n\nPer worktree or per repo?\nKeep the old flag?\nIs 5 s too often?'
const ANSWER = '### A. One button per option\nFast.\n\n### B. A summary in your voice\nSlower.\n\nRecommendation: A.'
const USAGE = { input_tokens: 10, output_tokens: 1234, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND_ID = 'band-1'

type Msg = { role: 'user' | 'assistant'; text: string }
type Fork = { isAnswered: true; text: string; usage: typeof USAGE } | { isAnswered: false; reason: string; status?: number | null; error?: string; usage?: typeof USAGE }
/** How one save settles: posted, the tool's error (`isError`), a hook's `{ deny }`, or a rejection (no tool answers). */
type Save = 'posted' | 'isError' | 'deny' | 'reject'

/** A session whose transcript starts as `messages` (push to it to go on); records forks, completions, fills, copies, toasts and saves. */
const session = (
  on: On,
  opts: { messages?: Msg[]; forks?: Fork[]; listing?: Fork; filled?: boolean; tools?: string[]; hold?: boolean; saves?: Save[] } = {},
) => {
  const clock = mock.clock(on, { now: NOW })
  const transcript: Msg[] = [...(opts.messages ?? [])]
  const seen = {
    forks: [] as string[],
    /** Each fork's `effort`, in order; undefined where none was passed. */
    efforts: [] as (string | undefined)[],
    completes: 0,
    fills: [] as { text: string; mode: string }[],
    copies: [] as string[],
    toasts: [] as string[],
    saves: [] as Record<string, unknown>[],
    commands: [] as { name: string; immediate?: true; argumentHint?: string }[],
  }
  // hold: each fork waits until the test calls release().
  const gate = { release: () => {} }
  on('session.messages', async () => ({ value: transcript.map(m => ({ ...m, toolUses: [] })) }))
  on('model.fork', async (_$, e) => {
    seen.forks.push(e.prompt)
    seen.efforts.push(e.effort)
    if (opts.hold) await new Promise<void>(r => (gate.release = r))
    const r = opts.forks?.[seen.forks.length - 1] ?? { isAnswered: true, text: ANSWER, usage: USAGE }
    return { value: r as never }
  })
  on('model.complete', async () => {
    seen.completes++
    return { value: (opts.listing ?? { isAnswered: true, text: '❓ **Q1** - **Scope**: Per worktree or per repo?\n❓ **Q2** - **Flag**: Keep the old flag?\n❓ **Q3** - **Poll**: Is 5 s too often?', usage: USAGE }) as never }
  })
  on('prompt.fill', async (_$, e) => {
    seen.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: opts.filled ?? true }
  })
  on('ui.copy', async (_$, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', async (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.list', async () => ({ value: (opts.tools ?? []).map(name => ({ name, description: '', mcp: true })) }))
  on('tool.call', { tool: 'mcp__artifacts__show' }, async (_$, e) => {
    seen.saves.push({ ...e })
    const how = opts.saves?.[seen.saves.length - 1] ?? 'posted'
    if (how === 'isError') return { isError: true as const, result: 'body is required', text: 'body is required' }
    if (how === 'deny') return { deny: 'not now' }
    // A hook that throws is skipped, so the call falls through to no tool and rejects, as for a tool no one serves.
    if (how === 'reject') throw new Error('no artifacts')
    return { result: `posted 2026-10-15-what-take-back-inserts v${seen.saves.length} · ~/.claude/artifacts/x/2026-10-15-what-take-back-inserts.md` }
  })
  on('command.register', async (_$, e) => {
    seen.commands.push({ name: e.name, ...(e.immediate ? { immediate: e.immediate } : {}), ...(e.argumentHint ? { argumentHint: e.argumentHint } : {}) })
    return { value: { command: e.name } }
  })
  // Beneath the mod, the engine's own band: what shows when the mod passes.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'engine' as const, ref: 0 }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  return { clock, seen, gate, transcript }
}

const start = ($: E) => $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
const explore = ($: E, args = '') => $.command.run({ command: 'explore', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
const BAND = (cols = 100, hasSurvey = false) => ({
  hasSurvey, isWorking: false, maxRows: 30, bodyColumns: cols, scroll: { offset: 0, bodyRows: 29 }, view: {},
})
const band = ($: E, cols = 100, hasSurvey = false) =>
  $.ui.mount({ plugin: 'explore', surface: 'terminal', component: 'AbovePrompt', requestId: BAND_ID, props: BAND(cols, hasSurvey) })
const ROUND_2 = [
  '❓ **Q4** - **Cache scope**: Per worktree or per repo?', '', '➡️ (b)', '', '---', '',
  '❓ **Q5** - **Retry**: Retry a failed fork on its own?', '', '➡️ (a)', '', '---', '',
  '❓ **Q6** - **Docs**: A README section?', '', '➡️ (a)',
].join('\n')
const grill = (): Msg[] => [{ role: 'user', text: 'grill me' }, { role: 'assistant', text: GRILL_ROUND_1 }]
const text = async (ui: Awaited<ReturnType<typeof band>>, key: string) => (await ui.find({ type: 'Box', key }))?.text

/** Lets a fork the command started in the background finish. */
const settle = async (clock: ReturnType<typeof mock.clock>) => {
  for (let i = 0; i < 20; i++) await clock.settle()
}

describe('the command', () => {
  test('registered immediate, so it runs mid-turn, with the hint [n]', async ($, on) => {
    const { seen } = session(on)
    await start($)
    expect(seen.commands).toEqual([{ name: 'explore', immediate: true, argumentHint: '[n]' }])
  })

  test('/explore draws the picker: count, where from, numbers, titles and recommendations', async ($, on) => {
    session(on, { messages: grill() })
    await start($)
    expect((await explore($)).text).toBeUndefined()
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/^explore · 10 questions · from the last message\s*close$/)
    expect(await text(ui, 'row-2')).toMatch(/^\s*2\s*Which message is the frontier\s*➡️ \(b\)$/)
    expect(await text(ui, 'row-10')).toMatch(/^\s*10\s*Its own mod, or part of artifacts/)
    await ui.unmount()
  })

  test('a narrow band drops the recommendations and keeps the titles', async ($, on) => {
    session(on, { messages: grill() })
    await start($)
    await explore($)
    const ui = await band($, 40)
    expect(await text(ui, 'row-2')).toMatch(/^\s*2\s*Which message is the frontier$/)
    await ui.unmount()
  })

  test('an older frontier behind a newer plain message is found, and says how far back', async ($, on) => {
    session(on, { messages: [...grill(), { role: 'user', text: 'an aside?' }, { role: 'assistant', text: PLAIN }] })
    await start($)
    await explore($)
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/from 2 messages ago/)
    await ui.unmount()
  })

  test('/explore 12, a number the frontier lacks, opens the picker with a note', async ($, on) => {
    session(on, { messages: grill() })
    await start($)
    await explore($, '12')
    const ui = await band($)
    expect(await text(ui, 'note')).toBe('no Q12 in these questions')
    expect(await text(ui, 'row-1')).toBeDefined()
    await ui.unmount()
  })

  test('/explore <text>, not a number, opens the picker with a note and forks nothing', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    await explore($, 'should the cache be per worktree?')
    await settle(clock)
    expect(seen.forks).toHaveLength(0)
    const ui = await band($)
    expect(await text(ui, 'note')).toBe("explore takes a question's number · /btw for a side question")
    expect(await text(ui, 'row-1')).toBeDefined()
    await ui.unmount()
  })

  test('no frontier: one line says so, with a close button and no field', async ($, on) => {
    session(on, { messages: [{ role: 'assistant', text: PLAIN }] })
    await start($)
    await explore($)
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/^no questions to explore · \/btw for a side question\s*close$/)
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect(await text(ui, 'row-1')).toBeUndefined()
    await ui.press({ key: 'close' })
    expect(await text(ui, 'head')).toBeUndefined()
    await ui.unmount()
  })

  test('a message of ? lines is listed once by Haiku, then read from memory', async ($, on) => {
    const { seen } = session(on, { messages: [{ role: 'assistant', text: QUESTION_MARKS }] })
    await start($)
    await explore($)
    await explore($)
    expect(seen.completes).toBe(1)
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/^explore · 3 questions/)
    await ui.unmount()
  })

  test('a listing that fails: one line says why, with a close button, and stops there', async ($, on) => {
    session(on, { messages: [{ role: 'assistant', text: QUESTION_MARKS }], listing: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' } })
    await start($)
    await explore($)
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/^couldn't list the questions: api error 529 · overloaded\s*close$/)
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect(await text(ui, 'row-1')).toBeUndefined()
    await ui.unmount()
  })

  test('a listing that answers with no questions says so the same way', async ($, on) => {
    session(on, { messages: [{ role: 'assistant', text: QUESTION_MARKS }], listing: { isAnswered: true, text: 'Nothing here.', usage: USAGE } })
    await start($)
    await explore($)
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/^couldn't list the questions: the listing had none\s*close$/)
    await ui.unmount()
  })
})

// The kit answers a mod's `$.ui.focus` beneath every hook, with "no implementation for ui.focus": no test hook sees
// the call. So the mod records what it asked for in `focusAsked` with the call's settled outcome, and a `state.set`
// hook watches that. Only a real call settles with the kit's text, so the record proves the call was made. Where it
// lands is also tested on focusTarget, and the failure by driving the drawer while the kit fails it.
describe('the keyboard', () => {
  const F = { hash: 'h', ago: 0, questions: [{ n: 3, title: 'Three', body: '', rec: '' }, { n: 4, title: 'Four', body: '', rec: '' }] }
  const EX = (turns: number): Exploration => ({
    key: 'h:3', n: 3, title: 'Three', body: '', rec: '', status: 'idle', pending: null, error: '', canRetry: false, taken: [], savedId: '',
    turns: Array.from({ length: turns }, () => ({ ask: '', answer: 'a', ms: 0, tokens: 0 })),
  })
  /** How the kit's `$.ui.focus` settles: it rejects. A stub that resolves (or no call at all) records something else. */
  const KIT_FOCUS = expect.stringMatching(/no implementation for ui\.focus/)
  /** Every value the mod writes to `focusAsked`, in order. */
  const asked = (on: On) => {
    const seen: unknown[] = []
    on('state.set', async (_$, e, next) => {
      if (e.plugin === 'explore' && e.key === 'focusAsked') seen.push(e.value)
      return next(e)
    })
    return seen
  }

  test('opening the picker focuses its first row, in the band its last drawing named', () => {
    expect(focusTarget(BAND_ID, { view: 'picker', note: '' }, F, {})).toEqual({ requestId: BAND_ID, key: 'pick-3' })
  })

  test('opening an exploration with an answer focuses its follow-up field', () => {
    expect(focusTarget(BAND_ID, { view: 'exploration', key: 'h:3' }, F, { 'h:3': EX(1) })).toEqual({ requestId: BAND_ID, key: 'follow-up' })
  })

  test('opening an exploration with no answer yet focuses back, since its follow-up field is not drawn', () => {
    expect(focusTarget(BAND_ID, { view: 'exploration', key: 'h:3' }, F, { 'h:3': EX(0) })).toEqual({ requestId: BAND_ID, key: 'back' })
  })

  test('no band drawn yet (no requestId), or the empty view: no focus is asked', () => {
    expect(focusTarget('', { view: 'picker', note: '' }, F, {})).toBeNull()
    expect(focusTarget('', { view: 'exploration', key: 'h:3' }, F, { 'h:3': EX(1) })).toBeNull()
    expect(focusTarget(BAND_ID, { view: 'empty', note: NO_QUESTIONS }, null, {})).toBeNull()
  })

  test('/explore with the band drawn asks the band, by its requestId, to focus the first row', async ($, on) => {
    const { clock } = session(on, { messages: grill() })
    const seen = asked(on)
    await start($)
    const ui = await band($)
    await explore($)
    await settle(clock)
    expect(seen).toEqual([{ requestId: BAND_ID, key: 'pick-1', outcome: KIT_FOCUS }])
    await ui.unmount()
  })

  test('/explore 5 on a fresh question asks the band to focus back', async ($, on) => {
    const { clock } = session(on, { messages: grill() })
    const seen = asked(on)
    await start($)
    const ui = await band($)
    await explore($, '5')
    await settle(clock)
    expect(seen).toEqual([{ requestId: BAND_ID, key: 'back', outcome: KIT_FOCUS }])
    await ui.unmount()
  })

  test('/explore before the band is drawn asks no focus', async ($, on) => {
    const { clock } = session(on, { messages: grill() })
    const seen = asked(on)
    await start($)
    await explore($)
    await settle(clock)
    expect(seen).toEqual([])
  })

  // The kit's focus only rejects: a resolved `{ deny }` can't be produced here, and takes the same ignored path.
  test('a focus that fails is ignored: /explore opens the picker and says nothing', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    const ui = await band($) // drawn first, so the command has a requestId and asks
    expect((await explore($)).text).toBeUndefined()
    await settle(clock)
    expect(seen.toasts).toEqual([])
    expect(await text(ui, 'head')).toMatch(/^explore · 10 questions/)
    await ui.unmount()
  })

  test('a focus that fails is ignored: /explore 5 opens the exploration and forks', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    const ui = await band($)
    expect((await explore($, '5')).text).toBeUndefined()
    await settle(clock)
    expect(seen.forks).toHaveLength(1)
    expect(seen.toasts).toEqual([])
    expect(await text(ui, 'title')).toBe('Q5 · Several explorations per session')
    await ui.unmount()
  })
})

describe('an exploration', () => {
  test('/explore 5 forks once, naming Q5, its body and the recommendation, and draws the answer', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    await explore($, '5')
    await settle(clock)
    expect(seen.forks).toHaveLength(1)
    expect(seen.forks[0]).toMatch(/side exploration/)
    expect(seen.forks[0]).toMatch(/Question Q5 · Several explorations per session/)
    expect(seen.forks[0]).toMatch(/The grill's recommendation: \(b\)\. Comparing two explorations/)
    expect(seen.forks[0]).toMatch(/### A\. <name>/)
    const ui = await band($)
    expect(await text(ui, 'title')).toBe('Q5 · Several explorations per session')
    expect(await text(ui, 'turn-0')).toMatch(/One button per option/)
    expect(await text(ui, 'status')).toBe('answered in 0s · 1.2k tokens')
    await ui.unmount()
  })

  test('/explore 5 while its fork runs shows it and starts no second', async ($, on) => {
    const { clock, seen, gate } = session(on, { messages: grill(), hold: true })
    await start($)
    await explore($, '5')
    await explore($, '5')
    const ui = await band($)
    expect(await text(ui, 'status')).toMatch(/thinking…$/)
    gate.release()
    await settle(clock)
    expect(seen.forks).toHaveLength(1)
    await ui.unmount()
  })

  test('a follow-up forks again, carrying the exploration so far, and draws beneath', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill(), forks: [{ isAnswered: true, text: ANSWER, usage: USAGE }, { isAnswered: true, text: 'Only for worktrees.', usage: USAGE }] })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.input({ key: 'follow-up', text: 'what about worktrees?' })
    await settle(clock)
    expect(seen.forks[1]).toMatch(/The exploration so far:\n\n### A\. One button per option[\s\S]*Follow-up: what about worktrees\?/)
    expect(await text(ui, 'turn-1')).toMatch(/what about worktrees\?\s*Only for worktrees\./)
    await ui.unmount()
  })

  test('a follow-up sent while a fork runs starts no second fork', async ($, on) => {
    const { clock, seen, gate } = session(on, { messages: grill(), hold: true })
    await start($)
    await explore($, '4')
    await settle(clock) // the fork is waiting at the gate
    gate.release()
    await settle(clock)
    const ui = await band($)
    await ui.input({ key: 'follow-up', text: 'first?' })
    await ui.input({ key: 'follow-up', text: 'second?' })
    expect(seen.forks).toHaveLength(2)
    gate.release()
    await settle(clock)
    await ui.unmount()
  })

  test('several explorations: the picker marks each, and reopening one shows its own', async ($, on) => {
    const { clock } = session(on, { messages: grill(), forks: [{ isAnswered: true, text: 'five', usage: USAGE }, { isAnswered: true, text: 'seven', usage: USAGE }] })
    await start($)
    await explore($, '5')
    await settle(clock)
    await explore($, '7')
    await settle(clock)
    await explore($)
    const ui = await band($)
    expect(await text(ui, 'row-5')).toMatch(/^●/)
    expect(await text(ui, 'row-7')).toMatch(/^●/)
    expect(await text(ui, 'row-6')).not.toMatch(/^●/)
    await ui.press({ key: 'pick-5' })
    expect(await text(ui, 'turn-0')).toBe('five')
    await ui.unmount()
  })

  test('a new round is its own frontier: its Q5 is not marked for the last round\'s', async ($, on) => {
    const { clock, transcript } = session(on, { messages: grill() })
    await start($)
    await explore($, '5')
    await settle(clock)
    transcript.push({ role: 'user', text: '1 ok, 5 b' }, { role: 'assistant', text: ROUND_2 })
    await explore($)
    const ui = await band($)
    expect(await text(ui, 'head')).toMatch(/^explore · 3 questions · from the last message/)
    expect(await text(ui, 'row-5')).toMatch(/^\s*5\s*Retry/)
    await ui.unmount()
  })

  test('nothing to fork: said plainly, with no retry', async ($, on) => {
    const { clock } = session(on, { messages: grill(), forks: [{ isAnswered: false, reason: 'nothing-to-fork' }] })
    await start($)
    await explore($, '5')
    await settle(clock)
    const ui = await band($)
    expect(await text(ui, 'status')).toBe('nothing to explore yet')
    expect(await ui.find({ type: 'Button', key: 'retry' })).toBeUndefined()
    await ui.unmount()
  })

  test('an api error offers retry, and retry forks again', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill(), forks: [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }] })
    await start($)
    await explore($, '5')
    await settle(clock)
    const ui = await band($)
    expect(await text(ui, 'status')).toMatch(/^api error 529 · overloaded\s*retry$/)
    await ui.press({ key: 'retry' })
    await settle(clock)
    expect(seen.forks).toHaveLength(2)
    expect(await text(ui, 'turn-0')).toMatch(/One button per option/)
    await ui.unmount()
  })
})

describe('take back', () => {
  test('each option heading is a take button; take B inserts "4: B, <name>" at the cursor', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    expect(await ui.find({ type: 'Button', key: 'take-A' })).toBeDefined()
    await ui.press({ key: 'take-B' })
    await settle(clock)
    expect(seen.fills).toEqual([{ text: '4: B, A summary in your voice', mode: 'insert' }])
    await ui.unmount()
  })

  test('an answer without option headings offers only take summary', async ($, on) => {
    const { clock } = session(on, { messages: grill(), forks: [{ isAnswered: true, text: 'Just do (b).', usage: USAGE }] })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    expect(await ui.find({ type: 'Button', key: 'take-A' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'take-summary' })).toBeDefined()
    await ui.unmount()
  })

  test('take summary forks once more, at low effort, with the summary prompt, and inserts "4: <summary>"', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill(), forks: [{ isAnswered: true, text: ANSWER, usage: USAGE }, { isAnswered: true, text: 'B, but only for worktrees.\n', usage: USAGE }] })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.press({ key: 'take-summary' })
    await settle(clock)
    expect(seen.forks).toHaveLength(2)
    const q4 = parseFrontier(GRILL_ROUND_1).find(q => q.n === 4)
    if (!q4) throw new Error('the fixture has no Q4')
    const ex: Exploration = {
      key: '', n: 4, title: q4.title, body: q4.body, rec: q4.rec, status: 'idle', pending: null, error: '', canRetry: false, taken: [], savedId: '',
      turns: [{ ask: '', answer: ANSWER, ms: 0, tokens: USAGE.output_tokens }],
    }
    expect(seen.forks[1]).toBe(summaryPrompt(ex))
    expect(seen.forks[1]).toMatch(/In one or two sentences, in the owner's own voice/)
    expect(seen.efforts[1]).toBe('low')
    expect(seen.fills).toEqual([{ text: '4: B, but only for worktrees.', mode: 'insert' }])
    await ui.unmount()
  })

  test("explorations and follow-ups fork at the session's own effort; only take summary asks for low", async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.input({ key: 'follow-up', text: 'what about worktrees?' })
    await settle(clock)
    await ui.press({ key: 'take-summary' })
    await settle(clock)
    expect(seen.forks).toHaveLength(3)
    expect(seen.efforts).toEqual([undefined, undefined, 'low'])
    await ui.unmount()
  })

  test('a take summary that fails offers retry, and retry forks the summary again at low effort and takes it back', async ($, on) => {
    const { clock, seen } = session(on, {
      messages: grill(),
      forks: [
        { isAnswered: true, text: ANSWER, usage: USAGE },
        { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE },
        { isAnswered: true, text: 'B, but only for worktrees.', usage: USAGE },
      ],
    })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.press({ key: 'take-summary' })
    await settle(clock)
    expect(await text(ui, 'status')).toMatch(/^api error 529 · overloaded\s*retry$/)
    expect(seen.fills).toEqual([])
    await ui.press({ key: 'retry' })
    await settle(clock)
    expect(seen.forks).toHaveLength(3)
    expect(seen.forks[2]).toBe(seen.forks[1])
    expect(seen.efforts).toEqual([undefined, 'low', 'low'])
    expect(seen.fills).toEqual([{ text: '4: B, but only for worktrees.', mode: 'insert' }])
    await ui.unmount()
  })

  test('when the draft will not take it (a dialog, or headless), it is copied and a toast says so', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill(), filled: false })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.press({ key: 'take-A' })
    await settle(clock)
    expect(seen.copies).toEqual(['4: A, One button per option'])
    expect(seen.toasts.at(-1)).toBe('copied, to paste into your reply: 4: A, One button per option')
    await ui.unmount()
  })
})

describe('save to artifacts', () => {
  test('hidden while the artifacts tool is not listed', async ($, on) => {
    const { clock } = session(on, { messages: grill() })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    expect(await ui.find({ type: 'Button', key: 'save' })).toBeUndefined()
    await ui.unmount()
  })

  test('posts the whole exploration as kind exploration; saving again passes the id that came back', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill(), tools: ['mcp__artifacts__show'] })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.press({ key: 'take-B' })
    await settle(clock)
    await ui.press({ key: 'save' })
    await settle(clock)
    expect(seen.saves[0]).toMatchObject({ tool: 'mcp__artifacts__show', title: 'What "take back" inserts', kind: 'exploration' })
    expect(seen.saves[0]?.id).toBeUndefined()
    const body = String(seen.saves[0]?.body)
    expect(body).toMatch(/^## Q4 · What "take back" inserts\n\nThe exploration lays out options A, B, C… Options:/)
    expect(body).toMatch(/➡️ The grill's recommendation: \(c\)\./)
    expect(body).toMatch(/## Exploration\n\n### A\. One button per option/)
    expect(body).toMatch(/## Taken back\n\n- 4: B, A summary in your voice$/)
    expect(seen.toasts.at(-1)).toBe('saved to artifacts · 2026-10-15-what-take-back-inserts v1')
    await ui.press({ key: 'save' })
    await settle(clock)
    expect(seen.saves[1]?.id).toBe('2026-10-15-what-take-back-inserts')
    await ui.unmount()
  })

  // A failed save shows on the drawer's status line, where every failure shows, and as a toast.
  const failedSave = (how: Save, why: RegExp) =>
    async ($: E, on: On) => {
      const { clock, seen } = session(on, { messages: grill(), tools: ['mcp__artifacts__show'], saves: [how] })
      await start($)
      await explore($, '4')
      await settle(clock)
      const ui = await band($)
      await ui.press({ key: 'save' })
      await settle(clock)
      expect(seen.saves).toHaveLength(1)
      expect(await text(ui, 'status')).toMatch(why)
      expect(seen.toasts.at(-1)).toMatch(why)
      expect(seen.toasts.some(t => t.startsWith('saved'))).toBe(false)
      // No retry button: the save button is still there to press again.
      expect(await ui.find({ type: 'Button', key: 'retry' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: 'save' })).toBeDefined()
      await ui.unmount()
    }

  test('a save the tool answers with an error (isError) shows it on the status line', failedSave('isError', /^save to artifacts failed: body is required$/))
  test('a save that rejects (no tool has the name) shows it on the status line', failedSave('reject', /^save to artifacts failed: .+/))
  test('a save a hook denies shows it on the status line', failedSave('deny', /^save to artifacts failed: not now$/))

  test('a save that fails, then one that posts: the status line goes back to the last answer', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill(), tools: ['mcp__artifacts__show'], saves: ['isError', 'posted'] })
    await start($)
    await explore($, '4')
    await settle(clock)
    const ui = await band($)
    await ui.press({ key: 'save' })
    await settle(clock)
    expect(await text(ui, 'status')).toMatch(/^save to artifacts failed/)
    await ui.press({ key: 'save' })
    await settle(clock)
    expect(await text(ui, 'status')).toBe('answered in 0s · 1.2k tokens')
    expect(seen.toasts.at(-1)).toBe('saved to artifacts · 2026-10-15-what-take-back-inserts v2')
    await ui.unmount()
  })

  test('a save that fails while a follow-up runs leaves the spinner, and the follow-up still lands', async ($, on) => {
    const { clock, seen, gate } = session(on, { messages: grill(), tools: ['mcp__artifacts__show'], saves: ['isError'], hold: true })
    await start($)
    await explore($, '4')
    await settle(clock)
    gate.release()
    await settle(clock)
    const ui = await band($)
    await ui.input({ key: 'follow-up', text: 'worktrees?' })
    await settle(clock)
    await ui.press({ key: 'save' })
    await settle(clock)
    expect(seen.toasts.at(-1)).toBe('save to artifacts failed: body is required')
    expect(await text(ui, 'status')).toMatch(/thinking…$/)
    // Still running, so a second follow-up starts no second fork.
    await ui.input({ key: 'follow-up', text: 'again?' })
    expect(seen.forks).toHaveLength(2)
    gate.release()
    await settle(clock)
    expect(await text(ui, 'turn-1')).toMatch(/worktrees\?/)
    await ui.unmount()
  })
})
