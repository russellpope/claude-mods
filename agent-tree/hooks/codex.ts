import type { Usage } from '../types'
import { toUsage } from './usage'
import type { UsageAcc } from './usage'

type Counts = { cached_input_tokens?: number; output_tokens?: number; total_tokens?: number }

type Line = {
  type?: string
  payload?: {
    type?: string
    model?: string
    effort?: string | null
    info?: { total_token_usage?: Counts; last_token_usage?: Counts; model_context_window?: number } | null
  }
}

/**
 * A codex rollout's lines → model and effort from each turn's context, and the numbers from its
 * newest token count. Codex writes running totals, so a later count replaces an earlier one.
 */
export const addRollout = (acc: UsageAcc, text: string): UsageAcc => {
  const next: UsageAcc = { ...acc }
  for (const raw of text.split('\n')) {
    if (!raw.includes('"turn_context"') && !raw.includes('"token_count"')) continue
    let o: Line
    try {
      o = JSON.parse(raw) as Line
    } catch {
      continue
    }
    const p = o.payload
    if (o.type === 'turn_context' && p?.model) {
      next.model = p.model
      next.effort = p.effort ?? ''
    }
    const info = o.type === 'event_msg' && p?.type === 'token_count' ? p.info : null
    if (!info?.total_token_usage) continue
    next.tokens = info.total_token_usage.total_tokens || 0
    next.cachedTokens = info.total_token_usage.cached_input_tokens || 0
    next.outputTokens = info.total_token_usage.output_tokens || 0
    next.contextTokens = info.last_token_usage?.total_tokens || 0
    next.window = info.model_context_window || 0
  }
  return next
}

export const codexUsage = (acc: UsageAcc): Usage => ({ ...toUsage(acc), costUsd: null })
