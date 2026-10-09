import { describe, expect, test } from 'claude-code/testing'

import { edgeAt, edgeFileName, ledgerDir, makeEdge, parseEdge } from './ledger'

const child = { pane: 'wCK:p8', name: 'udci-i156-impl', harness: 'pi', status: 'working' as const, title: '', label: '', cwd: '/w', workspace: 'wCK', session: 's', terminal: 't' }

describe('ledger', () => {
  test('dir under HOME', () => {
    expect(ledgerDir('/Users/me')).toBe('/Users/me/.local/state/agent-tree/edges')
  })

  test('file name: time first, pane id made filename-safe, and edgeAt reads it back', () => {
    const e = makeEdge('w9:p1A', 'sess', child, 1791486939969)
    expect(edgeFileName(e)).toBe('1791486939969-wCK_p8.json')
    expect(edgeAt('1791486939969-wCK_p8.json')).toBe(1791486939969)
    expect(Number.isNaN(edgeAt('notes.txt'))).toBe(true)
  })

  test('makeEdge then parseEdge round-trips', () => {
    const e = makeEdge('w9:p1A', 'sess', child, 5)
    expect(e).toEqual({ v: 1, parent: 'w9:p1A', parentSession: 'sess', child: 'wCK:p8', name: 'udci-i156-impl', via: 'claude-mod', at: 5 })
    expect(parseEdge(JSON.stringify(e))).toEqual(e)
  })

  test('parseEdge refuses other versions, missing fields and junk', () => {
    expect(parseEdge('{"v":2,"parent":"a","child":"b","at":1}')).toBeNull()
    expect(parseEdge('{"v":1,"parent":"a","at":1}')).toBeNull()
    expect(parseEdge('}{')).toBeNull()
    expect(parseEdge('{"v":1,"parent":"a","child":"b","at":1}')).toEqual({ v: 1, parent: 'a', parentSession: '', child: 'b', name: '', via: '', at: 1 })
  })
})
