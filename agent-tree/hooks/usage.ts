import type { Usage } from '../types'

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

export const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export type UsageAcc = Usage & { ids: string[]; byId: Record<string, [number, number]> }

export const emptyUsage = (): UsageAcc => ({ model: '', effort: '', contextTokens: 0, tokens: 0, costUsd: 0, ids: [], byId: {} })

const KEEP_IDS = 200

type Line = { type?: string; isSidechain?: boolean; effort?: unknown; message?: { id?: string; model?: string; usage?: RawUsage } }

export const addTranscript = (acc: UsageAcc, text: string): UsageAcc => {
  const next: UsageAcc = { ...acc, ids: [...acc.ids], byId: { ...acc.byId } }
  for (const raw of text.split('\n')) {
    if (!raw.includes('"usage"')) continue
    let o: Line
    try {
      o = JSON.parse(raw) as Line
    } catch {
      continue
    }
    const u = o.message?.usage
    if (o.type !== 'assistant' || o.isSidechain || !u) continue
    const model = o.message?.model || next.model
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
    const cost = costOf(model, u)
    next.model = model
    next.contextTokens = ctx
    if (typeof o.effort === 'string') next.effort = o.effort
    const id = o.message?.id ?? ''
    const prev = id ? next.byId[id] : undefined
    if (prev) {
      next.tokens -= prev[0]
      next.costUsd -= prev[1]
    } else if (id) {
      next.ids.push(id)
    }
    if (id) next.byId[id] = [ctx, cost]
    next.tokens += ctx
    next.costUsd += cost
  }
  while (next.ids.length > KEEP_IDS) delete next.byId[next.ids.shift() ?? '']
  return next
}

export const toUsage = (acc: UsageAcc): Usage => ({ model: acc.model, effort: acc.effort, contextTokens: acc.contextTokens, tokens: acc.tokens, costUsd: acc.costUsd })

export const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

export const transcriptPath = (home: string, cwd: string, session: string): string => `${home}/.claude/projects/${projectDirName(cwd)}/${session}.jsonl`

export const CHUNK_BYTES = 2_000_000

/** The whole lines of a chunk, and how many bytes they take on disk. */
export const wholeLines = (chunk: string): { text: string; bytes: number } => {
  const text = chunk.slice(0, chunk.lastIndexOf('\n') + 1)
  return { text, bytes: new TextEncoder().encode(text).length }
}
