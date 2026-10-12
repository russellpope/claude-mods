import { describe, expect, test } from 'claude-code/testing'

import { TICKET_GREP_ARGV, batchCounts, batchStamp, parseTicketGrep, repoFromCommonDir, repoName, ticketFor } from './tickets'

const GREP = [
  '/r/docs/issues/I001-a.md:id: I001',
  '/r/docs/issues/I001-a.md:status: in-progress',
  '/r/docs/issues/I001-a.md:batch: "2026-10-08-hne7#1"',
  '/r/docs/issues/I001-a.md:workspace: /Users/me/worktrees/r-i001/',
  '/r/docs/issues/I001-a.md:status: body text that also starts with status',
  '/r/docs/issues/I002-b.md:id: I002',
  '/r/docs/issues/I002-b.md:status: fixed',
  '/r/docs/issues/I002-b.md:batch: 2026-10-08-hne7#2',
  '/r/docs/issues/I003-c.md:id: I003',
  '/r/docs/issues/I003-c.md:status: open',
  '/r/docs/issues/I003-c.md:batch: 2026-10-08-hne7#3',
  '/r/docs/issues/I004-d.md:id: I004',
  '/r/docs/issues/I004-d.md:status: open',
  '/r/docs/issues/_template.md:status: open',
].join('\n')

describe('tickets', () => {
  test('first value of each key wins; quotes stripped; files without an id dropped', () => {
    const t = parseTicketGrep(GREP)
    expect(t.map(x => x.id)).toEqual(['I001', 'I002', 'I003', 'I004'])
    expect(t[0]).toEqual({ file: '/r/docs/issues/I001-a.md', id: 'I001', status: 'in-progress', batch: '2026-10-08-hne7#1', workspace: '/Users/me/worktrees/r-i001/' })
  })

  test('a worker finds its ticket by workspace, trailing slash or not', () => {
    const t = parseTicketGrep(GREP)
    expect(ticketFor(t, '/Users/me/worktrees/r-i001')?.id).toBe('I001')
    expect(ticketFor(t, '/elsewhere')).toBeNull()
  })

  test('batch counts by stamp', () => {
    const t = parseTicketGrep(GREP)
    expect(batchStamp('2026-10-08-hne7#3')).toBe('2026-10-08-hne7')
    expect(batchCounts(t, '2026-10-08-hne7')).toEqual({ stamp: '2026-10-08-hne7', fixed: 1, inProgress: 1, open: 1, total: 3 })
  })

  test('grep argv reads only the four keys', () => {
    expect(TICKET_GREP_ARGV('/r/docs/issues')).toEqual(['grep', '-rH', '-E', '^(id|status|batch|workspace):', '--include=*.md', '/r/docs/issues'])
  })
})

describe('repos', () => {
  test('main repo from git common dir; worktrees fold in', () => {
    expect(repoFromCommonDir('/Users/me/p/kintsugi/.git\n', '/Users/me/worktrees/kintsugi-vhvf')).toBe('/Users/me/p/kintsugi')
    expect(repoFromCommonDir('', '/tmp/x')).toBe('/tmp/x')
    expect(repoName('/Users/me/p/kintsugi')).toBe('kintsugi')
  })
})
