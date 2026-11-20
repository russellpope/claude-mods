import { describe, expect, test } from 'claude-code/testing'

import type { Ding, HerdrAgent, Snapshot, TreeNode, Usage } from '../types'
import type { Pace } from './pace'
import { teamStatusText } from './status'

const MIN = 60_000
const node = (over: Partial<TreeNode>): TreeNode => ({
  pane: 'p', parent: 'R', depth: 0, isLast: false, name: 'n', harness: 'claude', role: 'other', status: 'working',
  title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '', ...over,
})
const use = (over: Partial<Usage>): Usage => ({ model: 'claude-opus-5-5', effort: 'high', contextTokens: 120_000, window: 0, tokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, ...over })
const ag = (pane: string, over: Partial<HerdrAgent> = {}): HerdrAgent => ({ pane, name: pane, harness: 'claude', status: 'idle', title: '', label: '', cwd: '/w', workspace: '', session: '', terminal: '', ...over })
const snap = (over: Partial<Snapshot>): Snapshot => ({ at: 100 * MIN, root: 'R', nodes: [], all: [], repos: {}, batch: null, error: '', ...over })
const ding = (over: Partial<Ding>): Ding => ({ at: 0, pane: 'p', terminal: '', name: 'n', kind: 'finished', title: '', why: '', needsYou: true, isOpen: true, ...over })

const LEAD = node({ pane: 'w1:p2', name: 'i701-lead', role: 'lead', depth: 0, status: 'working', usage: use({}), ticket: 'I701', startedAt: 0, lastSeen: 65 * MIN })
const IMPL = node({
  pane: 'w1:p3', name: 'i702-impl', role: 'implementer', depth: 1, status: 'idle', ticket: 'I702', startedAt: 10 * MIN, lastSeen: 15 * MIN,
  usage: use({ model: 'claude-sonnet-5-5', contextTokens: 50_000, was: { model: 'claude-opus-5-5', effort: 'high', at: 0 } }),
  apiError: { reason: 'server_error', status: 529, at: 0 },
})
const REV = node({ pane: 'w1:p4', name: 'i702-review', role: 'reviewer', depth: 1, isLast: true, status: 'done', title: 'DONE: approved', startedAt: 20 * MIN, lastSeen: 30 * MIN, harness: 'codex' })

describe('teamStatusText', () => {
  test('a header with the counts, the dings that need you and the batch with its ETA; then one line per node in tree order', () => {
    const pace: Pace = { stamp: 'b1', firstSeen: 0, high: 3, closes: [20 * MIN, 40 * MIN] }
    const text = teamStatusText({
      snap: snap({ at: 50 * MIN, nodes: [LEAD, IMPL, REV], batch: { stamp: 'b1', fixed: 3, inProgress: 2, open: 5, total: 10 } }),
      dings: [ding({ pane: 'w1:p4', name: 'i702-review' }), ding({ pane: 'w1:p9', name: 'acked', isOpen: false })],
      pace: [pace],
      scope: 'tree',
    })
    expect(text.split('\n')).toEqual([
      '1 working · 1 errored · 1 finished · 1 needs you: i702-review · batch b1 3/10 fixed · 2 in progress · ~2h 20m left',
      'i701-lead · lead · working · I701 · Opus 5.5·high · ctx 12% · 1:05:00 in tree · pane w1:p2',
      '  i702-impl · implementer · idle · API error: server_error (529) · I702 · Sonnet 5.5·high (was Opus 5.5·high) · ctx 5% · 5:00 in tree · pane w1:p3',
      '  i702-review · reviewer · done · 10:00 in tree · DONE: approved · pane w1:p4',
    ])
  })

  test('no batch: no batch part; a batch with too few closes: no ETA', () => {
    expect(teamStatusText({ snap: snap({ nodes: [LEAD] }), dings: [], pace: [], scope: 'tree' }).split('\n')[0]).toBe('1 working')
    const few = teamStatusText({ snap: snap({ nodes: [LEAD], batch: { stamp: 'b1', fixed: 1, inProgress: 1, open: 8, total: 10 } }), dings: [], pace: [{ stamp: 'b1', firstSeen: 0, high: 1, closes: [MIN] }], scope: 'tree' })
    expect(few.split('\n')[0]).toBe('1 working · batch b1 1/10 fixed · 1 in progress')
  })

  test('a BLOCKED: title is reported; any other title is not', () => {
    const text = teamStatusText({ snap: snap({ nodes: [node({ name: 'a', status: 'blocked', title: 'BLOCKED: needs a key' }), node({ name: 'b', status: 'idle', title: 'some shell title' })] }), dings: [], pace: [], scope: 'tree' })
    expect(text).toMatch(/a · other · blocked · .* · BLOCKED: needs a key · pane p/)
    expect(text).not.toMatch(/some shell title/)
  })

  test('nothing spawned: one line', () => {
    expect(teamStatusText({ snap: snap({}), dings: [], pace: [], scope: 'tree' })).toBe('No workers spawned from this session yet.')
  })

  test('the multiplexer not answering is said first, with the age of the last state known (fix r1 M3)', () => {
    const text = teamStatusText({ snap: snap({ nodes: [LEAD], error: 'herdr is not answering.', seenAt: 100 * MIN - 40_000 }), dings: [], pace: [], scope: 'tree' })
    expect(text.split('\n').slice(0, 2)).toEqual(['herdr is not answering. Last state seen 40s ago:', '1 working'])
    const never = teamStatusText({ snap: snap({ error: 'herdr is not answering.' }), dings: [], pace: [], scope: 'tree' })
    expect(never).toBe('herdr is not answering. No state seen yet.')
  })

  test('a snapshot kept from before seenAt was kept: state of unknown age', () => {
    const text = teamStatusText({ snap: snap({ nodes: [LEAD], error: 'Rex is not answering.' }), dings: [], pace: [], scope: 'tree' })
    expect(text.split('\n')[0]).toBe('Rex is not answering. Last state seen at an unknown time:')
  })

  test('scope all: every listed agent, grouped by repo as the All view groups them', () => {
    const all = [ag('w1:p2', { name: 'x-lead', cwd: '/wt/kintsugi-a', status: 'working' }), ag('w2:p1', { name: 'solo', cwd: '/p/praxis', title: 'DONE: shipped', status: 'done', harness: 'codex' })]
    const text = teamStatusText({ snap: snap({ nodes: [LEAD], all, repos: { '/wt/kintsugi-a': '/p/kintsugi' } }), dings: [], pace: [], scope: 'all' })
    expect(text.split('\n')).toEqual(['1 working · 2 agents listed', 'kintsugi', '  x-lead · claude · working · pane w1:p2', 'praxis', '  solo · codex · done · DONE: shipped · pane w2:p1'])
  })
})
