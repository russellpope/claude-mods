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
    expect(Math.abs((got.costUsd ?? NaN) - (costOf('claude-opus-5-5', u1b) + costOf('claude-opus-5-5', u2)))).toBeLessThan(1e-9)
  })

  test('the split: cache reads and output summed apart, a repeated message id counted once', () => {
    const u1 = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 40, output_tokens: 5 }
    const u2 = { input_tokens: 20, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100, output_tokens: 7 }
    const text = [line('m1', 'claude-opus-5-5', u1), line('m1', 'claude-opus-5-5', { ...u1, output_tokens: 50 }), line('m2', 'claude-opus-5-5', u2), ''].join('\n')
    const got = toUsage(addTranscript(emptyUsage(), text))
    expect([got.cachedTokens, got.outputTokens, got.window]).toEqual([3000, 57, 0])
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
    expect(fmtTokens(2_443_000_000)).toBe('2.4B')
    expect(fmtCost(1.234)).toBe('$1.23')
    expect(fmtCost(14.2)).toBe('$14.2')
    expect(fmtTime(65_000)).toBe('1:05')
    expect(fmtTime(6_130_000)).toBe('1:42:10')
  })
})

// Shapes as Claude Code writes them (seen in ~/.claude/projects transcripts, 2026-10/11): a turn that died
// on an API error is a main-chain assistant line, model <synthetic>, every usage count 0.
const apiError = (error: string, status: number | undefined, timestamp: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    isApiErrorMessage: true,
    error,
    ...(status === undefined ? {} : { apiErrorStatus: status }),
    timestamp,
    effort: null,
    message: { id: `e-${timestamp}`, model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: 'OAuth token revoked · Please run /login' }] },
    ...extra,
  })
const userLine = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: 'go on' }, ...extra })
const T1 = '2026-11-18T10:00:00.000Z'

describe('addTranscript: API errors', () => {
  const u = { input_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0, output_tokens: 5 }

  test("a <synthetic> error line leaves the row's model, effort, context, tokens and cost as they were", () => {
    const before = addTranscript(emptyUsage(), `${line('m1', 'claude-opus-5-5', u)}\n`)
    const after = addTranscript(before, `${apiError('authentication_failed', 401, T1)}\n`)
    const pick = (a: typeof before) => [a.model, a.effort, a.contextTokens, a.tokens, a.costUsd, a.cachedTokens, a.outputTokens]
    expect(pick(after)).toEqual(pick(before))
    expect(after.model).toBe('claude-opus-5-5')
  })

  test("a <synthetic> line that is no error (Claude Code's 'No response requested.') is no model either", () => {
    const before = addTranscript(emptyUsage(), `${line('m1', 'claude-opus-5-5', u)}\n`)
    const synthetic = JSON.stringify({ type: 'assistant', isSidechain: false, message: { id: 's1', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: 'No response requested.' }] } })
    const after = addTranscript(before, `${synthetic}\n`)
    expect([after.model, after.contextTokens, after.tokens, after.was]).toEqual(['claude-opus-5-5', before.contextTokens, before.tokens, undefined])
  })

  test('the newest main-chain line being an error line records its reason, status and time', () => {
    const acc = addTranscript(emptyUsage(), [line('m1', 'claude-opus-5-5', u), apiError('authentication_failed', 401, T1), ''].join('\n'))
    expect(toUsage(acc).apiError).toEqual({ reason: 'authentication_failed', status: 401, at: Date.parse(T1) })
  })

  test('an error with no status code keeps a null status', () => {
    expect(addTranscript(emptyUsage(), `${apiError('server_error', undefined, T1)}\n`).apiError).toEqual({ reason: 'server_error', status: null, at: Date.parse(T1) })
  })

  test('a later main-chain user line clears it, even when it arrives in a later read', () => {
    const errored = addTranscript(emptyUsage(), `${line('m1', 'claude-opus-5-5', u)}\n${apiError('server_error', 529, T1)}\n`)
    expect(errored.apiError).toBeDefined()
    const cleared = addTranscript(errored, `{"type":"system","subtype":"turn_duration"}\n${userLine()}\n`)
    expect(cleared.apiError).toBeUndefined()
    expect(toUsage(cleared)).not.toHaveProperty('apiError')
  })

  test('a later main-chain assistant line clears it', () => {
    const errored = addTranscript(emptyUsage(), `${apiError('server_error', 529, T1)}\n`)
    expect(addTranscript(errored, `${line('m2', 'claude-opus-5-5', u)}\n`).apiError).toBeUndefined()
  })

  test('system lines and sidechain lines after it do not clear it', () => {
    const errored = addTranscript(emptyUsage(), `${apiError('server_error', 529, T1)}\n`)
    const text = ['{"type":"system","subtype":"turn_duration","isSidechain":false}', '{"type":"last-prompt"}', userLine({ isSidechain: true }), line('s1', 'claude-haiku-5-5', u, { isSidechain: true }), ''].join('\n')
    expect(addTranscript(errored, text).apiError?.status).toBe(529)
  })

  test('a sidechain error line is not this agent', () => {
    expect(addTranscript(emptyUsage(), `${apiError('server_error', 529, T1, { isSidechain: true })}\n`).apiError).toBeUndefined()
  })
})

describe('addTranscript: model changes', () => {
  const u = { input_tokens: 10, output_tokens: 5 }
  const at = (t: string) => ({ timestamp: t })

  test('a new model keeps the one before and when it changed', () => {
    const text = [line('m1', 'claude-opus-5-5', u, at(T1)), line('m2', 'claude-sonnet-5-5', u, at('2026-11-18T11:00:00.000Z')), ''].join('\n')
    const got = toUsage(addTranscript(emptyUsage(), text))
    expect(got.model).toBe('claude-sonnet-5-5')
    expect(got.was).toEqual({ model: 'claude-opus-5-5', effort: 'high', at: Date.parse('2026-11-18T11:00:00.000Z') })
  })

  test('a new effort on the same model is a change too', () => {
    const text = [line('m1', 'claude-opus-5-5', u, at(T1)), line('m2', 'claude-opus-5-5', u, { effort: 'xhigh', timestamp: '2026-11-18T12:00:00.000Z' }), ''].join('\n')
    expect(addTranscript(emptyUsage(), text).was).toEqual({ model: 'claude-opus-5-5', effort: 'high', at: Date.parse('2026-11-18T12:00:00.000Z') })
  })

  test('the first model, a line with no effort, and the same model again are not changes', () => {
    const text = [line('m1', 'claude-opus-5-5', u, at(T1)), line('m2', 'claude-opus-5-5', u, { effort: null }), line('m3', 'claude-opus-5-5', u), ''].join('\n')
    expect(toUsage(addTranscript(emptyUsage(), text))).not.toHaveProperty('was')
  })

  test('<synthetic> is never a model: an error between two turns of one model is no change', () => {
    const text = [line('m1', 'claude-opus-5-5', u, at(T1)), apiError('authentication_failed', 401, T1), line('m2', 'claude-opus-5-5', u), ''].join('\n')
    const got = addTranscript(emptyUsage(), text)
    expect([got.model, got.was]).toEqual(['claude-opus-5-5', undefined])
  })

  test('the change stays after later lines of the new model', () => {
    const text = [line('m1', 'claude-opus-5-5', u, at(T1)), line('m2', 'claude-sonnet-5-5', u, at(T1)), line('m3', 'claude-sonnet-5-5', u), ''].join('\n')
    expect(addTranscript(emptyUsage(), text).was?.model).toBe('claude-opus-5-5')
  })
})

describe('addTranscript: what does not clear an error (fix r1 M5)', () => {
  // Shapes seen in ~/.claude/projects (2026-11-18): a local command writes an isMeta caveat, then a
  // <command-name> line and a <local-command-stdout> line; a ! command writes <bash-input> and <bash-stdout>.
  // After an error, a resumed session wrote an isMeta 'Continue from where you left off.' and then a
  // <synthetic> 'No response requested.': the agent never answered.
  const errored = () => addTranscript(emptyUsage(), `${apiError('model_not_found', 404, T1)}\n`)
  const text = (content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content }, ...extra })
  const local = [
    text('<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>', { isMeta: true }),
    text('<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>'),
    text('<local-command-stdout>Set model to Opus 5.5</local-command-stdout>'),
    text('<bash-input>pwd</bash-input>'),
    text('<bash-stdout>/w</bash-stdout><bash-stderr></bash-stderr>'),
    text([{ type: 'text', text: '<command-message>model</command-message>\n<command-name>/model</command-name>' }]),
    text([{ type: 'text', text: 'Continue from where you left off.' }], { isMeta: true }),
    JSON.stringify({ type: 'assistant', isSidechain: false, message: { id: 's1', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: 'No response requested.' }] } }),
  ]

  for (const line of local) {
    test(`stays after: ${line.slice(0, 90)}`, () => {
      expect(addTranscript(errored(), `${line}\n`).apiError?.status).toBe(404)
    })
  }

  test('a real prompt as a block list still clears it', () => {
    expect(addTranscript(errored(), `${text([{ type: 'text', text: 'Continue your dispatch.' }])}\n`).apiError).toBeUndefined()
  })
})
