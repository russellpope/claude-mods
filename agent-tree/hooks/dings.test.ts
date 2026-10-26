import { describe, expect, test } from 'claude-code/testing'

import type { AgentStatus, Ding, Edge, HerdrAgent, TreeNode } from '../types'
import { ackAll, addDings, findDings, markSeen, nameDings, parentsOf, settleDings } from './dings'

const ag = (pane: string, status: AgentStatus, over: Partial<HerdrAgent> = {}): HerdrAgent => ({
  pane, name: pane, harness: 'claude', status, title: '', label: '', cwd: '', workspace: pane.split(':')[0] ?? '', session: '', terminal: `t-${pane}`, ...over,
})
const ding = (pane: string, at: number, over: Partial<Ding> = {}): Ding => ({
  at, pane, terminal: `t-${pane}`, name: pane, kind: 'finished', title: '', why: '', needsYou: true, isOpen: true, ...over,
})
const AT = 1_000_000

describe('findDings', () => {
  test('a turn ending in a background tab (working → done) is a finished ding, blocked is an asking ding, and nothing else dings', () => {
    const prev = [ag('wO:p1', 'working'), ag('wQ:p1', 'working'), ag('wB:p1', 'working'), ag('wS:p1', 'blocked'), ag('wT:p1', 'working', { terminal: 'old' })]
    const next = [
      ag('wO:p1', 'done'),
      // Ended in the tab you are looking at: herdr shows it as seen and plays nothing.
      ag('wQ:p1', 'idle'),
      ag('wB:p1', 'blocked'),
      // Still asking: it dinged when it started.
      ag('wS:p1', 'blocked'),
      // A new pane, and a new agent in an old pane: nothing to compare with.
      ag('wN:p1', 'done'),
      ag('wT:p1', 'done', { terminal: 'new' }),
    ]

    expect(findDings({ prev, prevAt: AT - 2000, next, at: AT, root: 'w9:p1', parents: {} }).map(d => [d.pane, d.kind])).toEqual([
      ['wO:p1', 'finished'],
      ['wB:p1', 'asking'],
    ])
  })

  test('who it needs: anyone asking, a top-level session, a lead once its title says DONE:, a worker once its lead has stopped', () => {
    // w9:p1 is this session. Leads wL, wM, wG and wK hang off it; their :p2 and :p3 are workers.
    const parents = { 'wL:p1': 'w9:p1', 'wL:p2': 'wL:p1', 'wM:p1': 'w9:p1', 'wM:p2': 'wM:p1', 'wM:p3': 'wM:p1', 'wG:p1': 'w9:p1', 'wG:p2': 'wG:p1', 'wK:p1': 'w9:p1' }
    const panes = ['wO:p1', 'wL:p1', 'wM:p1', 'wM:p2', 'wL:p2', 'wG:p2', 'wM:p3', 'wK:p1']
    const prev = panes.map(p => ag(p, 'working'))
    const next = [
      ag('wO:p1', 'done', { label: 'claude-mods session' }),
      ag('wL:p1', 'done', { title: 'DONE: land 3 green' }),
      ag('wM:p1', 'done', { name: 'lead-m' }),
      ag('wM:p2', 'done'),
      ag('wL:p2', 'done'),
      ag('wG:p2', 'done'),
      ag('wM:p3', 'blocked'),
      ag('wK:p1', 'done', { title: 'BLOCKED: pick the I576 scope' }),
    ]

    const found = findDings({ prev, prevAt: AT - 2000, next, at: AT, root: 'w9:p1', parents })

    expect(found.map(d => [d.pane, d.kind, d.needsYou, d.why])).toEqual([
      // Nobody spawned it: a session you drive, waiting on you.
      ['wO:p1', 'finished', true, ''],
      ['wL:p1', 'finished', true, ''],
      // A lead ends turns while it waits on its workers.
      ['wM:p1', 'finished', false, 'turn ended, not DONE:'],
      ['wM:p2', 'finished', false, 'lead-m still running'],
      // Its lead is DONE:, so nobody is left to read it.
      ['wL:p2', 'finished', true, ''],
      // Its lead's pane is gone.
      ['wG:p2', 'finished', true, ''],
      ['wM:p3', 'asking', true, ''],
      ['wK:p1', 'asking', true, ''],
    ])
    expect(found[0]).toEqual({ at: AT, pane: 'wO:p1', terminal: 't-wO:p1', name: 'wO:p1', kind: 'finished', title: 'claude-mods session', why: '', needsYou: true, isOpen: true })
    expect(found[1]).toMatchObject({ title: 'DONE: land 3 green', isOpen: true })
    expect(found[3]).toMatchObject({ needsYou: false, isOpen: false })
  })

  test('a stale baseline dings nothing: no list yet, or the last one more than 30 s old', () => {
    const prev = [ag('wO:p1', 'working')]
    const next = [ag('wO:p1', 'done')]

    expect(findDings({ prev, prevAt: 0, next, at: AT, root: 'w9:p1', parents: {} })).toEqual([])
    expect(findDings({ prev, prevAt: AT - 30_001, next, at: AT, root: 'w9:p1', parents: {} })).toEqual([])
    expect(findDings({ prev, prevAt: AT - 30_000, next, at: AT, root: 'w9:p1', parents: {} })).toHaveLength(1)
  })

  test('the session drawing the pane dings nothing for itself: you are already looking at it', () => {
    const prev = [ag('w9:pR', 'working'), ag('wO:p1', 'working')]
    const next = [ag('w9:pR', 'done'), ag('wO:p1', 'done')]

    expect(findDings({ prev, prevAt: AT - 2000, next, at: AT, root: 'w9:pR', parents: {} }).map(d => d.pane)).toEqual(['wO:p1'])
  })
})

describe('nameDings', () => {
  test('a ding from an agent herdr has no name for takes its tab label, as the tab bar shows it; else its pane', () => {
    const agents = [ag('w9:p1A', 'done', { name: '', tab: 'w9:t19' }), ag('wX:p1', 'done', { name: '', tab: 'wX:t9' })]
    const found = [ding('w9:p1A', AT, { name: '' }), ding('wX:p1', AT, { name: '' }), ding('wL:p1', AT, { name: 'lead-l' })]

    expect(nameDings(found, agents, { 'w9:t19': 'mods' }).map(d => d.name)).toEqual(['mods', 'wX:p1', 'lead-l'])
  })
})

describe('the ding log', () => {
  test("new dings go last, a pane's older open ding closes, and every open ding stays but only the newest 10 closed ones", () => {
    const old = [...Array.from({ length: 15 }, (_, i) => ding(`w${i}:p1`, i, { isOpen: false })), ding('wB:p1', 20), ding('wA:p1', 60)]
    const list = addDings(old, [ding('wA:p1', 70), ding('wZ:p1', 70, { needsYou: false, isOpen: false })])

    // Closed: w0–w14, wA:p1 at 60 (closed by its newer ding) and wZ:p1, 17 in all; w0–w6 go.
    expect(list.map(d => [d.pane, d.at, d.isOpen])).toEqual([
      ...[7, 8, 9, 10, 11, 12, 13, 14].map(i => [`w${i}:p1`, i, false]),
      ['wB:p1', 20, true],
      ['wA:p1', 60, false],
      ['wA:p1', 70, true],
      ['wZ:p1', 70, false],
    ])
  })

  test('a ding that settles itself joins the acknowledged ones, and the oldest of those goes past 10', () => {
    const list = [...Array.from({ length: 10 }, (_, i) => ding(`c${i}:p1`, i, { isOpen: false })), ding('wW:p1', 20)]

    const settled = settleDings(list, [ag('wW:p1', 'working')])

    expect(settled.map(d => d.pane)).toEqual(['c1:p1', 'c2:p1', 'c3:p1', 'c4:p1', 'c5:p1', 'c6:p1', 'c7:p1', 'c8:p1', 'c9:p1', 'wW:p1'])
    expect(settled.every(d => !d.isOpen)).toBe(true)
  })

  test('ack all closes every open ding', () => {
    const list = [ding('wA:p1', 1), ding('wB:p1', 2, { isOpen: false, needsYou: false }), ding('wC:p1', 3)]

    expect(ackAll(list).map(d => [d.pane, d.isOpen])).toEqual([
      ['wA:p1', false],
      ['wB:p1', false],
      ['wC:p1', false],
    ])
  })

  test('an open ding closes when its agent works again or leaves; one still waiting stays open', () => {
    const list = [ding('wW:p1', 1), ding('wX:p1', 2), ding('wY:p1', 3), ding('wR:p1', 4)]
    const agents = [ag('wW:p1', 'working'), ag('wY:p1', 'done'), ag('wR:p1', 'done', { terminal: 'someone-else' })]

    expect(settleDings(list, agents).map(d => [d.pane, d.isOpen])).toEqual([
      ['wW:p1', false],
      ['wX:p1', false],
      ['wY:p1', true],
      ['wR:p1', false],
    ])
  })

  test("pressing a pane's row closes that pane's open dings and no others", () => {
    const list = [ding('wA:p1', 1), ding('wB:p1', 2), ding('wA:p1', 3)]

    expect(markSeen(list, 'wA:p1').map(d => [d.pane, d.isOpen])).toEqual([
      ['wA:p1', false],
      ['wB:p1', true],
      ['wA:p1', false],
    ])
  })
})

describe('parentsOf', () => {
  const edge = (parent: string, child: string, at: number): Edge => ({ v: 1, parent, parentSession: '', child, name: child, via: 'claude-mod', at })
  const inferred = (pane: string, parent: string): TreeNode => ({
    pane, parent, depth: 1, isLast: true, name: pane, harness: 'codex', role: 'other', status: 'working', title: '', cwd: '', session: '', startedAt: 0, lastSeen: 0, usage: null, ticket: '', inferred: true,
  })

  test("every recorded spawn names its parent, a pane's newest spawn wins, and the tree's inferred workers count too", () => {
    const edges = [edge('wA:p1', 'wC:p1', 20), edge('w9:p1', 'wL:p1', 5), edge('wB:p1', 'wC:p1', 10)]

    expect(parentsOf(edges, [inferred('wL:p4', 'wL:p1')])).toEqual({ 'wC:p1': 'wA:p1', 'wL:p1': 'w9:p1', 'wL:p4': 'wL:p1' })
  })
})
