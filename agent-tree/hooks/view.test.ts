import { describe, expect, test } from 'claude-code/testing'

import type { HerdrAgent, TreeNode } from '../types'
import { clip, countsLine, ctxPercent, dots, groupAll, isCompact, meterColor, modelLabel, rowColumns, spanText, statusLine, totals, treePrefix } from './view'

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

  test('context percent', () => {
    expect(ctxPercent({ model: 'claude-opus-5-5', effort: '', contextTokens: 410_000, tokens: 0, costUsd: 0 })).toBe(41)
    expect(ctxPercent(null)).toBe(0)
  })
})

describe('meter (the statusline build_bar: green, orange from 50, yellow from 70, red from 90)', () => {
  test('colour thresholds', () => {
    expect([0, 49, 50, 69, 70, 89, 90, 100].map(meterColor)).toEqual(['#00A000', '#00A000', '#FFB055', '#FFB055', '#E6C800', '#E6C800', '#FF5555', '#FF5555'])
  })

  test('dots: filled rounds down, as the statusline does; clamped to 0..100', () => {
    expect(dots(15, 10)).toEqual({ filled: '●', empty: '○○○○○○○○○' })
    expect(dots(0, 10)).toEqual({ filled: '', empty: '○○○○○○○○○○' })
    expect(dots(100, 10)).toEqual({ filled: '●●●●●●●●●●', empty: '' })
    expect(dots(140, 4)).toEqual({ filled: '●●●●', empty: '' })
    expect(dots(-5, 4)).toEqual({ filled: '', empty: '○○○○' })
  })
})

describe('row text', () => {
  test('a row never seen running shows no time, not 0:00', () => {
    expect(spanText(node({ status: 'gone', startedAt: 500, lastSeen: 500 }))).toBe('—')
    expect(spanText(node({ status: 'gone', startedAt: 0, lastSeen: 65_000 }))).toBe('1:05')
    expect(spanText(node({ status: 'working', startedAt: 0, lastSeen: 3_725_000 }))).toBe('1:02:05')
  })

  test('model label: family and effort', () => {
    expect(modelLabel({ model: 'claude-opus-5-5', effort: 'high', contextTokens: 0, tokens: 0, costUsd: 0 })).toBe('Opus 5.5·high')
    expect(modelLabel({ model: 'claude-sonnet-5-5', effort: '', contextTokens: 0, tokens: 0, costUsd: 0 })).toBe('Sonnet 5.5')
    expect(modelLabel(null)).toBe('')
  })

  test('counts: live states, then finished (done or gone); zeros left out', () => {
    expect(countsLine([node({ status: 'working' }), node({ status: 'idle' }), node({ status: 'idle' }), node({ status: 'blocked' }), node({ status: 'done' }), node({ status: 'gone' })])).toBe(
      '1 working · 2 idle · 1 blocked · 2 finished',
    )
    expect(countsLine([node({ status: 'gone' })])).toBe('1 finished')
    expect(countsLine([])).toBe('no workers yet')
  })

  test('clip: long names end in an ellipsis at the width', () => {
    expect(clip('kintsugi-nxom-final-reviewer', 12)).toBe('kintsugi-nx…')
    expect(clip('short', 12)).toBe('short')
  })

  test('columns: widths from the widest row, tree prefix included in the name column, capped', () => {
    const u = { model: 'claude-opus-5-5', effort: 'high', contextTokens: 0, tokens: 0, costUsd: 12.345 }
    const cols = rowColumns([node({ name: 'lead', depth: 0 }), node({ name: 'reviewer', depth: 1, harness: 'opencode', usage: u })], 30)
    expect(cols).toEqual({ name: 10, harness: 8, model: 13, cost: 6 })
    expect(rowColumns([node({ name: 'x'.repeat(80) })], 30).name).toBe(30)
    expect(rowColumns([], 30)).toEqual({ name: 0, harness: 0, model: 0, cost: 0 })
  })
})
