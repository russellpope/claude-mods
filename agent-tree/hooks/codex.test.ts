import { describe, expect, test } from 'claude-code/testing'

import { addRollout, codexUsage } from './codex'
import { emptyUsage } from './usage'

// The shapes codex 0.163 writes to ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, cut to what the reader uses.
const turn = (model: string, effort: string | null) => JSON.stringify({ type: 'turn_context', payload: { model, effort, cwd: '/w' } })
const count = (total: number, cached: number, output: number, last: number, window = 828_400) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: total - output, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0, total_tokens: total },
        last_token_usage: { input_tokens: last - 73, cached_input_tokens: 0, output_tokens: 73, total_tokens: last },
        model_context_window: window,
      },
    },
  })

describe('addRollout', () => {
  test('model and effort from the turn context; context, window and running totals from the newest token count', () => {
    const text = [turn('gpt-6.1-sol', 'high'), count(1_000_000, 900_000, 5_000, 80_000), 'garbage', count(3_006_149, 2_900_864, 11_410, 100_705), ''].join('\n')
    expect(codexUsage(addRollout(emptyUsage(), text))).toEqual({
      model: 'gpt-6.1-sol',
      effort: 'high',
      contextTokens: 100_705,
      window: 828_400,
      tokens: 3_006_149,
      cachedTokens: 2_900_864,
      outputTokens: 11_410,
      costUsd: null,
    })
  })

  test('a token count with no info (a rate-limit update) keeps the last numbers', () => {
    const empty = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {} } })
    const got = codexUsage(addRollout(emptyUsage(), [turn('gpt-5.6-sol', 'medium'), count(500, 100, 50, 400), empty, ''].join('\n')))
    expect([got.tokens, got.contextTokens, got.effort]).toEqual([500, 400, 'medium'])
  })

  test('a later turn that changes model or drops effort is what shows', () => {
    const got = codexUsage(addRollout(emptyUsage(), [turn('gpt-6.1-sol', 'high'), turn('gpt-5.6-sol', null), ''].join('\n')))
    expect([got.model, got.effort]).toEqual(['gpt-5.6-sol', ''])
  })

  test('feeding a rollout in two pieces equals feeding it whole', () => {
    const a = `${turn('gpt-6.1-sol', 'high')}\n${count(10, 5, 1, 9)}\n`
    const b = `${count(30, 20, 3, 25)}\n`
    expect(codexUsage(addRollout(addRollout(emptyUsage(), a), b))).toEqual(codexUsage(addRollout(emptyUsage(), a + b)))
  })
})
