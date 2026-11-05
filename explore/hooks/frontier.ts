import type { Question } from '../types'

export type { Question }

/** Where the frontier is: a parsed grilling message, or one of plain `?` lines that a model call must list. */
export type Frontier =
  | { kind: 'parsed'; text: string; ago: number; questions: Question[] }
  | { kind: 'unlisted'; text: string; ago: number }

// `❓ **Q<n>** - **<title>**: <body>`, at the start of a line only: a body may quote the format.
// The colon may be missing or inside the bold: a small model drifts from the format.
const START = /^❓️?\s*\*\*Q(\d+)\*\*\s*[-–—]\s*\*\*(.+?):?\*\*:?\s*(.*)$/u
const REC = /^➡️?\s*(.*)$/u
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE = /^\s*```/

/** The questions of a grilling message: each from its ❓ line to `---`, the next ❓ line, or the blank line after its ➡️ recommendation. Code fences are body text. */
export function parseFrontier(text: string): Question[] {
  const out: Question[] = []
  let cur: { n: number; title: string; body: string[]; rec: string[]; part: 'body' | 'rec' | 'after' } | null = null
  const close = () => {
    if (cur) out.push({ n: cur.n, title: cur.title, body: cur.body.join('\n').trim(), rec: cur.rec.join('\n').trim() })
    cur = null
  }
  let inFence = false
  for (const line of text.split('\n')) {
    const isFence = FENCE.test(line)
    const plain = !inFence && !isFence
    if (isFence) inFence = !inFence
    const start = plain ? START.exec(line) : null
    if (start) {
      close()
      cur = { n: Number(start[1]), title: (start[2] ?? '').trim(), body: start[3] ? [start[3]] : [], rec: [], part: 'body' }
      continue
    }
    if (!cur) continue
    if (plain && RULE.test(line)) {
      close()
      continue
    }
    const rec = plain && cur.part === 'body' ? REC.exec(line) : null
    if (rec) {
      cur.part = 'rec'
      cur.rec.push(rec[1] ?? '')
    } else if (cur.part === 'body') cur.body.push(line)
    else if (cur.part === 'rec') {
      if (line.trim()) cur.rec.push(line)
      else cur.part = 'after'
    }
  }
  close()
  return out
}

/** A recommendation's first sentence, without code marks: what the picker shows beside a question. */
export function shortRec(rec: string): string {
  const plain = rec.replace(/`/g, '').trim()
  const cut = plain.search(/\.(\s|$)/)
  return (cut === -1 ? plain : plain.slice(0, cut)).trim()
}

/** Lines ending in `?` outside code fences, bold or italic marks after it aside: three or more, and no ❓, make a message worth a model's listing. */
export function questionMarkLines(text: string): number {
  let inFence = false
  let n = 0
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence
    else if (!inFence && line.trim().replace(/[*_]+$/, '').endsWith('?')) n++
  }
  return n
}

/** The newest assistant message with a frontier, and how many messages with text came after it. */
export function findFrontier(messages: readonly { role: string; text: string }[]): Frontier | null {
  let ago = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || !m.text.trim()) continue
    if (m.role === 'assistant') {
      const questions = parseFrontier(m.text)
      if (questions.length) return { kind: 'parsed', text: m.text, ago, questions }
      if (questionMarkLines(m.text) >= 3) return { kind: 'unlisted', text: m.text, ago }
    }
    ago++
  }
  return null
}

/** An answer's options: its `### A. <name>` headings (or `### Option A: <name>`), in order. */
export function parseOptions(answer: string): { letter: string; name: string }[] {
  const out: { letter: string; name: string }[] = []
  for (const line of answer.split('\n')) {
    const m = /^#{2,4}\s+(?:[Oo]ption\s+)?([A-Z])[.):]\s+(.+?)\s*$/.exec(line)
    if (m) out.push({ letter: m[1] ?? '', name: (m[2] ?? '').replace(/\*\*/g, '') })
  }
  return out
}

/** A short, stable key for a message's text: FNV-1a, 8 hex digits. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
