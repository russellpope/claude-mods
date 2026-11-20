import { describe, expect, test } from 'claude-code/testing'

import type { BatchCounts } from '../types'
import { etaMs, etaText, observeBatch, observeBook, paceBook } from './pace'
import type { Pace } from './pace'

const MIN = 60_000
const batch = (fixed: number, total = 10, stamp = '2026-11-18-ab12'): BatchCounts => ({ stamp, fixed, inProgress: 1, open: total - fixed - 1, total })
// Each step: [minutes since the batch was first seen, fixed count]. A JSON round trip between steps stands for a reload:
// the record lives in mod state, which a reload keeps, so it must survive being stored.
const walk = (steps: [number, number][], opts: { reloadAfter?: number; total?: number } = {}): Pace | null => {
  let p: Pace | null = null
  steps.forEach(([m, fixed], i) => {
    p = observeBatch(p, batch(fixed, opts.total), m * MIN)
    if (opts.reloadAfter === i) p = JSON.parse(JSON.stringify(p)) as Pace
  })
  return p
}

describe('observeBatch', () => {
  test('first sight records the time and the count, and closes from before it are not observations', () => {
    expect(observeBatch(null, batch(4), 5 * MIN)).toEqual({ stamp: '2026-11-18-ab12', firstSeen: 5 * MIN, high: 4, closes: [] })
  })

  test('each rise is an observed close at that time; two at once are two closes', () => {
    expect(walk([[0, 1], [20, 2], [50, 4]])?.closes).toEqual([20 * MIN, 50 * MIN, 50 * MIN])
  })

  test('no batch this refresh keeps the record', () => {
    const p = walk([[0, 1], [20, 2]])
    expect(observeBatch(p, null, 30 * MIN)).toBe(p)
  })

  test('a new stamp starts over', () => {
    const p = walk([[0, 1], [20, 2], [40, 3]])
    expect(observeBatch(p, batch(0, 6, '2026-11-19-cd34'), 60 * MIN)).toEqual({ stamp: '2026-11-19-cd34', firstSeen: 60 * MIN, high: 0, closes: [] })
  })

  test('a count that goes down records nothing, and climbing back to where it was records nothing either', () => {
    const p = walk([[0, 1], [20, 2], [40, 3], [50, 2], [60, 3]])
    expect(p?.closes).toEqual([20 * MIN, 40 * MIN])
    expect(walk([[0, 1], [20, 2], [40, 3], [50, 2], [60, 4]])?.closes).toEqual([20 * MIN, 40 * MIN, 60 * MIN])
  })

  test('a reload in the middle keeps the observations', () => {
    const steps: [number, number][] = [[0, 1], [20, 2], [40, 3]]
    expect(walk(steps, { reloadAfter: 1 })).toEqual(walk(steps))
  })
})

describe('etaMs', () => {
  test('tickets not yet fixed times the mean time per close since the batch was first seen', () => {
    // First seen at 0, closes at 20 and 40: 20 min a close; 7 left of 10 → 140 min.
    const p = walk([[0, 1], [20, 2], [40, 3]])
    expect(etaMs(p, batch(3), 40 * MIN)).toBe(140 * MIN)
  })

  test('fewer than two observed closes: no estimate', () => {
    expect(etaMs(walk([[0, 1]]), batch(1), 0)).toBeNull()
    expect(etaMs(walk([[0, 1], [20, 2]]), batch(2), 20 * MIN)).toBeNull()
  })

  test('none left: no estimate', () => {
    expect(etaMs(walk([[0, 8], [20, 9], [40, 10]]), batch(10), 40 * MIN)).toBeNull()
  })

  test('a count that went down: the tickets now left, at the pace observed', () => {
    const p = walk([[0, 1], [20, 2], [40, 3], [50, 2]])
    expect(etaMs(p, batch(2), 50 * MIN)).toBe(8 * 20 * MIN)
  })

  test("another batch's record gives no estimate", () => {
    expect(etaMs(walk([[0, 1], [20, 2], [40, 3]]), batch(3, 10, 'other'), 40 * MIN)).toBeNull()
  })

  test('a reload in the middle gives the same estimate', () => {
    const steps: [number, number][] = [[0, 1], [20, 2], [40, 3]]
    expect(etaMs(walk(steps, { reloadAfter: 0 }), batch(3), 40 * MIN)).toBe(etaMs(walk(steps), batch(3), 40 * MIN))
  })
})

describe('etaText', () => {
  test('hours and minutes, rounded to the minute, at least one', () => {
    expect(etaText(80 * MIN)).toBe('~1h 20m left')
    expect(etaText(120 * MIN)).toBe('~2h left')
    expect(etaText(45 * MIN + 20_000)).toBe('~45m left')
    expect(etaText(10_000)).toBe('~1m left')
  })
})

describe('etaMs over time (fix r1 C3)', () => {
  // First seen at 0, closes at 20 and 40 min: a plain mean of 20 min a close, 7 of 10 left.
  const p = walk([[0, 1], [20, 2], [40, 3]])

  test('for one mean interval after the newest close the estimate holds', () => {
    expect(etaMs(p, batch(3), 40 * MIN)).toBe(140 * MIN)
    expect(etaMs(p, batch(3), 50 * MIN)).toBe(140 * MIN)
    expect(etaMs(p, batch(3), 60 * MIN)).toBe(140 * MIN)
  })

  test('after that it grows with the time since first seen, as if a close were due now', () => {
    // max(40, 90 - 20) = 70 → 35 min a close → 245 min.
    expect(etaMs(p, batch(3), 90 * MIN)).toBe(245 * MIN)
    expect(etaMs(p, batch(3), 300 * MIN)).toBeGreaterThan(etaMs(p, batch(3), 90 * MIN) ?? Infinity)
  })
})

describe('a book of batches (fix r1 C2)', () => {
  const at = (m: number) => m * MIN

  test('a tree that moves between two batches keeps each batch\'s observations', () => {
    let book = observeBook([], batch(1, 10, 'A'), at(0))
    book = observeBook(book, batch(2, 10, 'A'), at(20))
    book = observeBook(book, batch(0, 6, 'B'), at(25))
    book = observeBook(book, batch(3, 10, 'A'), at(40))
    expect(book.find(r => r.stamp === 'A')).toEqual({ stamp: 'A', firstSeen: 0, high: 3, closes: [at(20), at(40)] })
    expect(book.find(r => r.stamp === 'B')).toEqual({ stamp: 'B', firstSeen: at(25), high: 0, closes: [] })
  })

  test('at most five; the one seen least recently goes first', () => {
    let book: Pace[] = []
    for (const [i, s] of ['A', 'B', 'C', 'D', 'E'].entries()) book = observeBook(book, batch(0, 5, s), at(i))
    book = observeBook(book, batch(0, 5, 'A'), at(10))
    book = observeBook(book, batch(0, 5, 'F'), at(11))
    expect(book.map(r => r.stamp)).toEqual(['C', 'D', 'E', 'A', 'F'])
  })

  test('nothing new: the same book back, so nothing is written', () => {
    const book = observeBook([], batch(1, 10, 'A'), at(0))
    expect(observeBook(book, batch(1, 10, 'A'), at(5))).toBe(book)
    expect(observeBook(book, null, at(5))).toBe(book)
  })

  test('state kept in the single-record shape still loads', () => {
    const old: Pace = { stamp: 'A', firstSeen: 0, high: 3, closes: [at(20), at(40)] }
    expect(paceBook(old)).toEqual([old])
    expect(paceBook(null)).toEqual([])
    expect(paceBook([old])).toEqual([old])
    expect(paceBook({ nonsense: true })).toEqual([])
  })
})
