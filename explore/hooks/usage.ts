import { reversibility } from './frontier'

/** What the usage log records: a question opened, a fork's first answer or a follow-up's, and a take back. */
export type UsageEvent = 'open' | 'exploration' | 'follow-up' | 'take'

/** The usage log, in the XDG state folder where agent-tree keeps its edge ledger: `~/.local/state/explore/usage.tsv`. */
export const usagePath = (home: string): string => `${home}/.local/state/explore/usage.tsv`

const field = (text: string) => text.replace(/[\t\r\n]+/g, ' ').trim()

/**
 * One usage line, tab-separated and newline-ended: ISO time (UTC), event, question number, title, and the reversibility
 * the question's brief states ('' when none). Tabs and newlines in the title become spaces.
 */
export function usageLine(at: number, event: UsageEvent, q: { n: number; title: string; body: string }): string {
  return `${[new Date(at).toISOString(), event, String(q.n), field(q.title), reversibility(q.body)].join('\t')}\n`
}
