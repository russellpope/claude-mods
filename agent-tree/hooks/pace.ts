import type { BatchCounts, Pace } from '../types'

export type { Pace }

/**
 * One refresh's look at the batch. Tickets carry no times, so a close is a rise in the fixed count, timed when
 * this mod saw it. The first sight only notes the time and the count: closes before it were never observed.
 * A count that goes down (a ticket reopened) records nothing, and climbing back to the highest count seen
 * records nothing either, so a reopen does not count its close twice. A new stamp starts over.
 */
export const observeBatch = (p: Pace | null, b: BatchCounts | null, at: number): Pace | null => {
  if (!b) return p
  if (!p || p.stamp !== b.stamp) return { stamp: b.stamp, firstSeen: at, high: b.fixed, closes: [] }
  if (b.fixed <= p.high) return p
  return { ...p, high: b.fixed, closes: [...p.closes, ...Array.from({ length: b.fixed - p.high }, () => at)] }
}

/**
 * The tickets not yet fixed times the mean time per observed close, from first sight to the newest close.
 * Null with fewer than two observed closes, none left, or a record of another batch.
 */
export const etaMs = (p: Pace | null, b: BatchCounts | null): number | null => {
  if (!p || !b || p.stamp !== b.stamp || p.closes.length < 2) return null
  const left = b.total - b.fixed
  const last = p.closes[p.closes.length - 1] ?? p.firstSeen
  return left > 0 ? (left * (last - p.firstSeen)) / p.closes.length : null
}

/** `~1h 20m left`, to the minute, never under a minute. */
export const etaText = (ms: number): string => {
  const min = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return `~${h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`} left`
}

/** The batch's text after its counts: fixed / total, in progress, and the ETA when there is one. */
export const batchText = (b: BatchCounts, p: Pace | null): string => {
  const eta = etaMs(p, b)
  return `${b.fixed}/${b.total} fixed · ${b.inProgress} in progress${eta === null ? '' : ` · ${etaText(eta)}`}`
}
