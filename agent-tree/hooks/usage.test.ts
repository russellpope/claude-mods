import { describe, expect, test } from 'claude-code/testing'

import { addTranscript, costOf, emptyUsage, fmtCost, fmtTime, fmtTokens, modelName, projectDirName, toUsage, transcriptPath, wholeLines } from './usage'

const line = (id: string, model: string, u: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, effort: 'high', message: { id, model, usage: u }, ...extra })

describe('addTranscript', () => {
  test('latest context, summed tokens and cost; a repeated message id replaces its earlier line', () => {
    const u1 = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 5 }
    const u1b = { ...u1, output_tokens: 50 }
    const u2 = { input_tokens: 20, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100, output_tokens: 7 }
    const text = [line('m1', 'claude-opus-5-5', u1), line('m1', 'claude-opus-5-5', u1b), '{"type":"user"}', 'garbage', line('m2', 'claude-opus-5-5', u2), ''].join('\n')
    const got = toUsage(addTranscript(emptyUsage(), text))
    expect(got.model).toBe('claude-opus-5-5')
    expect(got.effort).toBe('high')
    expect(got.contextTokens).toBe(2127)
    expect(got.tokens).toBe(1060 + 2127)
    expect(Math.abs(got.costUsd - (costOf('claude-opus-5-5', u1b) + costOf('claude-opus-5-5', u2)))).toBeLessThan(1e-9)
  })

  test('sidechain lines (in-session subagents) are not this agent', () => {
    const got = toUsage(addTranscript(emptyUsage(), line('m9', 'claude-haiku-5-5', { input_tokens: 99, output_tokens: 1 }, { isSidechain: true })))
    expect(got.tokens).toBe(0)
  })

  test('feeding a transcript in two pieces equals feeding it whole', () => {
    const a = line('m1', 'claude-sonnet-5-5', { input_tokens: 1, output_tokens: 1 })
    const b = line('m2', 'claude-sonnet-5-5', { input_tokens: 2, output_tokens: 2 })
    expect(toUsage(addTranscript(addTranscript(emptyUsage(), a + '\n'), b + '\n'))).toEqual(toUsage(addTranscript(emptyUsage(), `${a}\n${b}\n`)))
  })
})

describe('wholeLines', () => {
  test('cuts after the last newline and counts UTF-8 bytes', () => {
    expect(wholeLines('ab\ncd')).toEqual({ text: 'ab\n', bytes: 3 })
    expect(wholeLines('é\n')).toEqual({ text: 'é\n', bytes: 3 })
    expect(wholeLines('no newline yet')).toEqual({ text: '', bytes: 0 })
  })
})

describe('paths and formats', () => {
  test('transcript path from cwd and session', () => {
    expect(projectDirName('/Users/ldh/Projects/github.com/praxis')).toBe('-Users-ldh-Projects-github-com-praxis')
    expect(transcriptPath('/Users/ldh', '/Users/ldh/x.y', 'abc')).toBe('/Users/ldh/.claude/projects/-Users-ldh-x-y/abc.jsonl')
  })

  test('model names and numbers', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(12_400)).toBe('12k')
    expect(fmtTokens(3_100_000)).toBe('3.1M')
    expect(fmtCost(1.234)).toBe('$1.23')
    expect(fmtCost(14.2)).toBe('$14.2')
    expect(fmtTime(65_000)).toBe('1:05')
    expect(fmtTime(6_130_000)).toBe('1:42:10')
  })
})
