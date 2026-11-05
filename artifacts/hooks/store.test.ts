import { describe, expect, test } from 'claude-code/testing'

import type { ArtifactMeta } from '../types'
import { checkShow, fmtAge, listText, localDate, matchesQuery, newId, newestFirst, parseFile, projectKey, renderFile, slugify } from './store'

// 2026-10-15 14:02:11 local time.
const NOW = new Date(2026, 9, 15, 14, 2, 11).getTime()
const META: ArtifactMeta = {
  id: '2026-10-15-auth-flow', title: 'Auth flow', kind: 'diagram', version: 2,
  created: '2026-10-15T21:02:11.000Z', updated: '2026-10-15T22:40:00.000Z', branch: 'artifacts', session: 's-1',
}

describe('ids', () => {
  test('a title becomes lowercase letters, digits and single hyphens', () => {
    expect(slugify('Auth flow: v2 (draft)')).toBe('auth-flow-v2-draft')
    expect(slugify('  Queue vs. running  ')).toBe('queue-vs-running')
  })

  test('a slug is at most 48 characters and never ends in a hyphen', () => {
    const s = slugify('a'.repeat(47) + ' bcd')
    expect(s.length).toBeLessThanOrEqual(48)
    expect(s.endsWith('-')).toBe(false)
  })

  test('a title with no letters or digits still makes an id', () => {
    expect(slugify('❓ → ✓')).toBe('artifact')
    expect(newId('❓ → ✓', NOW, new Set())).toBe('2026-10-15-artifact')
  })

  test('the date is the local calendar date', () => {
    expect(localDate(NOW)).toBe('2026-10-15')
  })

  test('a taken id gets -2, then -3', () => {
    expect(newId('Auth flow', NOW, new Set())).toBe('2026-10-15-auth-flow')
    expect(newId('Auth flow', NOW, new Set(['2026-10-15-auth-flow']))).toBe('2026-10-15-auth-flow-2')
    expect(newId('Auth flow', NOW, new Set(['2026-10-15-auth-flow', '2026-10-15-auth-flow-2']))).toBe('2026-10-15-auth-flow-3')
  })
})

describe('files', () => {
  test('a file is its header, a blank line, then the body', () => {
    expect(renderFile(META, 'A → B')).toBe(
      '---\ntitle: Auth flow\nkind: diagram\nversion: 2\ncreated: 2026-10-15T21:02:11.000Z\nupdated: 2026-10-15T22:40:00.000Z\nbranch: artifacts\nsession: s-1\n---\n\nA → B\n',
    )
  })

  test('a header value keeps to one line', () => {
    expect(renderFile({ ...META, title: 'two\nlines' }, 'x')).toContain('title: two lines\n')
  })

  test('what renderFile writes, parseFile reads back', () => {
    const body = '```\n┌──┐\n└──┘\n```\n'
    expect(parseFile(META.id, renderFile(META, body), 0)).toEqual({ meta: META, body })
  })

  test("a title holding ': ' reads back whole", () => {
    const text = renderFile({ ...META, title: 'Plan: phase 2' }, 'x')
    expect(parseFile(META.id, text, 0).meta.title).toBe('Plan: phase 2')
  })

  test('an empty branch reads back empty', () => {
    expect(parseFile(META.id, renderFile({ ...META, branch: '' }, 'x'), 0).meta.branch).toBe('')
  })

  test('a file without a header: its name for a title, kind ?, version 1, its time for dates', () => {
    const { meta, body } = parseFile('notes-by-hand', '# Hand notes\n', Date.UTC(2026, 9, 1))
    expect(meta).toEqual({
      id: 'notes-by-hand', title: 'notes-by-hand', kind: '?', version: 1,
      created: '2026-10-01T00:00:00.000Z', updated: '2026-10-01T00:00:00.000Z', branch: '', session: '',
    })
    expect(body).toBe('# Hand notes\n')
  })
})

describe('the project folder', () => {
  test("the root's base name and 8 hex digits of its path's hash", async () => {
    const key = await projectKey('/Users/me/Projects/kintsugi')
    expect(key).toMatch(/^kintsugi-[0-9a-f]{8}$/)
    expect(await projectKey('/Users/me/Projects/kintsugi')).toBe(key)
  })

  test('two repos with one base name get different folders', async () => {
    expect(await projectKey('/a/kintsugi')).not.toBe(await projectKey('/b/kintsugi'))
  })
})

describe('lists', () => {
  const at = (id: string, updated: string, title = id, kind = 'notes'): ArtifactMeta => ({ ...META, id, title, kind, updated })
  const items = [at('a', '2026-10-14T10:00:00.000Z', 'Release plan', 'plan'), at('b', '2026-10-15T10:00:00.000Z', 'Auth flow', 'diagram')]

  test('newest update first', () => {
    expect(newestFirst(items).map(m => m.id)).toEqual(['b', 'a'])
  })

  test('the query matches title, kind or id, ignoring case; blank matches all', () => {
    expect(items.filter(m => matchesQuery(m, 'AUTH')).map(m => m.id)).toEqual(['b'])
    expect(items.filter(m => matchesQuery(m, 'plan')).map(m => m.id)).toEqual(['a'])
    expect(items.filter(m => matchesQuery(m, ' ')).length).toBe(2)
  })

  test('the list text names the folder, then one line per artifact', () => {
    expect(listText('~/.claude/artifacts/k-1', items, '', 20)).toBe(
      [
        '2 of 2 in ~/.claude/artifacts/k-1 (each <id>.md):',
        'b · diagram · v2 · 2026-10-15T10:00:00.000Z · Auth flow',
        'a · plan · v2 · 2026-10-14T10:00:00.000Z · Release plan',
      ].join('\n'),
    )
    expect(listText('~/x', items, 'zzz', 20)).toBe('no artifacts matching "zzz" in ~/x')
    expect(listText('~/x', items, '', 1).split('\n')).toHaveLength(2)
  })
})

describe('the show tool input', () => {
  test('title and body are required and trimmed; kind and id are optional', () => {
    expect(checkShow({ title: ' Auth flow ', body: 'x' })).toEqual({ title: 'Auth flow', body: 'x' })
    expect(checkShow({ title: 'T', body: 'x', kind: ' diagram ', id: 'i' })).toEqual({ title: 'T', body: 'x', kind: 'diagram', id: 'i' })
    expect(checkShow({ title: '', body: 'x' })).toEqual({ error: 'title is empty' })
    expect(checkShow({ title: 'T', body: '  ' })).toEqual({ error: 'body is empty' })
  })

  test('a body over 60,000 characters is refused, asking for a split', () => {
    const r = checkShow({ title: 'T', body: 'x'.repeat(60_001) })
    expect('error' in r && r.error).toMatch(/60,000 characters.*split/)
    expect(checkShow({ title: 'T', body: 'x'.repeat(60_000) })).not.toHaveProperty('error')
  })
})

describe('ages', () => {
  test('seconds, minutes, hours, then days', () => {
    expect(fmtAge(5_000)).toBe('5s')
    expect(fmtAge(125_000)).toBe('2m')
    expect(fmtAge(3 * 3_600_000)).toBe('3h')
    expect(fmtAge(50 * 3_600_000)).toBe('2d')
  })
})
