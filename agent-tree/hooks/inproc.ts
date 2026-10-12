import type { InProcRun } from '../types'
import type { RawUsage } from './usage'
import { costOf } from './usage'

const KEEP = 50

export const spawnRun = (
  list: InProcRun[],
  r: { id: string; agentId?: string; type: string; description: string; model: string; at: number },
): InProcRun[] => {
  const run: InProcRun = {
    id: r.id,
    agentId: r.agentId,
    type: r.type,
    description: r.description,
    model: r.model,
    status: 'running',
    startedAt: r.at,
    contextTokens: 0,
    tokens: 0,
    costUsd: 0,
  }
  return [...list.filter(a => a.id !== run.id), run].slice(-KEEP)
}

export const stepRun = (list: InProcRun[], agentId: string, model: string, u: RawUsage): InProcRun[] => {
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
  return list.map(a => (a.agentId !== agentId ? a : { ...a, model, contextTokens: ctx, tokens: a.tokens + ctx, costUsd: a.costUsd + costOf(model, u) }))
}

export const completeRun = (list: InProcRun[], agentId: string, ok: boolean, at: number): InProcRun[] =>
  list.map(a => (a.agentId !== agentId ? a : { ...a, status: ok ? 'done' : 'failed', endedAt: at }))
