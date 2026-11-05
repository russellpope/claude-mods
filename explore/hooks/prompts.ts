import type { Exploration } from '../types'

const SIDE =
  'This is a side exploration, outside the main work. Do not continue the main task, call no tools, and do not answer the other questions. The owner reads your answer in a drawer above the prompt and decides there.'

const SHAPE =
  'Lay out the options, each under its own heading: `### A. <name>`, `### B. <name>`, and so on. For each, say what it means, its impact on the current work, its cost and risk, and how reversible it is. Then give your recommendation, and what would change it.'

/** The question as a fork reads it: number, title, body and the grill's recommendation. */
export function questionBlock(ex: Exploration): string {
  return [`Question Q${ex.n} · ${ex.title}`, ex.body, ex.rec ? `The grill's recommendation: ${ex.rec}` : ''].filter(Boolean).join('\n\n')
}

const soFar = (ex: Exploration) => ex.turns.map(t => (t.ask ? `Follow-up: ${t.ask}\n\n${t.answer}` : t.answer))

/** A fork's prompt: the question and the answer's shape, or for a follow-up the exploration so far and then the follow-up. */
export function forkPrompt(ex: Exploration, ask: string): string {
  if (!ask) return [SIDE, questionBlock(ex), SHAPE].join('\n\n')
  return [SIDE, questionBlock(ex), 'The exploration so far:', ...soFar(ex), `Follow-up: ${ask}`, 'Answer the follow-up only.'].join('\n\n')
}

/** The take summary fork: where the owner lands, in one or two sentences of their own voice. */
export function summaryPrompt(ex: Exploration): string {
  return [
    SIDE,
    questionBlock(ex),
    'The exploration so far:',
    ...soFar(ex),
    "In one or two sentences, in the owner's own voice, as their answer to this question in their reply, say where they land. Reply with only those sentences.",
  ].join('\n\n')
}

/** The Haiku listing of a message of `?` lines, in the grilling format so the same parser reads it. */
export function listingPrompt(text: string): string {
  return [
    'List the questions this message asks its reader, in order, one per question, in exactly this format and nothing else:',
    '❓ **Q<n>** - **<a title of a few words>**: <the question>',
    'The message:',
    text,
  ].join('\n\n')
}

/** What take back inserts for an option: `5: B, <name>`. */
export const takeText = (n: number, letter: string, name: string): string => `${n}: ${letter}, ${name}`

/** What take summary inserts: `5: <summary>`, on one line. */
export const summaryText = (n: number, summary: string): string => `${n}: ${summary.trim().replace(/\s*\n\s*/g, ' ')}`

/** The artifact: the question with the grill's recommendation, the exploration, each follow-up, and what was taken back. */
export function artifactBody(ex: Exploration): string {
  const head = [`## Q${ex.n} · ${ex.title}`, ex.body, ex.rec ? `➡️ The grill's recommendation: ${ex.rec}` : ''].filter(Boolean).join('\n\n')
  const turns = ex.turns.map(t => (t.ask ? `## Follow-up: ${t.ask}\n\n${t.answer}` : `## Exploration\n\n${t.answer}`))
  const taken = ex.taken.length ? [`## Taken back\n\n${ex.taken.map(t => `- ${t}`).join('\n')}`] : []
  return [head, ...turns, ...taken].join('\n\n')
}

/** How long a fork took and what it wrote: `answered in 14s · 1.2k tokens`. */
export function fmtCall(ms: number, tokens: number): string {
  const s = Math.round(ms / 1000)
  const time = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  const tok = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  return `answered in ${time} · ${tok} tokens`
}

/** A fork that gave no text, in the drawer's words, and whether a retry can help. */
export function failure(r: { reason: string; status?: number | null; error?: unknown }): { error: string; canRetry: boolean } {
  switch (r.reason) {
    case 'nothing-to-fork':
      return { error: 'nothing to explore yet', canRetry: false }
    case 'api-error':
      return { error: `api error${r.status ? ` ${r.status}` : ''}${r.error ? ` · ${String(r.error)}` : ''}`, canRetry: true }
    case 'empty-reply':
      return { error: 'no answer', canRetry: true }
    case 'aborted':
      return { error: 'cancelled', canRetry: true }
    default:
      return { error: `failed: ${String(r.error ?? r.reason)}`, canRetry: true }
  }
}
