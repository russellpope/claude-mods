import { describe, expect, test } from 'claude-code/testing'

import type { Exploration } from '../types'
import { parseFrontier } from './frontier'
import { artifactBody, failure, fmtCall, forkPrompt, listingPrompt, summaryText, takeText } from './prompts'

const EX: Exploration = {
  key: 'h:5', n: 5, title: 'Several explorations', body: 'One or many?', rec: '(b). Comparing is the point.',
  turns: [], status: 'idle', pending: null, error: '', canRetry: false, taken: [], savedId: '',
}

describe('prompts', () => {
  test('the first fork names the question and asks for lettered options', () => {
    const p = forkPrompt(EX, '')
    expect(p).toMatch(/^This is a side exploration/)
    expect(p).toMatch(/Question Q5 · Several explorations\n\nOne or many\?\n\nThe grill's recommendation: \(b\)\. Comparing is the point\./)
    expect(p).toMatch(/`### A\. <name>`, `### B\. <name>`/)
  })

  test('a follow-up carries every turn so far, then the follow-up', () => {
    const ex = { ...EX, turns: [{ ask: '', answer: 'first', ms: 0, tokens: 0 }, { ask: 'why?', answer: 'because', ms: 0, tokens: 0 }] }
    expect(forkPrompt(ex, 'and then?')).toMatch(/The exploration so far:\n\nfirst\n\nFollow-up: why\?\n\nbecause\n\nFollow-up: and then\?\n\nAnswer the follow-up only\.$/)
  })
})

describe('the listing', () => {
  test("its format line, with a number for <n>, is a question the parser reads", () => {
    const line = listingPrompt('Per repo?').split('\n').find(l => l.startsWith('❓')) ?? ''
    expect(parseFrontier(line.replace('<n>', '3'))).toEqual([{ n: 3, title: '<a title of a few words>', body: '<the question>', rec: '' }])
  })
})

describe('take back text', () => {
  test('numbered for an option, numbered on one line for a summary', () => {
    expect(takeText(5, 'B', 'A summary')).toBe('5: B, A summary')
    expect(summaryText(5, ' B, but\nonly here. \n')).toBe('5: B, but only here.')
  })
})

describe('the artifact', () => {
  test('question with the recommendation, then the exploration, follow-ups and what was taken back', () => {
    const ex = { ...EX, turns: [{ ask: '', answer: 'opts', ms: 0, tokens: 0 }, { ask: 'why?', answer: 'because', ms: 0, tokens: 0 }], taken: ['5: B, x'] }
    expect(artifactBody(ex)).toBe(
      "## Q5 · Several explorations\n\nOne or many?\n\n➡️ The grill's recommendation: (b). Comparing is the point.\n\n## Exploration\n\nopts\n\n## Follow-up: why?\n\nbecause\n\n## Taken back\n\n- 5: B, x",
    )
  })
})

describe('status', () => {
  test('time and output tokens', () => {
    expect(fmtCall(14_000, 1234)).toBe('answered in 14s · 1.2k tokens')
    expect(fmtCall(65_000, 850)).toBe('answered in 1m 05s · 850 tokens')
  })

  test('each failure in words, and whether retry can help', () => {
    expect(failure({ reason: 'nothing-to-fork' })).toEqual({ error: 'nothing to explore yet', canRetry: false })
    expect(failure({ reason: 'api-error', status: 529, error: 'overloaded' })).toEqual({ error: 'api error 529 · overloaded', canRetry: true })
    expect(failure({ reason: 'empty-reply' })).toEqual({ error: 'no answer', canRetry: true })
    expect(failure({ reason: 'aborted' })).toEqual({ error: 'cancelled', canRetry: true })
  })
})
