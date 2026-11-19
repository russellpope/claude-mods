import { describe, expect, test } from 'claude-code/testing'

import { BRIEF_ROUND, GRILL_ROUND_1 } from './fixtures'
import { findFrontier, hashText, parseFrontier, parseOptions, questionMarkLines, reversibility, shortRec } from './frontier'

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

  test('a title with no colon after it still starts a question: a small model drops it', () => {
    // Haiku's round 2 in the 2026-11-05 live check wrote this shape.
    const text = '❓ **Q8** - **Which store** (depends on Q1, settled)\nOne file or two?\n\n➡️ (a)'
    expect(parseFrontier(text)).toEqual([{ n: 8, title: 'Which store', body: '(depends on Q1, settled)\nOne file or two?', rec: '(a)' }])
    expect(parseFrontier('❓ **Q3** - **T**\nbody\n➡️ (b)')).toEqual([{ n: 3, title: 'T', body: 'body', rec: '(b)' }])
  })

  test('a colon inside the bold is no part of the title', () => {
    expect(parseFrontier('❓ **Q1** - **T:** body\n➡️ (a)')).toEqual([{ n: 1, title: 'T', body: 'body', rec: '(a)' }])
  })

  test('lines ending in ? are counted only outside code', () => {
    expect(questionMarkLines(QUESTION_MARKS)).toBe(3)
    expect(questionMarkLines('```\na?\nb?\nc?\n```')).toBe(0)
    expect(parseFrontier(QUESTION_MARKS)).toEqual([])
  })

  test('a question in bold still ends in ?', () => {
    expect(questionMarkLines('**Q1. One file?**\n**Q2. Two?** \n__Q3. Three?__')).toBe(3)
  })
})

describe('a round whose questions carry option briefs', () => {
  const qs = parseFrontier(BRIEF_ROUND)
  /** The fixture's text from a question's title line to the blank line before its ➡️: what its body must be. */
  const between = (n: number) => {
    const lines = BRIEF_ROUND.split('\n')
    const from = lines.findIndex(l => l.startsWith(`❓ **Q${n}**`))
    const to = lines.findIndex((l, i) => i > from && l.startsWith('➡️'))
    const first = (lines[from] ?? '').replace(/^❓ \*\*Q\d+\*\* - \*\*.+?\*\*: ?/, '')
    return [first, ...lines.slice(from + 1, to)].join('\n').trim()
  }

  test('every question, numbered and titled', () => {
    expect(qs.map(q => [q.n, q.title])).toEqual([
      [1, 'Where the usage log lives'],
      [2, 'Line format'],
      [3, "A question's reversibility when its options differ"],
      [4, 'Pruning the log'],
      [5, 'Event names'],
    ])
  })

  test('each body is whole: every option bullet, its nested downside, reversibility and touches, and paragraphs after them', () => {
    for (const q of qs) expect(q.body).toBe(between(q.n))
    expect(qs[0]?.body.split('\n')).toHaveLength(14)
    expect(qs[0]?.body).toMatch(/^Explore appends one line per open, exploration and take\. Options:\n- \*\*\(a\) `~\/\.local/)
    expect(qs[0]?.body).toMatch(/  - Scale: one more artifact per session, every day of the trial\.$/)
    expect(qs[3]?.body).toMatch(/  - Touches: the trial review \(I071\) and anyone auditing it\.\n\nSecurity: the log holds question titles, which can name private projects\. It stays on this machine, in the home folder, and nothing sends it anywhere\.$/)
    expect(qs[4]?.body).toBe(
      'Options:\n- (a) `open`, `exploration`, `take`, the ticket\'s words: cheap; touches explore and the review.\n- (b) `open`, `fork`, `take`, the engine\'s words: cheap; touches the same.',
    )
  })

  test('each ➡️ recommendation, with what would change it, on its line or the next', () => {
    expect(qs.map(q => q.rec)).toEqual([
      "(a). It's where this repo already keeps a mod's local state. I'd change this if the review tooling can only read under `~/.claude`.",
      '(a), with tabs and newlines in titles turned to spaces. A field that needs nesting would change it.',
      "(a). The pre-fork question is whether a one-way choice is on the table, not whether it was recommended.\nWhat would change it: the review wanting the recommended option's reversibility as well.",
      "(a) for the trial. I'd change it if the file passes 1 MiB before the review.",
      "(a). The review reads the ticket's words; only a second reader with its own names would change it.",
    ])
  })

  test('the closing line is no part of the last question', () => {
    expect(qs[4]?.rec).not.toMatch(/Answer however you like/)
    expect(qs[4]?.body).not.toMatch(/Answer however you like/)
  })

  test('as the frontier: found, with all five questions', () => {
    expect(findFrontier([{ role: 'assistant', text: BRIEF_ROUND }])).toEqual({ kind: 'parsed', text: BRIEF_ROUND, ago: 0, questions: qs })
  })
})

describe("a question's reversibility", () => {
  const qs = parseFrontier(BRIEF_ROUND)

  test('the most severe its brief states: one-way over costly over cheap', () => {
    expect(qs.map(q => reversibility(q.body))).toEqual(['costly', 'cheap', 'cheap', 'one-way', 'cheap'])
  })

  test('only the labelled reversibility counts where a brief labels it, not the scale words in prose', () => {
    // Q3's body says "one-way option" in its question; its options are labelled cheap.
    expect(qs[2]?.body).toMatch(/one-way option/)
    expect(reversibility(qs[2]?.body ?? '')).toBe('cheap')
    expect(reversibility('- (a) x\n  - Downside: costly to run.\n  - **Reversibility:** cheap.')).toBe('cheap')
  })

  test('a one-line brief with no label: its scale words', () => {
    expect(reversibility('- (a) x: cheap; touches y.\n- (b) z: one-way; touches w.')).toBe('one-way')
    expect(reversibility('- (a) x — Costly. Touches y.')).toBe('costly')
  })

  test('each option counts on its own: a labelled option does not hide an unlabelled one-way option', () => {
    expect(reversibility('- A. rename — Reversibility: cheap\n- B. drop column — one-way, loses data')).toBe('one-way')
  })

  test('a question with no option bullets: its prose sets nothing, not "a one-way door"', () => {
    expect(reversibility('Picking the format now is a one-way door, so think it through.')).toBe('')
  })

  test('a question with no option bullets: its prose sets nothing, not "cheap to try"', () => {
    expect(reversibility('Option (a) is cheap to try, and (b) needs a migration.')).toBe('')
  })

  test('a loose list: a blank line before an indented line keeps the option going', () => {
    expect(reversibility('- **(a) x**\n\n  - Reversibility: one-way\n\n- **(b) z**\n\n  - Reversibility: cheap')).toBe('one-way')
  })

  test('a blank line before unindented prose ends the option, so prose after the list sets nothing', () => {
    expect(reversibility('- **(a) x**\n\n  - Reversibility: cheap\n\nReversibility: one-way, as a one-way door.')).toBe('cheap')
  })

  test('a body that states none: empty', () => {
    expect(reversibility(qs.length ? GRILL_ROUND_1 : '')).toBe('')
    expect(reversibility('Per worktree or per repo?')).toBe('')
    expect(reversibility('')).toBe('')
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
