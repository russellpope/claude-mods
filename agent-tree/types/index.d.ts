export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
export type NodeStatus = 'working' | 'idle' | 'blocked' | 'done' | 'gone'
export type Role = 'lead' | 'implementer' | 'reviewer' | 'fixer' | 'integrator' | 'research' | 'other'

/** One spawn: `parent` pane ran `herdr agent start` and `child` pane got the agent. */
export type Edge = {
  v: 1
  parent: string
  parentSession: string
  child: string
  name: string
  via: string
  at: number
}

/** One row of `herdr agent list`, trimmed to what the mod reads. */
export type HerdrAgent = {
  pane: string
  name: string
  harness: string
  status: AgentStatus
  title: string
  label: string
  cwd: string
  workspace: string
  session: string
  terminal: string
}

export type Usage = {
  model: string
  effort: string
  contextTokens: number
  tokens: number
  costUsd: number
}

export type TreeNode = {
  pane: string
  parent: string
  depth: number
  isLast: boolean
  name: string
  harness: string
  role: Role
  status: NodeStatus
  title: string
  cwd: string
  session: string
  startedAt: number
  lastSeen: number
  usage: Usage | null
  ticket: string
}

export type BatchCounts = { stamp: string; fixed: number; inProgress: number; open: number; total: number }

export type Snapshot = {
  at: number
  root: string
  nodes: TreeNode[]
  all: HerdrAgent[]
  /** cwd → main repo path */
  repos: Record<string, string>
  batch: BatchCounts | null
  error: string
}

export type Panel = {
  mode: 'tree' | 'all'
  compact: 'auto' | 'on' | 'off'
  isFinishedOpen: boolean
  isInProcessOpen: boolean
  isAutoOpened: boolean
}

export type InProcRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  contextTokens: number
  tokens: number
  costUsd: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': {
      snapshot: Snapshot
      panel: Panel
      frame: number
      inproc: InProcRun[]
      edgeCount: number
    }
  }
}
