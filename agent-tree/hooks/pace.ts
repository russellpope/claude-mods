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

/** How many batches the book keeps: a tree can move between batches and back. */
export const KEEP_BATCHES = 5

/** The stored value as a book: state from before the book held one record, or null. */
export const paceBook = (stored: unknown): Pace[] => {
  const isPace = (v: unknown): v is Pace => Boolean(v) && typeof (v as Pace).stamp === 'string' && Array.isArray((v as Pace).closes)
  if (Array.isArray(stored)) return stored.filter(isPace)
  return isPace(stored) ? [stored] : []
}

/**
 * observeBatch on the batch's own record, which moves to the end (seen most recently). Past KEEP_BATCHES the
 * record seen least recently goes. The same book comes back when nothing changed, so nothing is written.
 */
export const observeBook = (book: Pace[], b: BatchCounts | null, at: number): Pace[] => {
  if (!b) return book
  const i = book.findIndex(r => r.stamp === b.stamp)
  const old = i < 0 ? null : (book[i] ?? null)
  const rec = observeBatch(old, b, at)
  if (rec === old && i === book.length - 1) return book
  const next = [...book.filter(r => r.stamp !== b.stamp), ...(rec ? [rec] : [])]
  return next.slice(-KEEP_BATCHES)
}

export const paceFor = (book: Pace[], stamp: string): Pace | null => book.find(r => r.stamp === stamp) ?? null

/**
 * The tickets not yet fixed times the mean time per close. The plain mean is (newest close − first seen) ÷ closes;
 * the mean used counts from first sight to the later of the newest close and one plain mean before now. So the
 * estimate holds for one mean interval after a close, then grows while nothing closes.
 * Null with fewer than two observed closes, none left, or a record of another batch.
 */
export const etaMs = (p: Pace | null, b: BatchCounts | null, now: number): number | null => {
  if (!p || !b || p.stamp !== b.stamp || p.closes.length < 2) return null
  const left = b.total - b.fixed
  const last = p.closes[p.closes.length - 1] ?? p.firstSeen
  const plain = (last - p.firstSeen) / p.closes.length
  const mean = (Math.max(last, now - plain) - p.firstSeen) / p.closes.length
  return left > 0 ? left * mean : null
}

/** `~1h 20m left`, to the minute, never under a minute. */
export const etaText = (ms: number): string => {
  const min = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(min / 60)
  const m = min % 60
  return `~${h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`} left`
}

/** The batch's text after its counts: fixed / total, in progress, and the ETA when there is one. */
export const batchText = (b: BatchCounts, book: Pace[], now: number): string => {
  const eta = etaMs(paceFor(book, b.stamp), b, now)
  return `${b.fixed}/${b.total} fixed · ${b.inProgress} in progress${eta === null ? '' : ` · ${etaText(eta)}`}`
}
