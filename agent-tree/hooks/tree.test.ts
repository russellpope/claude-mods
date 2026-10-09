import { describe, expect, test } from 'claude-code/testing'

import type { Edge, HerdrAgent, TreeNode } from '../types'
import { edgeFileName } from './ledger'
import { buildTree, partition, roleOf, statusOf } from './tree'

const ag = (pane: string, over: Partial<HerdrAgent> = {}): HerdrAgent => ({
  pane,
  name: `n-${pane}`,
  harness: 'claude',
  status: 'working',
  title: '',
  label: '',
  cwd: '/w',
  workspace: 'w1',
  session: `s-${pane}`,
  terminal: `t-${pane}`,
  ...over,
})
const edge = (parent: string, child: string, at: number, name = `n-${child}`): Edge => ({ v: 1, parent, parentSession: '', child, name, via: 'claude-mod', at })
const build = (edges: Edge[], agents: HerdrAgent[], bindings: Record<string, string> = {}, previous: TreeNode[] = []) =>
  buildTree({ root: 'R', edges, agents, bindings, previous, at: 1000 })

describe('roleOf', () => {
  test('slot names from the team skills', () => {
    expect(roleOf('kintsugi-vhvf-lead')).toBe('lead')
    expect(roleOf('udci-i156-impl')).toBe('implementer')
    expect(roleOf('demo-implementer-2')).toBe('implementer')
    expect(roleOf('m5r-review')).toBe('reviewer')
    expect(roleOf('deepthought-i356-reviewer')).toBe('reviewer')
    expect(roleOf('udci-i172-fixer-r2')).toBe('fixer')
    expect(roleOf('m5c-w2-i062-fix3')).toBe('fixer')
    expect(roleOf('splash-res')).toBe('research')
    expect(roleOf('batch-integrator')).toBe('integrator')
    expect(roleOf('m5r-t1')).toBe('other')
    expect(roleOf('leader-board')).toBe('other')
  })
})

describe('statusOf', () => {
  test('blocked, then a BLOCKED: title, then working, then a DONE: title; working beats an old DONE title', () => {
    expect(statusOf(null)).toBe('gone')
    expect(statusOf(ag('a', { status: 'blocked' }))).toBe('blocked')
    expect(statusOf(ag('a', { status: 'working', title: 'DONE: old' }))).toBe('working')
    expect(statusOf(ag('a', { status: 'idle', title: 'DONE: merged' }))).toBe('done')
    expect(statusOf(ag('a', { status: 'idle', title: 'BLOCKED: owner call' }))).toBe('blocked')
    expect(statusOf(ag('a', { status: 'unknown' }))).toBe('idle')
  })

  test("herdr's done only means a turn ended: the worker is idle, or still blocked", () => {
    expect(statusOf(ag('a', { status: 'done' }))).toBe('idle')
    expect(statusOf(ag('a', { status: 'done', title: 'BLOCKED: nxom ask_owner' }))).toBe('blocked')
    expect(statusOf(ag('a', { status: 'done', title: 'DONE: merged' }))).toBe('done')
  })
})

describe('buildTree', () => {
  test('root → lead → workers, pre-order with depth and last-sibling marks', () => {
    const edges = [edge('R', 'L', 1), edge('L', 'W1', 2), edge('L', 'W2', 3), edge('X', 'Y', 4)]
    const { nodes } = build(edges, [ag('L'), ag('W1'), ag('W2'), ag('Y')])
    expect(nodes.map(n => [n.pane, n.depth, n.isLast])).toEqual([
      ['L', 0, true],
      ['W1', 1, false],
      ['W2', 1, true],
    ])
    expect(nodes[0]?.startedAt).toBe(1)
    expect(nodes[0]?.lastSeen).toBe(1000)
  })

  test('binds each edge to the terminal it first saw', () => {
    const e = edge('R', 'L', 1)
    const { bindings } = build([e], [ag('L')])
    expect(bindings).toEqual({ [edgeFileName(e)]: 't-L' })
  })

  test('a pane closed since: gone, keeping its last numbers', () => {
    const e = edge('R', 'L', 1)
    const prev = build([e], [ag('L', { title: 'BLOCKED: x' })]).nodes.map(n => ({ ...n, usage: { model: 'claude-opus-5-5', effort: 'high', contextTokens: 9, tokens: 99, costUsd: 1.5 }, lastSeen: 500 }))
    const { nodes } = build([e], [], { [edgeFileName(e)]: 't-L' }, prev)
    expect(nodes[0]).toMatchObject({ pane: 'L', status: 'gone', title: 'BLOCKED: x', lastSeen: 500, usage: { costUsd: 1.5 } })
  })

  test('a pane id reused by a new terminal is not adopted', () => {
    const e = edge('R', 'L', 1)
    const { nodes } = build([e], [ag('L', { terminal: 't-new' })], { [edgeFileName(e)]: 't-L' })
    expect(nodes[0]?.status).toBe('gone')
  })

  test('the newest edge owns a reused pane; the old lead does not inherit it', () => {
    const old = edge('R', 'L', 1, 'old-lead')
    const fresh = edge('R', 'L', 5, 'new-lead')
    const { nodes } = build([old, fresh], [ag('L', { name: 'new-lead' })])
    expect(nodes.map(n => [n.name, n.status])).toEqual([
      ['old-lead', 'gone'],
      ['new-lead', 'working'],
    ])
  })

  test('children belong to the incarnation that spawned them', () => {
    const edges = [edge('R', 'L', 1, 'old-lead'), edge('L', 'A', 2), edge('R', 'L', 5, 'new-lead'), edge('L', 'B', 6)]
    const { nodes } = build(edges, [ag('L', { name: 'new-lead' }), ag('A'), ag('B')])
    expect(nodes.map(n => [n.name, n.depth])).toEqual([
      ['old-lead', 0],
      ['n-A', 1],
      ['new-lead', 0],
      ['n-B', 1],
    ])
  })

  test('a cycle stops', () => {
    const { nodes } = build([edge('R', 'A', 1), edge('A', 'B', 2), edge('B', 'A', 3)], [ag('A'), ag('B')])
    expect(nodes.map(n => n.pane)).toEqual(['A', 'B'])
  })
})

describe('partition', () => {
  test('finished = done or gone with nothing live below; a lead with live workers stays in the tree', () => {
    const edges = [edge('R', 'L', 1), edge('L', 'W1', 2), edge('R', 'D', 3)]
    const { nodes } = build(edges, [ag('L', { status: 'idle', title: 'DONE: x' }), ag('W1'), ag('D', { status: 'done', title: 'DONE: shipped' })])
    const { tree, finished } = partition(nodes)
    expect(tree.map(n => n.pane)).toEqual(['L', 'W1'])
    expect(finished.map(n => n.pane)).toEqual(['D'])
  })
})

describe('workspace inference (a lead without the mod still shows its workers)', () => {
  // Root w9:pR spawned lead wZ:p1 into its own team workspace wZ; the lead's session records nothing.
  const lead = edge('w9:pR', 'wZ:p1', 1, 'y1zu-lead')
  const inWs = (pane: string, over: Partial<HerdrAgent> = {}) => ag(pane, { workspace: pane.split(':')[0], ...over })
  const buildAt = (edges: Edge[], agents: HerdrAgent[], previous: TreeNode[] = [], at = 1000) =>
    buildTree({ root: 'w9:pR', edges, agents, bindings: {}, previous, at })

  test("an unrecorded agent in a live lead's workspace is that lead's child, marked inferred", () => {
    const agents = [inWs('w9:pR'), inWs('w9:p2'), inWs('wZ:p1', { name: 'y1zu-lead' }), inWs('wZ:p3', { name: 'y1zu-reviewer', harness: 'codex' })]
    const { nodes } = buildAt([lead], agents)
    expect(nodes.map(n => [n.pane, n.depth, n.isLast, n.inferred ?? false, n.role])).toEqual([
      ['wZ:p1', 0, true, false, 'lead'],
      ['wZ:p3', 1, true, true, 'reviewer'],
    ])
    expect(nodes[1]).toMatchObject({ parent: 'wZ:p1', harness: 'codex', status: 'working', startedAt: 1000, lastSeen: 1000 })
  })

  test("the root's own workspace is never mined", () => {
    const split = edge('w9:pR', 'w9:p5', 1)
    const { nodes } = buildAt([split], [inWs('w9:pR'), inWs('w9:p5'), inWs('w9:p2'), inWs('w9:p3')])
    expect(nodes.map(n => n.pane)).toEqual(['w9:p5'])
  })

  test('an agent an edge already holds is not adopted a second time', () => {
    const worker = edge('wZ:p1', 'wZ:p2', 2)
    const { nodes } = buildAt([lead, worker], [inWs('wZ:p1'), inWs('wZ:p2'), inWs('wZ:p3')])
    expect(nodes.map(n => [n.pane, n.depth, n.isLast, n.inferred ?? false])).toEqual([
      ['wZ:p1', 0, true, false],
      ['wZ:p2', 1, false, false],
      ['wZ:p3', 1, true, true],
    ])
  })

  test('a lead that is gone adopts nothing new', () => {
    const { nodes } = buildAt([lead], [inWs('wZ:p3')])
    expect(nodes.map(n => n.pane)).toEqual(['wZ:p1'])
  })

  test('an inferred worker keeps its first-seen start, and goes to gone when it leaves', () => {
    const agents = [inWs('wZ:p1'), inWs('wZ:p3')]
    const first = buildAt([lead], agents, [], 500).nodes
    const again = buildAt([lead], agents, first, 900).nodes
    expect(again[1]).toMatchObject({ pane: 'wZ:p3', startedAt: 500, lastSeen: 900, status: 'working' })
    const left = buildAt([lead], [inWs('wZ:p1')], again, 1200).nodes
    expect(left[1]).toMatchObject({ pane: 'wZ:p3', startedAt: 500, lastSeen: 900, status: 'gone', inferred: true })
    expect(partition(left).finished.map(n => n.pane)).toEqual(['wZ:p3'])
  })

  test('a new occupant of the same pane (new terminal) is a new row; the old one is gone', () => {
    const first = buildAt([lead], [inWs('wZ:p1'), inWs('wZ:p4', { name: 'nxom-reviewer', terminal: 't-old' })], [], 500).nodes
    const { nodes } = buildAt([lead], [inWs('wZ:p1'), inWs('wZ:p4', { name: 'nxom-final-reviewer', terminal: 't-new' })], first, 900)
    expect(nodes.map(n => [n.name, n.status, n.startedAt, n.isLast])).toEqual([
      ['n-wZ:p1', 'working', 1, true],
      ['nxom-reviewer', 'gone', 500, false],
      ['nxom-final-reviewer', 'working', 900, true],
    ])
  })
})
