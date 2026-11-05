import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { focusTarget, NO_QUESTIONS } from './drawer'
import { GRILL_ROUND_1 } from './fixtures'

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

/** A session whose transcript starts as `messages` (push to it to go on); records forks, completions, fills, copies, toasts and saves. */
const session = (
  on: On,
  opts: { messages?: Msg[]; forks?: Fork[]; listing?: Fork; filled?: boolean; tools?: string[]; hold?: boolean } = {},
) => {
  const clock = mock.clock(on, { now: NOW })
  const transcript: Msg[] = [...(opts.messages ?? [])]
  const seen = {
    forks: [] as string[],
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
// the call. So where it lands is tested on focusTarget, and the refusal by driving the drawer while the kit refuses.
describe('the keyboard', () => {
  const F = { hash: 'h', ago: 0, questions: [{ n: 3, title: 'Three', body: '', rec: '' }, { n: 4, title: 'Four', body: '', rec: '' }] }

  test('opening the picker focuses its first row, in the band its last drawing named', () => {
    expect(focusTarget(BAND_ID, { view: 'picker', note: '' }, F)).toEqual({ requestId: BAND_ID, key: 'pick-3' })
  })

  test('opening an exploration focuses its follow-up field', () => {
    expect(focusTarget(BAND_ID, { view: 'exploration', key: 'h:3' }, F)).toEqual({ requestId: BAND_ID, key: 'follow-up' })
  })

  test('no band drawn yet (no requestId), or the empty view: no focus is asked', () => {
    expect(focusTarget('', { view: 'picker', note: '' }, F)).toBeNull()
    expect(focusTarget('', { view: 'exploration', key: 'h:3' }, F)).toBeNull()
    expect(focusTarget(BAND_ID, { view: 'empty', note: NO_QUESTIONS }, null)).toBeNull()
  })

  test('a refused focus is ignored: /explore opens the picker and says nothing', async ($, on) => {
    const { clock, seen } = session(on, { messages: grill() })
    await start($)
    const ui = await band($) // drawn first, so the command has a requestId and asks
    expect((await explore($)).text).toBeUndefined()
    await settle(clock)
    expect(seen.toasts).toEqual([])
    expect(await text(ui, 'head')).toMatch(/^explore · 10 questions/)
    await ui.unmount()
  })

  test('a refused focus is ignored: /explore 5 opens the exploration and forks', async ($, on) => {
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
