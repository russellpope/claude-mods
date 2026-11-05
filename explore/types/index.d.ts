/** One question of a frontier, as the grilling format writes it. */
export type Question = { n: number; title: string; body: string; rec: string }

/** One fork's ask and its answer; the question itself is asked as ''. */
export type Turn = { ask: string; answer: string; ms: number; tokens: number }

/** What a failed fork was doing, so retry can do it again. */
export type Pending = { kind: 'ask'; ask: string } | { kind: 'summary' }

/** A side conversation about one question. */
export type Exploration = {
  /** `<frontier hash>:<n>`. */
  key: string
  /** The question's number in its frontier. */
  n: number
  title: string
  body: string
  /** The grill's recommendation. */
  rec: string
  turns: Turn[]
  status: 'idle' | 'thinking' | 'failed'
  pending: Pending | null
  /** The failure in words; empty unless failed. */
  error: string
  /** Whether a retry can help the failure. */
  canRetry: boolean
  /** What take back inserted, in order. */
  taken: string[]
  /** The id the last save to artifacts returned; empty before one. */
  savedId: string
}

/** What the drawer shows. */
export type DrawerView =
  | { view: 'closed' }
  | { view: 'picker'; note: string }
  | { view: 'empty'; note: string }
  | { view: 'exploration'; key: string }

/** The frontier the picker lists: its message's hash, how many messages came after it, its questions. */
export type FrontierView = { hash: string; ago: number; questions: Question[] }

declare module 'claude-code' {
  interface PluginState {
    explore: {
      drawer: DrawerView
      frontier: FrontierView | null
      explorations: Record<string, Exploration>
      /** Model listings of `?`-line messages, by the message's hash. */
      listed: Record<string, Question[]>
      /** The last turn's question count when three or more; 0 hides the hint. */
      hint: number
      /** The spinner's step while a fork runs. */
      frame: number
      /** The last target opening the drawer asked `$.ui.focus` for; null before one. */
      focusAsked: { requestId: string; key: string } | null
    }
  }

  /** The artifacts mod's tool, so `$.tool.call` names it whatever MCP servers the types were saved with. */
  interface McpToolInputs {
    mcp__artifacts__show: { title: string; body: string; kind?: string; id?: string }
  }
}
