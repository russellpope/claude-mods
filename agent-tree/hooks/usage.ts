import type { ModelChange, Usage } from '../types'

export type RawUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// USD per million tokens: input, output, cache read, cache write (5-minute TTL).
// The engine reports tokens, not money: the cost is an estimate.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

const priceOf = (model: string): [number, number, number, number] => PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]

export const costOf = (model: string, u: RawUsage): number => {
  const [i, o, r, w] = priceOf(model)
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
}

export const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

export const fmtTokens = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// byId: a message id → its [tokens, cost, cache reads, output], so a repeated line replaces its first count.
export type UsageAcc = Omit<Usage, 'costUsd'> & { costUsd: number; ids: string[]; byId: Record<string, [number, number, number, number]> }

export const emptyUsage = (): UsageAcc => ({ model: '', effort: '', contextTokens: 0, window: 0, tokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, ids: [], byId: {} })

const KEEP_IDS = 200

type Line = {
  type?: string
  isSidechain?: boolean
  effort?: unknown
  timestamp?: string
  isApiErrorMessage?: boolean
  error?: unknown
  apiErrorStatus?: unknown
  message?: { id?: string; model?: string; usage?: RawUsage }
}

/** Claude Code's model for a line it wrote itself, such as an API error: never the agent's model. */
export const SYNTHETIC = '<synthetic>'

const timeOf = (t: unknown): number => {
  const ms = typeof t === 'string' ? Date.parse(t) : NaN
  return Number.isFinite(ms) ? ms : 0
}

/** A model or effort that differs from the one before: the one before, and when. A first model or an absent effort is no change. */
export const changeOf = (prev: { model: string; effort: string }, model: string, effort: string, at: number): ModelChange | null =>
  prev.model && (model !== prev.model || (effort && prev.effort && effort !== prev.effort)) ? { model: prev.model, effort: prev.effort, at } : null

export const addTranscript = (acc: UsageAcc, text: string): UsageAcc => {
  const next: UsageAcc = { ...acc, ids: [...acc.ids], byId: { ...acc.byId } }
  for (const raw of text.split('\n')) {
    // Assistant lines carry usage (an API error line too, all zeros). A user line matters only to clear an error.
    if (!raw.includes('"usage"') && !(next.apiError && raw.includes('"type":"user"'))) continue
    let o: Line
    try {
      o = JSON.parse(raw) as Line
    } catch {
      continue
    }
    if ((o.type !== 'assistant' && o.type !== 'user') || o.isSidechain) continue
    if (o.type === 'assistant' && o.isApiErrorMessage === true) {
      next.apiError = { reason: typeof o.error === 'string' && o.error ? o.error : 'unknown', status: typeof o.apiErrorStatus === 'number' ? o.apiErrorStatus : null, at: timeOf(o.timestamp) }
      continue
    }
    // Any later main-chain line of the conversation: the agent went on.
    delete next.apiError
    const u = o.message?.usage
    if (o.type !== 'assistant' || !u || o.message?.model === SYNTHETIC) continue
    const model = o.message?.model || next.model
    const effort = typeof o.effort === 'string' ? o.effort : next.effort
    const change = changeOf(next, model, effort, timeOf(o.timestamp))
    if (change) next.was = change
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
    const cost = costOf(model, u)
    const cached = u.cache_read_input_tokens || 0
    const out = u.output_tokens || 0
    next.model = model
    next.effort = effort
    next.contextTokens = ctx
    const id = o.message?.id ?? ''
    const prev = id ? next.byId[id] : undefined
    if (prev) {
      next.tokens -= prev[0]
      next.costUsd -= prev[1]
      next.cachedTokens -= prev[2]
      next.outputTokens -= prev[3]
    } else if (id) {
      next.ids.push(id)
    }
    if (id) next.byId[id] = [ctx, cost, cached, out]
    next.tokens += ctx
    next.costUsd += cost
    next.cachedTokens += cached
    next.outputTokens += out
  }
  while (next.ids.length > KEEP_IDS) delete next.byId[next.ids.shift() ?? '']
  return next
}

export const toUsage = (acc: UsageAcc): Usage => ({
  model: acc.model,
  effort: acc.effort,
  contextTokens: acc.contextTokens,
  window: acc.window,
  tokens: acc.tokens,
  cachedTokens: acc.cachedTokens,
  outputTokens: acc.outputTokens,
  costUsd: acc.costUsd,
  ...(acc.was ? { was: acc.was } : {}),
  ...(acc.apiError ? { apiError: acc.apiError } : {}),
})

export const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

export const transcriptPath = (home: string, cwd: string, session: string): string => `${home}/.claude/projects/${projectDirName(cwd)}/${session}.jsonl`

export const CHUNK_BYTES = 2_000_000

/** The whole lines of a chunk, and how many bytes they take on disk. */
export const wholeLines = (chunk: string): { text: string; bytes: number } => {
  const text = chunk.slice(0, chunk.lastIndexOf('\n') + 1)
  return { text, bytes: new TextEncoder().encode(text).length }
}

const utf8Length = (s: string): number => new TextEncoder().encode(s).length

/**
 * One read of a transcript: the whole lines to parse and how many bytes to move past.
 * A full read with no newline is a line longer than a read (a pasted image, say): it is
 * moved past, and `isSkipping` drops the rest of it, up to its newline, on the next read.
 */
export const consumeChunk = (chunk: string, isSkipping: boolean, chunkBytes = CHUNK_BYTES): { text: string; bytes: number; isSkipping: boolean } => {
  let rest = chunk
  let dropped = 0
  if (isSkipping) {
    const nl = chunk.indexOf('\n')
    if (nl < 0) return { text: '', bytes: utf8Length(chunk), isSkipping: true }
    dropped = utf8Length(chunk.slice(0, nl + 1))
    rest = chunk.slice(nl + 1)
  }
  const lines = wholeLines(rest)
  if (lines.bytes === 0 && !isSkipping && utf8Length(rest) >= chunkBytes) return { text: '', bytes: utf8Length(rest), isSkipping: true }
  return { text: lines.text, bytes: dropped + lines.bytes, isSkipping: false }
}
