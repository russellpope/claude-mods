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
  /** Where the child was spawned, when the multiplexer has more than one place: its Rex session (or herdr workspace) and Rex host label. */
  session?: string
  server?: string
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
  /** The herdr tab it sits in; absent in a list kept from before tabs were read. */
  tab?: string
  /** The Rex host it runs on, by its `rex hosts` label; absent on this server and in herdr. */
  server?: string
}

export type Usage = {
  model: string
  effort: string
  /** The context as the harness's own meter counts it (codex: less reasoning and its baseline). */
  contextTokens: number
  /** The window the context percent is of, where the harness reports one (codex: less its baseline); 0 means look it up by model. */
  window: number
  /** Every call's input, cache reads included, plus its output. */
  tokens: number
  /** The part of `tokens` read back from the prompt cache. */
  cachedTokens: number
  /** The part of `tokens` the model wrote. */
  outputTokens: number
  /** null where no price is known: codex bills against a ChatGPT plan. */
  costUsd: number | null
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
  /** Not in the ledger: found in its parent's team workspace. */
  inferred?: boolean
  /** The herdr terminal an inferred node was seen on: a new occupant of the pane is a new node. */
  terminal?: string
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
  /** Absent in a panel kept from before the Dings section: open. */
  isDingsOpen?: boolean
  /** Absent: collapsed. */
  isAckedOpen?: boolean
}

/** A change herdr plays a sound for: a turn ending in a background tab, or an agent asking for input. */
export type Ding = {
  at: number
  pane: string
  /** The herdr terminal: a new occupant of the pane is a new agent. */
  terminal: string
  name: string
  kind: 'finished' | 'asking'
  /** The pane's title as it read then (its DONE: or BLOCKED: line), else the terminal's. */
  title: string
  /** Why a ding does not need you; empty when it does. */
  why: string
  needsYou: boolean
  /** Needs you and not answered yet: its row not pressed, its agent not working again. */
  isOpen: boolean
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
      dings: Ding[]
    }
  }
}
