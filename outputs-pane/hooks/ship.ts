// Ship state: is this repository's work committed and pushed? Pure parsers of local git reads.
import type { Ship, UnpushedBranch } from '../types'

export type Status = {
  // The checked-out branch; undefined on a detached HEAD.
  head: string | undefined
  isDetached: boolean
  // No commits yet.
  isInitial: boolean
  upstream: string | undefined
  ahead: number
  behind: number
  // Entries git lists: changed, staged, unmerged and untracked files.
  dirty: number
}

export type Branch = { name: string; upstream: string | undefined; ahead: number; behind: number; isGone: boolean }
export type Worktree = { path: string; branch: string | undefined }

// `git status --porcelain=v2 --branch`: `# branch.*` headers, then one line per entry.
export const parseStatus = (text: string): Status | undefined => {
  const lines = text.split('\n').filter(Boolean)
  const header = (key: string) => lines.find(line => line.startsWith(`# branch.${key} `))?.slice(`# branch.${key} `.length)
  const head = header('head')
  if (head === undefined) return undefined
  const ab = header('ab')?.match(/^\+(\d+) -(\d+)$/)

  return {
    head: head === '(detached)' ? undefined : head,
    isDetached: head === '(detached)',
    isInitial: header('oid') === '(initial)',
    upstream: header('upstream'),
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
    dirty: lines.filter(line => !line.startsWith('#')).length,
  }
}

// `git for-each-ref --format=%(refname:short)%09%(upstream:short)%09%(upstream:track) refs/heads`.
export const parseBranches = (text: string): Branch[] =>
  text.split('\n').filter(Boolean).map(line => {
    const [name = '', upstream = '', track = ''] = line.split('\t')

    return {
      name,
      upstream: upstream || undefined,
      ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
      behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
      isGone: track === '[gone]',
    }
  })

// `git worktree list --porcelain`: blocks of `worktree <path>`, `HEAD <sha>`, then `branch refs/heads/<name>` or
// `detached`, with blank lines between. The first block is the main checkout.
export const parseWorktrees = (text: string): Worktree[] =>
  text.split('\n\n').map(block => block.split('\n')).flatMap(lines => {
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    const branch = lines.find(line => line.startsWith('branch '))?.slice('branch '.length).replace(/^refs\/heads\//, '')

    return path ? [{ path, branch }] : []
  })

// The default branch: what `git symbolic-ref --short refs/remotes/origin/HEAD` names (`origin/main`), else
// `git config --get init.defaultBranch` when a local branch has that name, else main, else master. `ref` is what
// merges are judged against: the local branch, or origin's when there is no local copy.
export const defaultBranchOf = (originHead: string, initDefault: string, local: readonly string[]) => {
  const remote = originHead.trim()
  const named = remote.replace(/^[^/]+\//, '')
  if (named) return { name: named, ref: local.includes(named) ? named : remote }
  const name = [initDefault.trim(), 'main', 'master'].find(one => one && local.includes(one))

  return name ? { name, ref: name } : undefined
}

// `git reflog show --format=%gs refs/heads/<branch>`, newest first: a branch whose only entry is its creation was
// never committed to, so being merged by ancestry says nothing about it.
export const isFresh = (reflog: string) => {
  const entries = reflog.split('\n').filter(Boolean)

  return entries.length === 1 && entries[0]!.startsWith('branch: Created')
}

export type ShipInput = {
  status: Status
  branches: Branch[]
  // Local branches merged into the default branch.
  merged: readonly string[]
  worktrees: Worktree[]
  defaultBranch: string | undefined
  // Branches whose reflog holds only their creation: not merged worktrees, whatever ancestry says.
  fresh: readonly string[]
  // shipIgnore: branches left out of both counts.
  ignore: readonly RegExp[]
}

// Unpushed: ahead of its upstream, or with none (or a gone one) and not merged into the default branch, whose
// commits exist nowhere else. The current branch is left out when the line shows its ahead count already.
// Merged worktrees: every worktree but the main checkout whose branch is merged and was committed to.
export const shipOf = ({ status, branches, merged, worktrees, defaultBranch, fresh, ignore }: ShipInput): Ship => {
  const isKept = (name: string) => !ignore.some(pattern => pattern.test(name)) && !(name === status.head && status.ahead > 0)
  const isMerged = (name: string) => defaultBranch !== undefined && merged.includes(name)

  return {
    branch: status.head ?? '',
    isDetached: status.isDetached,
    isInitial: status.isInitial,
    ahead: status.ahead,
    behind: status.behind,
    dirty: status.dirty,
    unpushed: branches.filter(b => isKept(b.name)).flatMap((b): UnpushedBranch[] =>
      b.ahead > 0 ? [{ name: b.name, ahead: b.ahead, why: 'ahead' }]
        : (!b.upstream || b.isGone) && !isMerged(b.name) ? [{ name: b.name, ahead: 0, why: b.isGone ? 'gone' : 'none' }]
          : []),
    merged: worktrees.slice(1).flatMap(w =>
      w.branch && w.branch !== defaultBranch && isMerged(w.branch) && !fresh.includes(w.branch) && !ignore.some(p => p.test(w.branch!))
        ? [{ branch: w.branch, path: w.path }] : []),
  }
}

// Nothing to ship: no commits ahead, no dirty files, no unpushed branches, no merged worktrees. Behind is not
// unshipped work. A repo with no commits has nothing shipped yet.
export const isShipped = (ship: Ship) =>
  !ship.isInitial && ship.ahead === 0 && ship.dirty === 0 && ship.unpushed.length === 0 && ship.merged.length === 0

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const where = (ship: Ship) => {
  const name = ship.isDetached ? 'detached HEAD' : ship.isInitial ? `${ship.branch}, no commits` : ship.branch

  return `${name}${ship.ahead ? ` ↑${ship.ahead}` : ''}${ship.behind ? ` ↓${ship.behind}` : ''}`
}

const counts = (ship: Ship, mergedWord: (n: number) => string) => [
  ship.dirty ? `${ship.dirty} dirty` : '',
  ship.unpushed.length ? `${ship.unpushed.length} unpushed` : '',
  ship.merged.length ? mergedWord(ship.merged.length) : '',
].filter(Boolean)

// The pane's line: zero counts left out; all zero reads as a plain positive.
export const shipLine = (ship: Ship) =>
  isShipped(ship) ? `${where(ship)} · committed and pushed`
    : [where(ship), ...counts(ship, n => plural(n, 'merged worktree', 'merged worktrees'))].join(' · ')

// The status-line entry: the same, shorter, only while something is unshipped.
export const shipStatus = (ship: Ship | null | undefined) =>
  !ship || isShipped(ship) ? undefined : ` ${[where(ship), ...counts(ship, n => `${n} merged`)].join(' · ')}`
