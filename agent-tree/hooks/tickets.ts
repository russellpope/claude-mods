import type { BatchCounts } from '../types'

export type Ticket = { file: string; id: string; status: string; batch: string; workspace: string }

type Key = 'id' | 'status' | 'batch' | 'workspace'

export const TICKET_GREP_ARGV = (issuesDir: string): string[] => ['grep', '-rH', '-E', '^(id|status|batch|workspace):', '--include=*.md', issuesDir]

/** `grep -rH` lines `<file>:<key>: <value>`; the first value per file and key wins (frontmatter comes first). */
export const parseTicketGrep = (stdout: string): Ticket[] => {
  const byFile = new Map<string, Ticket>()
  for (const line of stdout.split('\n')) {
    const m = /^(.+?\.md):(id|status|batch|workspace):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, file = '', key = 'id', raw = ''] = m
    const t = byFile.get(file) ?? { file, id: '', status: '', batch: '', workspace: '' }
    if (!t[key as Key]) t[key as Key] = raw.trim().replace(/^["']|["']$/g, '')
    byFile.set(file, t)
  }
  return [...byFile.values()].filter(t => t.id)
}

const trimSlash = (p: string): string => p.replace(/\/+$/, '')

export const ticketFor = (tickets: Ticket[], cwd: string): Ticket | null =>
  tickets.find(t => t.workspace && trimSlash(t.workspace) === trimSlash(cwd)) ?? null

export const batchStamp = (batch: string): string => batch.split('#')[0]?.trim() ?? ''

const CLOSED = new Set(['fixed', 'done', 'closed', 'resolved', 'superseded', 'wontfix'])

export const batchCounts = (tickets: Ticket[], stamp: string): BatchCounts => {
  const members = tickets.filter(t => batchStamp(t.batch) === stamp)
  const fixed = members.filter(t => CLOSED.has(t.status)).length
  const inProgress = members.filter(t => t.status === 'in-progress').length
  return { stamp, fixed, inProgress, open: members.length - fixed - inProgress, total: members.length }
}

/** `git rev-parse --path-format=absolute --git-common-dir` output → the main checkout; else the cwd itself. */
export const repoFromCommonDir = (stdout: string, cwd: string): string => {
  const dir = stdout.trim()
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : dir || cwd
}

export const repoName = (path: string): string => trimSlash(path).split('/').pop() || path
