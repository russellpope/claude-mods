import type { Edge, HerdrAgent } from '../types'

export const WEEK_MS = 604_800_000

export const ledgerDir = (home: string): string => `${home}/.local/state/agent-tree/edges`

export const edgeFileName = (e: Edge): string => `${e.at}-${e.child.replace(/[^A-Za-z0-9]/g, '_')}.json`

/** The spawn time an edge file's name starts with; NaN for any other file. */
export const edgeAt = (fileName: string): number => {
  const m = /^(\d+)-.+\.json$/.exec(fileName)
  return m ? Number(m[1]) : NaN
}

export const makeEdge = (parent: string, parentSession: string, child: HerdrAgent, at: number): Edge => ({
  v: 1,
  parent,
  parentSession,
  child: child.pane,
  name: child.name,
  via: 'claude-mod',
  at,
})

export const parseEdge = (text: string): Edge | null => {
  try {
    const o = JSON.parse(text) as Partial<Edge>
    if (o.v !== 1 || typeof o.parent !== 'string' || typeof o.child !== 'string' || typeof o.at !== 'number') return null
    return {
      v: 1,
      parent: o.parent,
      parentSession: String(o.parentSession ?? ''),
      child: o.child,
      name: String(o.name ?? ''),
      via: String(o.via ?? ''),
      at: o.at,
    }
  } catch {
    return null
  }
}
