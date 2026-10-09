import type { BatchCounts, Role, TreeNode } from '../types'

export type Segment = { text: string; fg?: string; bg?: string }

// Clay body and ink eyes after savvy-progress's pixel Clawd (after DockCrab), redrawn at 24×12.
export const PALETTE: Record<string, string> = {
  c: '#D97757', // clay body
  d: '#A9583C', // clay shade
  k: '#1F1E1D', // ink: eyes, magnifier rim
  e: '#F4F1EA', // eye glint
  b: '#4A4A48', // keyboard
  w: '#C9CCD2', // keys
  g: '#A9D6F5', // glass
  s: '#6FA8DC', // sweat, confetti
  y: '#F5C542', // confetti
  p: '#B48EF0', // confetti
  r: '#D0453F', // alarm
  z: '#9A9A96', // sleep
}

export const CRAB_WIDTH = 24
/** Terminal rows: two pixel rows per cell. */
export const CRAB_ROWS = 6

// The crab sits behind its keyboard (the last four pixel rows); its claws reach the keys.
const SPRITES = {
  typingA: [
    '........................',
    '.......cccccccccc.......',
    '......cccccccccccc......',
    '......ccekcccekccc......',
    '......cckkccckkccc..cc..',
    '......cccccccccccc.cc...',
    '...ccccccccccccccccc....',
    '...cc.dddddddddddd......',
    '.bbccbbbbbbbbbbbbbbbbbb.',
    '.bwbwbwbwbwbwbwbwbwbwbb.',
    '.bbwbwbwbwbwbwbwbwbwbwb.',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
  ],
  typingB: [
    '........................',
    '.......cccccccccc.......',
    '......cccccccccccc......',
    '......ccekcccekccc......',
    '..cc..cckkccckkccc......',
    '...cc.cccccccccccc......',
    '....cccccccccccccccccc..',
    '......dddddddddddd.cc...',
    '.bbbbbbbbbbbbbbbbbbccbb.',
    '.bwbwbwbwbwbwbwbwbwbwbb.',
    '.bbwbwbwbwbwbwbwbwbwbwb.',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
  ],
  review: [
    '........................',
    '.......cccccckkkc.......',
    '......cccccckgggkc......',
    '......ccekckggekgk......',
    '......cckkckggkkgk......',
    '......cccccckgggkc......',
    '...cccccccccckkkcdcc....',
    '...cc.ddddddddddddcc....',
    '.bbccbbbbbbbbbbbbbbbbbb.',
    '.bwbwbwbwbwbwbwbwbwbwbb.',
    '.bbwbwbwbwbwbwbwbwbwbwb.',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
  ],
  blocked: [
    '.....................rr.',
    '.......cccccccccc....rr.',
    '......ccccccccccccs..rr.',
    '......ccekcccekcccss....',
    '......cckkccckkccc...rr.',
    '......cccccccccccc......',
    '...cccccccccccccccccc...',
    '...cc.dddddddddddd.cc...',
    '.bbccbbbbbbbbbbbbbbccbb.',
    '.bwbwbwbwbwbwbwbwbwbwbb.',
    '.bbwbwbwbwbwbwbwbwbwbwb.',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
  ],
  asleep: [
    '...................zzzzz',
    '.......cccccccccc.....z.',
    '......cccccccccccc...z..',
    '......cccccccccccc..z...',
    '......cckkccckkccc.zzzzz',
    '......cccccccccccc......',
    '...cccccccccccccccccc...',
    '...cc.dddddddddddd.cc...',
    '.bbccbbbbbbbbbbbbbbccbb.',
    '.bwbwbwbwbwbwbwbwbwbwbb.',
    '.bbwbwbwbwbwbwbwbwbwbwb.',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
  ],
  party: [
    '.yc.c..p...s....y..c.cp.',
    '...cc..cccccccccc..cc...',
    '....cccccccccccccccc....',
    '......ccckcccckccc......',
    '......cckckcckckcc......',
    '......ccccckkccccc......',
    '......cccccccccccc......',
    '......dddddddddddd......',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
    '.bwbwbwbwbwbwbwbwbwbwbb.',
    '.bbwbwbwbwbwbwbwbwbwbwb.',
    '.bbbbbbbbbbbbbbbbbbbbbb.',
  ],
} as const

export type Mood = 'typing' | 'review' | 'blocked' | 'asleep' | 'party'

export const spriteFor = (mood: Mood, frame: number): string[] => {
  if (mood === 'typing') return [...(frame % 2 ? SPRITES.typingB : SPRITES.typingA)]
  return [...SPRITES[mood]]
}

export const moodWord = (mood: Mood): string =>
  ({ typing: 'typing', review: 'reviewing', blocked: 'blocked', asleep: 'asleep', party: 'batch done' })[mood]

export const moodOf = (nodes: TreeNode[], batch: BatchCounts | null): Mood => {
  if (batch && batch.total > 0 && batch.fixed === batch.total) return 'party'
  const live = nodes.filter(n => n.status !== 'gone')
  if (live.some(n => n.status === 'blocked')) return 'blocked'
  const working = live.filter(n => n.status === 'working')
  if (working.length && working.every(n => n.role === 'reviewer')) return 'review'
  return working.length ? 'typing' : 'asleep'
}

/** Pixel rows → cell rows: two pixels per cell, runs of equal cells merged. */
export const halfBlock = (rows: string[]): Segment[][] => {
  const out: Segment[][] = []
  for (let y = 0; y < rows.length; y += 2) {
    const top = rows[y] ?? ''
    const bot = rows[y + 1] ?? ''
    const segs: Segment[] = []
    for (let x = 0; x < Math.max(top.length, bot.length); x++) {
      const t = PALETTE[top[x] ?? '.']
      const b = PALETTE[bot[x] ?? '.']
      const cell: Segment = !t && !b ? { text: ' ' } : t && !b ? { text: '▀', fg: t } : !t ? { text: '▄', fg: b } : { text: '▀', fg: t, bg: b }
      const last = segs[segs.length - 1]
      if (last && last.text[0] === cell.text && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else segs.push(cell)
    }
    out.push(segs)
  }
  return out
}

export const ROLE_COLOR: Record<Role, string> = {
  lead: '#7F77DD',
  implementer: '#378ADD',
  reviewer: '#D85A30',
  fixer: '#BA7517',
  integrator: '#1D9E75',
  research: '#B48EF0',
  other: '#888780',
}

export const MINI = '▟▙'
