import { describe, expect, test } from 'claude-code/testing'

import { globList } from './globs'
import { defaultBranchOf, isFresh, parseBranches, parseStatus, parseWorktrees, shipLine, shipOf, shipStatus } from './ship'

// Captured by hand from real repos (git 2.56.1): the claude-mods main checkout, and scratch repos with
// a gone upstream, a detached worktree and no commits.
const STATUS_MAIN = [
  '# branch.oid 1cbf281a121664c3da763a6a0c27cb8ee40653cf',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +4 -1',
  '1 .M N... 100644 100644 100644 aaaa bbbb hooks/register.tsx',
  '? d.txt',
  '',
].join('\n')
const STATUS_CLEAN = '# branch.oid 1cbf\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n'
const STATUS_DETACHED = '# branch.oid 1f108a01524931c3a64b2ff08dbbc8ed7f553baf\n# branch.head (detached)\n'
const STATUS_INITIAL = '# branch.oid (initial)\n# branch.head main\n? a\n'
const STATUS_GONE = '# branch.oid 087becaa\n# branch.head gone\n# branch.upstream origin/gone\n? d.txt\n'
const STATUS_NO_UPSTREAM = '# branch.oid 087becaa\n# branch.head feature\n'

const BRANCHES = [
  'gone\torigin/gone\t[gone]',
  'local-only\t\t',
  'main\torigin/main\t[ahead 1]',
  'master\torigin/main\t',
  'merged-br\t\t',
  'both\torigin/both\t[ahead 2, behind 3]',
  'behind\torigin/behind\t[behind 5]',
  '',
].join('\n')

const WORKTREES = [
  'worktree /w/repo', 'HEAD 1f10', 'branch refs/heads/main', '',
  'worktree /w/wt-detached', 'HEAD 1f10', 'detached', '',
  'worktree /w/wt-merged', 'HEAD 087b', 'branch refs/heads/merged-br', '',
  'worktree /w/wt-local', 'HEAD 9999', 'branch refs/heads/local-only', 'locked', '',
].join('\n')

describe('parseStatus', () => {
  test('branch, ahead and behind, and one dirty file per entry line', () => {
    expect(parseStatus(STATUS_MAIN)).toEqual({ head: 'main', isDetached: false, isInitial: false, upstream: 'origin/main', ahead: 4, behind: 1, dirty: 2 })
  })

  test('a detached HEAD has no branch', () => {
    expect(parseStatus(STATUS_DETACHED)).toMatchObject({ head: undefined, isDetached: true, dirty: 0 })
  })

  test('a repo with no commits still has its branch', () => {
    expect(parseStatus(STATUS_INITIAL)).toMatchObject({ head: 'main', isInitial: true, dirty: 1, ahead: 0 })
  })

  test('a gone upstream prints no ahead/behind line; no upstream prints neither', () => {
    expect(parseStatus(STATUS_GONE)).toMatchObject({ head: 'gone', upstream: 'origin/gone', ahead: 0, behind: 0, dirty: 1 })
    expect(parseStatus(STATUS_NO_UPSTREAM)).toMatchObject({ head: 'feature', upstream: undefined })
  })

  test('output with no branch header is not a status', () => {
    expect(parseStatus('')).toBeUndefined()
    expect(parseStatus('fatal: not a git repository\n')).toBeUndefined()
  })
})

describe('parseBranches', () => {
  test('upstream, ahead, behind and gone from for-each-ref', () => {
    expect(parseBranches(BRANCHES)).toEqual([
      { name: 'gone', upstream: 'origin/gone', ahead: 0, behind: 0, isGone: true },
      { name: 'local-only', upstream: undefined, ahead: 0, behind: 0, isGone: false },
      { name: 'main', upstream: 'origin/main', ahead: 1, behind: 0, isGone: false },
      { name: 'master', upstream: 'origin/main', ahead: 0, behind: 0, isGone: false },
      { name: 'merged-br', upstream: undefined, ahead: 0, behind: 0, isGone: false },
      { name: 'both', upstream: 'origin/both', ahead: 2, behind: 3, isGone: false },
      { name: 'behind', upstream: 'origin/behind', ahead: 0, behind: 5, isGone: false },
    ])
  })

  test('a repo with no commits lists no branches', () => {
    expect(parseBranches('')).toEqual([])
  })
})

describe('parseWorktrees', () => {
  test('each block is a path and its branch; a detached one has none', () => {
    expect(parseWorktrees(WORKTREES)).toEqual([
      { path: '/w/repo', branch: 'main' },
      { path: '/w/wt-detached', branch: undefined },
      { path: '/w/wt-merged', branch: 'merged-br' },
      { path: '/w/wt-local', branch: 'local-only' },
    ])
  })

  test('a repo with no commits lists itself on its unborn branch', () => {
    expect(parseWorktrees('worktree /w/empty\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/main\n\n'))
      .toEqual([{ path: '/w/empty', branch: 'main' }])
  })
})

describe('defaultBranchOf', () => {
  test("origin's HEAD names it, then init.defaultBranch, then main, then master", () => {
    expect(defaultBranchOf('origin/trunk\n', 'develop\n', ['main', 'trunk', 'develop'])).toEqual({ name: 'trunk', ref: 'trunk' })
    expect(defaultBranchOf('', 'develop\n', ['main', 'develop'])).toEqual({ name: 'develop', ref: 'develop' })
    expect(defaultBranchOf('', 'develop\n', ['main'])).toEqual({ name: 'main', ref: 'main' })
    expect(defaultBranchOf('', '', ['master', 'x'])).toEqual({ name: 'master', ref: 'master' })
    expect(defaultBranchOf('', '', ['main', 'master'])).toEqual({ name: 'main', ref: 'main' })
    expect(defaultBranchOf('', '', ['x'])).toBeUndefined()
  })

  test("with no local copy of origin's default, merges are judged against origin's", () => {
    expect(defaultBranchOf('origin/trunk\n', '', ['feature'])).toEqual({ name: 'trunk', ref: 'origin/trunk' })
    expect(defaultBranchOf('upstream/dev\n', '', [])).toEqual({ name: 'dev', ref: 'upstream/dev' })
  })
})

describe('isFresh', () => {
  test('a reflog holding only its creation entry is a fresh branch; more, or none, is not', () => {
    expect(isFresh('branch: Created from main\n')).toBe(true)
    expect(isFresh('commit: x\nbranch: Created from main\n')).toBe(false)
    expect(isFresh('commit (initial): one\n')).toBe(false)
    expect(isFresh('')).toBe(false)
  })
})

const ship = (status: string, ignore = '') => shipOf({
  status: parseStatus(status)!,
  branches: parseBranches(BRANCHES),
  merged: ['main', 'master', 'merged-br', 'behind'],
  worktrees: parseWorktrees(WORKTREES),
  defaultBranch: 'main',
  fresh: [],
  ignore: globList(ignore),
})

describe('shipOf', () => {
  test('unpushed: ahead of upstream, or no or gone upstream and not merged into the default branch', () => {
    expect(ship(STATUS_MAIN).unpushed).toEqual([
      { name: 'gone', ahead: 0, why: 'gone' },
      { name: 'local-only', ahead: 0, why: 'none' },
      { name: 'both', ahead: 2, why: 'ahead' },
    ])
  })

  test('the current branch is left out when the line already shows its ahead count', () => {
    expect(ship(STATUS_MAIN).unpushed.map(b => b.name)).not.toContain('main')
    expect(ship(STATUS_GONE).unpushed.map(b => b.name)).toContain('gone')
    const feature = shipOf({ status: parseStatus(STATUS_NO_UPSTREAM)!, branches: parseBranches('feature\t\t\nmain\torigin/main\t\n'), merged: ['main'], worktrees: [], defaultBranch: 'main', fresh: [], ignore: [] })
    expect(feature.unpushed).toEqual([{ name: 'feature', ahead: 0, why: 'none' }])
  })

  test('a fresh branch, merged by ancestry but never committed to, is not a merged worktree', () => {
    const fresh = shipOf({ status: parseStatus(STATUS_MAIN)!, branches: parseBranches(BRANCHES), merged: ['main', 'master', 'merged-br', 'behind'], worktrees: parseWorktrees(WORKTREES), defaultBranch: 'main', fresh: ['merged-br'], ignore: [] })
    expect(fresh.merged).toEqual([])
  })

  test('merged worktrees: a branch merged into the default, the main checkout and detached ones left out', () => {
    expect(ship(STATUS_MAIN).merged).toEqual([{ branch: 'merged-br', path: '/w/wt-merged' }])
  })

  test('shipIgnore drops branches from the unpushed count and their worktrees from the merged count', () => {
    const ignored = ship(STATUS_MAIN, 'local-*, merged-?r, gone')
    expect(ignored.unpushed.map(b => b.name)).toEqual(['both'])
    expect(ignored.merged).toEqual([])
  })

  test('without a default branch nothing counts as merged, so no-upstream branches count', () => {
    const none = shipOf({ status: parseStatus(STATUS_MAIN)!, branches: parseBranches('a\t\t\n'), merged: [], worktrees: parseWorktrees(WORKTREES), defaultBranch: undefined, fresh: [], ignore: [] })
    expect(none.unpushed.map(b => b.name)).toEqual(['a'])
    expect(none.merged).toEqual([])
  })
})

const clean = (over: Partial<ReturnType<typeof ship>> = {}) => ({ ...ship(STATUS_CLEAN), unpushed: [], merged: [], ...over })

describe('shipLine', () => {
  test('counts that are zero are left out', () => {
    expect(shipLine(ship(STATUS_MAIN))).toBe('main ↑4 ↓1 · 2 dirty · 3 unpushed · 1 merged worktree')
    expect(shipLine(clean({ dirty: 3, merged: [{ branch: 'a', path: '/a' }, { branch: 'b', path: '/b' }] }))).toBe('main · 3 dirty · 2 merged worktrees')
  })

  test('all zero reads as a plain positive', () => {
    expect(shipLine(clean())).toBe('main · committed and pushed')
    expect(shipLine(clean({ behind: 2 }))).toBe('main ↓2 · committed and pushed')
  })

  test('a detached HEAD and a repo with no commits say so', () => {
    expect(shipLine(shipOf({ status: parseStatus(STATUS_DETACHED)!, branches: [], merged: [], worktrees: [], defaultBranch: undefined, fresh: [], ignore: [] })))
      .toBe('detached HEAD · committed and pushed')
    expect(shipLine(shipOf({ status: parseStatus(STATUS_INITIAL)!, branches: [], merged: [], worktrees: [], defaultBranch: undefined, fresh: [], ignore: [] })))
      .toBe('main, no commits · 1 dirty')
  })
})

describe('shipStatus', () => {
  test('a short line only while something is unshipped; behind alone is not', () => {
    expect(shipStatus(ship(STATUS_MAIN))).toBe(' main ↑4 ↓1 · 2 dirty · 3 unpushed · 1 merged')
    expect(shipStatus(clean())).toBeUndefined()
    expect(shipStatus(clean({ behind: 3 }))).toBeUndefined()
    expect(shipStatus(undefined)).toBeUndefined()
  })
})
