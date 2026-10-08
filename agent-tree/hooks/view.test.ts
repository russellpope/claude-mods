import { describe, expect, test } from 'claude-code/testing'

import type { HerdrAgent, TreeNode } from '../types'
import { ctxBar, ctxPercent, groupAll, isCompact, statusLine, totals, treePrefix } from './view'

const node = (over: Partial<TreeNode>): TreeNode => ({
  pane: 'p', parent: 'R', depth: 0, isLast: false, name: 'n', harness: 'claude', role: 'other', status: 'working',
  title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '', ...over,
})
const ag = (pane: string, cwd: string): HerdrAgent => ({ pane, name: pane, harness: 'codex', status: 'idle', title: '', label: '', cwd, workspace: '', session: '', terminal: '' })

describe('view', () => {
  test('compact: auto under 60 columns, or forced', () => {
    expect(isCompact('auto', 59)).toBe(true)
    expect(isCompact('auto', 60)).toBe(false)
    expect(isCompact('on', 200)).toBe(true)
    expect(isCompact('off', 20)).toBe(false)
  })

  test('tree prefix by depth and last sibling', () => {
    expect(treePrefix(node({ depth: 0 }))).toBe('')
    expect(treePrefix(node({ depth: 1, isLast: false }))).toBe('├ ')
    expect(treePrefix(node({ depth: 2, isLast: true }))).toBe('  └ ')
  })

  test('All view groups by main repo name, sorted', () => {
    const groups = groupAll([ag('a', '/w/kintsugi-vhvf'), ag('b', '/p/praxis'), ag('c', '/p/kintsugi')], { '/w/kintsugi-vhvf': '/p/kintsugi', '/p/kintsugi': '/p/kintsugi' })
    expect(groups.map(([name, list]) => [name, list.map(a => a.pane)])).toEqual([
      ['kintsugi', ['a', 'c']],
      ['praxis', ['b']],
    ])
  })

  test('totals: cost and tokens of every row with usage; time from first start to last seen', () => {
    const u = { model: 'm', effort: '', contextTokens: 1, tokens: 100, costUsd: 1.5 }
    expect(totals([node({ usage: u, startedAt: 10, lastSeen: 50 }), node({ usage: u, startedAt: 20, lastSeen: 90 }), node({ startedAt: 15, lastSeen: 15 })])).toEqual({ cost: 3, tokens: 200, time: 80 })
    expect(totals([])).toEqual({ cost: 0, tokens: 0, time: 0 })
  })

  test('status line counts live working and blocked; nothing live clears it', () => {
    expect(statusLine([node({ status: 'working' }), node({ status: 'working' }), node({ status: 'blocked' }), node({ status: 'done' })])).toBe('tree 2● 1!')
    expect(statusLine([node({ status: 'idle' })])).toBe('tree 0●')
    expect(statusLine([node({ status: 'gone' }), node({ status: 'done' })])).toBeUndefined()
  })

  test('context percent and bar', () => {
    expect(ctxPercent({ model: 'claude-opus-5-5', effort: '', contextTokens: 410_000, tokens: 0, costUsd: 0 })).toBe(41)
    expect(ctxPercent(null)).toBe(0)
    expect(ctxBar(40, 5)).toBe('▓▓░░░')
  })
})
