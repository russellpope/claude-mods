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
