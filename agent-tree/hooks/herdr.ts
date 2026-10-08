import type { AgentStatus, HerdrAgent } from '../types'

const STATUSES: readonly AgentStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown']

type RawAgent = {
  pane_id?: string
  name?: string
  agent?: string
  agent_status?: string
  title?: string
  terminal_title_stripped?: string
  cwd?: string
  workspace_id?: string
  terminal_id?: string
  agent_session?: { value?: string }
}

export const toAgent = (r: RawAgent): HerdrAgent => ({
  pane: r.pane_id ?? '',
  name: r.name ?? '',
  harness: r.agent ?? '',
  status: STATUSES.includes(r.agent_status as AgentStatus) ? (r.agent_status as AgentStatus) : 'unknown',
  title: r.title ?? '',
  label: r.terminal_title_stripped ?? '',
  cwd: r.cwd ?? '',
  workspace: r.workspace_id ?? '',
  session: r.agent_session?.value ?? '',
  terminal: r.terminal_id ?? '',
})

/** `herdr agent list` stdout → agents. Throws on anything that is not an agent_list. */
export const parseAgentList = (stdout: string): HerdrAgent[] => {
  const o = JSON.parse(stdout) as { result?: { type?: string; agents?: RawAgent[] } }
  if (o.result?.type !== 'agent_list' || !Array.isArray(o.result.agents)) throw new Error('not an agent_list')
  return o.result.agents.map(toAgent).filter(a => a.pane)
}

/** Every `agent_started` response in a command's stdout; herdr prints one JSON document per line. */
export const parseStarted = (stdout: string): HerdrAgent[] =>
  stdout.split('\n').flatMap(line => {
    const t = line.trim()
    if (!t.startsWith('{') || !t.includes('agent_started')) return []
    try {
      const o = JSON.parse(t) as { result?: { type?: string; agent?: RawAgent } }
      return o.result?.type === 'agent_started' && o.result.agent?.pane_id ? [toAgent(o.result.agent)] : []
    } catch {
      return []
    }
  })

/**
 * True when `herdr agent start` runs as a command. Quoted text is blanked first,
 * except a double-quoted string holding `$(`, whose command substitution runs.
 */
export const invokesAgentStart = (command: string): boolean => {
  const unquoted = command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\$]|\\.|\$(?!\())*"/g, '""')
  return /(?:^|[;&|(`\n]|\$\(|\b(?:if|then|do|else|time|exec)\s)\s*herdr\s+agent\s+start\b/.test(unquoted)
}

/** Agents in `after` on a pane `before` lacked, or on a pane that now runs another session. */
export const newAgents = (before: HerdrAgent[], after: HerdrAgent[]): HerdrAgent[] => {
  const seen = new Map(before.map(a => [a.pane, a.session]))
  return after.filter(a => !seen.has(a.pane) || (a.session !== '' && seen.get(a.pane) !== a.session))
}
