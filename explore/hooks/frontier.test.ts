import { describe, expect, test } from 'claude-code/testing'

import { GRILL_ROUND_1 } from './fixtures'
import { findFrontier, hashText, parseFrontier, parseOptions, questionMarkLines, shortRec } from './frontier'

const QUESTION_MARKS = [
  'A few things before I start:',
  '',
  'Should the cache live per worktree or per repo?',
  'Do we keep the old flag for one release?',
  'Is a 5 s poll too often on battery?',
  '',
  'Tell me and I will begin.',
].join('\n')

const PLAIN = 'Done. The tests pass, and the commit is 1f754bf.'

describe('parsing a grilling round', () => {
  const qs = parseFrontier(GRILL_ROUND_1)

  test('ten questions, numbered in order, none from text that only mentions the format', () => {
    expect(qs.map(q => q.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test('titles, including quotes and commas', () => {
    expect(qs.map(q => q.title)).toEqual([
      'Name',
      'Which message is the frontier',
      'Reading the questions out',
      'What "take back" inserts',
      'Several explorations per session',
      'The hint line',
      'What "save to artifacts" keeps',
      'Drawer height',
      'No frontier to pick from',
      'Its own mod, or part of artifacts',
    ])
  })

  test('a body runs from the title line to the recommendation, across bullets and paragraphs', () => {
    expect(qs[1]?.body).toBe(
      [
        '`/explore` needs a message to pick questions from. Options:',
        '- (a) Only the very last assistant message.',
        '- (b) The newest assistant message that has ❓ questions, even if I\'ve said something since (say you asked an aside and I answered), with the drawer noting "from 3 messages ago".',
        '- (c) All unanswered ❓ questions across the conversation.',
      ].join('\n'),
    )
    // A body that starts on the next line, with a paragraph after its bullets.
    expect(qs[6]?.body).toMatch(/^- \(a\) Just the exploration's answer\.\n- \(b\) .*\n\nSaving again after more follow-ups adds a version\.$/)
  })

  test('the recommendation is the ➡️ line, without the arrow', () => {
    expect(qs[0]?.rec).toBe("Keep `/explore`. It's what you naturally called it, and it can't collide with a slash command.")
    expect(qs[9]?.rec).toBe('(a). Each one stays small and testable, and either works without the other.')
  })

  test("the text after the last question's rule is no part of it", () => {
    expect(qs[9]?.rec).not.toMatch(/Answer however you like/)
  })

  test('the short recommendation is its first sentence, without code marks', () => {
    expect(shortRec(qs[0]?.rec ?? '')).toBe('Keep /explore')
    expect(shortRec(qs[1]?.rec ?? '')).toBe('(b)')
    expect(shortRec('Yes. You will forget it otherwise.')).toBe('Yes')
  })

  test('a recommendation with no rule after it ends at the first blank line', () => {
    const text = '❓ **Q1** - **T**: body\n\n➡️ (a). Because.\n\nAnswer however you like.'
    expect(parseFrontier(text)).toEqual([{ n: 1, title: 'T', body: 'body', rec: '(a). Because.' }])
  })

  test('a body line that quotes the format mid-line starts no question', () => {
    const text = '❓ **Q1** - **Format**: two options:\n- (a) write `❓ **Q5** - **title**: body` lines\n- (b) anything\n\n➡️ (a)'
    expect(parseFrontier(text).map(q => q.n)).toEqual([1])
  })

  test('a ❓ line inside a code fence is body text, not a question', () => {
    const text = '❓ **Q1** - **Format**: write lines like\n```\n❓ **Q2** - **T**: body\n---\n```\n➡️ (a)'
    expect(parseFrontier(text)).toEqual([{ n: 1, title: 'Format', body: 'write lines like\n```\n❓ **Q2** - **T**: body\n---\n```', rec: '(a)' }])
  })

  test('variation selectors and dashes vary; the parse does not', () => {
    const text = '❓️ **Q2** — **T**: body\n➡ (b)'
    expect(parseFrontier(text)).toEqual([{ n: 2, title: 'T', body: 'body', rec: '(b)' }])
  })

  test('lines ending in ? are counted only outside code', () => {
    expect(questionMarkLines(QUESTION_MARKS)).toBe(3)
    expect(questionMarkLines('```\na?\nb?\nc?\n```')).toBe(0)
    expect(parseFrontier(QUESTION_MARKS)).toEqual([])
  })
})

describe('finding the frontier', () => {
  const msg = (role: 'user' | 'assistant', text: string) => ({ role, text })

  test('the newest assistant message with questions, and how many messages came after it', () => {
    const f = findFrontier([msg('user', 'go'), msg('assistant', GRILL_ROUND_1), msg('user', 'aside?'), msg('assistant', PLAIN)])
    expect(f).toEqual({ kind: 'parsed', text: GRILL_ROUND_1, ago: 2, questions: parseFrontier(GRILL_ROUND_1) })
  })

  test('the last message: ago 0', () => {
    expect(findFrontier([msg('assistant', GRILL_ROUND_1)])?.ago).toBe(0)
  })

  test('a message of ? lines needs a listing; a plain one is no frontier', () => {
    expect(findFrontier([msg('assistant', QUESTION_MARKS)])).toEqual({ kind: 'unlisted', text: QUESTION_MARKS, ago: 0 })
    expect(findFrontier([msg('assistant', PLAIN)])).toBeNull()
    expect(findFrontier([msg('user', GRILL_ROUND_1)])).toBeNull()
  })

  test('empty messages (tool calls only) are not counted as messages after it', () => {
    expect(findFrontier([msg('assistant', GRILL_ROUND_1), msg('assistant', ''), msg('assistant', PLAIN)])?.ago).toBe(1)
  })
})

describe('an answer', () => {
  test('its option headings, in order', () => {
    const answer = '### A. One button per option\nfast\n\n### B. A summary in your voice\nslow\n\n### C) Both\n\nRecommendation: C.'
    expect(parseOptions(answer)).toEqual([
      { letter: 'A', name: 'One button per option' },
      { letter: 'B', name: 'A summary in your voice' },
      { letter: 'C', name: 'Both' },
    ])
    expect(parseOptions('### Option A: Keep it\n### Option B) Drop it')).toEqual([
      { letter: 'A', name: 'Keep it' },
      { letter: 'B', name: 'Drop it' },
    ])
    expect(parseOptions('No headings here.')).toEqual([])
  })
})

describe('hashing', () => {
  test('a text keys the same every time, and two texts differently', () => {
    expect(hashText(GRILL_ROUND_1)).toBe(hashText(GRILL_ROUND_1))
    expect(hashText(GRILL_ROUND_1)).toMatch(/^[0-9a-f]{8}$/)
    expect(hashText('a')).not.toBe(hashText('b'))
  })
})
