import { describe, expect, test } from 'claude-code/testing'

import type { HerdrAgent, TreeNode, Usage } from '../types'
import { ageText, clip, costLine, costText, countsLine, ctxPercent, dots, groupAll, isCompact, meterColor, modelLabel, rowColumns, spanText, statusLine, tokenLine, totals, treePrefix } from './view'

const node = (over: Partial<TreeNode>): TreeNode => ({
  pane: 'p', parent: 'R', depth: 0, isLast: false, name: 'n', harness: 'claude', role: 'other', status: 'working',
  title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '', ...over,
})
const use = (over: Partial<Usage>): Usage => ({ model: 'claude-opus-5-5', effort: '', contextTokens: 0, window: 0, tokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, ...over })
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

  test('totals: cost, tokens and their split over every row with usage; a row with no price adds no cost; time from first start to last seen', () => {
    const u = use({ tokens: 100, cachedTokens: 90, outputTokens: 4, costUsd: 1.5 })
    const codex = use({ model: 'gpt-6.1-sol', tokens: 50, cachedTokens: 40, outputTokens: 2, costUsd: null })
    expect(totals([node({ usage: u, startedAt: 10, lastSeen: 50 }), node({ usage: u, startedAt: 20, lastSeen: 90 }), node({ usage: codex, startedAt: 30, lastSeen: 40 }), node({ startedAt: 15, lastSeen: 15 })])).toEqual({
      cost: 3,
      tokens: 250,
      cached: 220,
      output: 10,
      time: 80,
      hasUnpriced: true,
    })
    expect(totals([node({ usage: u })]).hasUnpriced).toBe(false)
    expect(totals([])).toEqual({ cost: 0, tokens: 0, cached: 0, output: 0, time: 0, hasUnpriced: false })
  })

  test('totals: a row whose usage predates the split (kept in state across a reload) adds its tokens and nothing to the split', () => {
    const { cachedTokens: _c, outputTokens: _o, ...old } = use({ tokens: 100, costUsd: 1.5 })
    const t = totals([node({ usage: old as Usage }), node({ usage: use({ tokens: 50, cachedTokens: 40, outputTokens: 2 }) })])
    expect(t).toMatchObject({ tokens: 150, cached: 40, output: 2 })
    expect(tokenLine(t)).toBe('150 tok · 26% cache reads · 2 output')
  })

  test("cost line: the estimate and elapsed time; with a codex row in the sum it says the estimate is Claude's alone", () => {
    expect(costLine({ cost: 3, time: 80_000, hasUnpriced: false })).toBe('≈$3.00 · 1:20 elapsed')
    expect(costLine({ cost: 955.7, time: 9_418_000, hasUnpriced: true })).toBe('≈$955.7 Claude only · 2:36:58 elapsed')
  })

  test('token line: the burn, the share read back from the cache (rounded down, never a false 100%), and the output', () => {
    expect(tokenLine({ tokens: 2_808_600_000, cached: 2_758_900_000, output: 6_600_000 })).toBe('2.8B tok · 98% cache reads · 6.6M output')
    expect(tokenLine({ tokens: 1000, cached: 999, output: 1 })).toBe('1k tok · 99% cache reads · 1 output')
    expect(tokenLine({ tokens: 0, cached: 0, output: 0 })).toBe('0 tok')
  })

  test('status line counts live working and blocked; nothing live clears it', () => {
    expect(statusLine([node({ status: 'working' }), node({ status: 'working' }), node({ status: 'blocked' }), node({ status: 'done' })])).toBe('tree 2● 1!')
    expect(statusLine([node({ status: 'idle' })])).toBe('tree 0●')
    expect(statusLine([node({ status: 'gone' }), node({ status: 'done' })])).toBeUndefined()
  })

  test('status line: dings that need you are counted after the tree, and alone when nothing is live', () => {
    expect(statusLine([node({ status: 'working' }), node({ status: 'blocked' })], 2)).toBe('tree 1● 1! · 2 need you')
    expect(statusLine([node({ status: 'done' })], 1)).toBe('1 needs you')
    expect(statusLine([node({ status: 'working' })], 0)).toBe('tree 1●')
  })

  test("a ding's age: seconds, then whole minutes, hours, days", () => {
    expect(ageText(0)).toBe('0s')
    expect(ageText(59_999)).toBe('59s')
    expect(ageText(60_000)).toBe('1m')
    expect(ageText(3_599_999)).toBe('59m')
    expect(ageText(3_600_000)).toBe('1h')
    expect(ageText(86_400_000 * 2 + 5)).toBe('2d')
    // A clock that stepped back is not a negative age.
    expect(ageText(-5000)).toBe('0s')
  })

  test('context percent', () => {
    expect(ctxPercent(use({ contextTokens: 410_000 }))).toBe(41)
    expect(ctxPercent(use({ model: 'gpt-6.1-sol', contextTokens: 100_705, window: 828_400 }))).toBe(12)
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

  test('model label: family and effort; a codex model as codex names it', () => {
    expect(modelLabel(use({ effort: 'high' }))).toBe('Opus 5.5·high')
    expect(modelLabel(use({ model: 'claude-sonnet-5-5' }))).toBe('Sonnet 5.5')
    expect(modelLabel(use({ model: 'gpt-6.1-sol', effort: 'high' }))).toBe('gpt-6.1-sol·high')
    expect(modelLabel(null)).toBe('')
  })

  test('cost: an estimate where a price is known, blank where it is not', () => {
    expect(costText(use({ costUsd: 12.345 }))).toBe('≈$12.3')
    expect(costText(use({ model: 'gpt-6.1-sol', costUsd: null }))).toBe('')
    expect(costText(null)).toBe('')
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
    const u = use({ effort: 'high', costUsd: 12.345 })
    const cols = rowColumns([node({ name: 'lead', depth: 0 }), node({ name: 'reviewer', depth: 1, harness: 'opencode', usage: u })], 30)
    expect(cols).toEqual({ name: 10, harness: 8, model: 13, cost: 6 })
    expect(rowColumns([node({ name: 'x'.repeat(80) })], 30).name).toBe(30)
    expect(rowColumns([], 30)).toEqual({ name: 0, harness: 0, model: 0, cost: 0 })
  })
})
