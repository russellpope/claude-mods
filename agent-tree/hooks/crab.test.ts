import { describe, expect, test } from 'claude-code/testing'

import type { TreeNode } from '../types'
import { CRAB_ROWS, PALETTE, halfBlock, moodOf, spriteFor } from './crab'

const node = (status: TreeNode['status'], role: TreeNode['role'] = 'implementer'): TreeNode => ({
  pane: 'p', parent: 'R', depth: 0, isLast: true, name: 'n', harness: 'claude', role, status,
  title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '',
})

describe('halfBlock', () => {
  test('two pixel rows per cell row, runs merged', () => {
    expect(halfBlock(['cc.k', '.c.k'])).toEqual([
      [
        { text: '▀', fg: PALETTE.c },
        { text: '▀', fg: PALETTE.c, bg: PALETTE.c },
        { text: ' ' },
        { text: '▀', fg: PALETTE.k, bg: PALETTE.k },
      ],
    ])
    expect(halfBlock(['..', 'cc'])).toEqual([[{ text: '▄▄', fg: PALETTE.c }]])
  })

  test('every sprite of every mood is 16 wide and CRAB_ROWS tall, in both frames', () => {
    for (const mood of ['typing', 'review', 'blocked', 'asleep', 'party'] as const) {
      for (const f of [0, 1]) {
        const rows = spriteFor(mood, f)
        expect(rows).toHaveLength(CRAB_ROWS * 2)
        for (const r of rows) expect(r).toHaveLength(16)
        for (const ch of rows.join('')) expect(ch === '.' || ch in PALETTE).toBe(true)
      }
    }
  })

  test('typing alternates claws', () => {
    expect(spriteFor('typing', 0)).not.toEqual(spriteFor('typing', 1))
  })
})

describe('moodOf', () => {
  test('party > blocked > review-only > typing > asleep', () => {
    expect(moodOf([node('working')], { stamp: 's', fixed: 3, inProgress: 0, open: 0, total: 3 })).toBe('party')
    expect(moodOf([node('working'), node('blocked')], null)).toBe('blocked')
    expect(moodOf([node('working', 'reviewer'), node('idle')], null)).toBe('review')
    expect(moodOf([node('working', 'reviewer'), node('working')], null)).toBe('typing')
    expect(moodOf([node('idle'), node('gone')], null)).toBe('asleep')
    expect(moodOf([], null)).toBe('asleep')
  })
})
