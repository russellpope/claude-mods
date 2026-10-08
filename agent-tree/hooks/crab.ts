import type { BatchCounts, Role, TreeNode } from '../types'

export type Segment = { text: string; fg?: string; bg?: string }

// Clay body and ink eyes from savvy-progress's pixel Clawd (after DockCrab).
export const PALETTE: Record<string, string> = {
  c: '#D97757', // clay body
  k: '#1F1E1D', // ink: eyes, magnifier rim
  b: '#4A4A48', // keyboard
  w: '#C9CCD2', // keys
  g: '#A9D6F5', // glass
  s: '#6FA8DC', // sweat, confetti
  y: '#F5C542', // confetti
  p: '#B48EF0', // confetti
}

export const CRAB_ROWS = 4

const KEYBOARD = ['bbbbbbbbbbbbbbbb', 'bwbwbwbwbwbwbwbb', 'bbbbbbbbbbbbbbbb']
const EMPTY = '................'

const SPRITES = {
  typingA: ['cc..............', '.cc.cccccccc....', '...cckcccckcc...', '...cccccccccc.c.', '....c.c..c.c.cc.', ...KEYBOARD],
  typingB: ['..............cc', '....cccccccc.cc.', '...cckcccckcc...', '.c.cccccccccc...', '.cc.c.c..c.c....', ...KEYBOARD],
  review: ['...........kkk..', '....ccccccckgggk', '...cckcccckkgggk', '...ccccccccckkk.', '....c.c..c.cc...', EMPTY, EMPTY, EMPTY],
  blocked: ['.............s..', '....cccccccc.ss.', '...cckcccckcc...', '.c.cccccccccc.c.', '.cc.c.c..c.c.cc.', ...KEYBOARD],
  asleep: [EMPTY, '....cccccccc....', '...cccccccccc...', '.c.ckkcccckkc.c.', '.cc.c.c..c.c.cc.', ...KEYBOARD],
  party: ['cc.y......p...cc', '.cc.cccccccc.cc.', '...cckcccckcc...', '.s.cccccccccc.y.', '....c.c..c.c....', '..p.....y....s..', EMPTY, EMPTY],
} as const

export type Mood = 'typing' | 'review' | 'blocked' | 'asleep' | 'party'

export const spriteFor = (mood: Mood, frame: number): string[] => {
  if (mood === 'typing') return [...(frame % 2 ? SPRITES.typingB : SPRITES.typingA)]
  return [...SPRITES[mood]]
}

export const moodTag = (mood: Mood, frame: number): { text: string; color: string } => {
  if (mood === 'blocked') return { text: '!', color: '#D0453F' }
  if (mood === 'asleep') return { text: 'z', color: '#9a9a96' }
  if (mood === 'party') return { text: frame % 2 ? '✦' : '★', color: '#F5C542' }
  if (mood === 'review') return { text: '?', color: '#D85A30' }
  return { text: '', color: '' }
}

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
