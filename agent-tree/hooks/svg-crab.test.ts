import { describe, expect, test } from 'claude-code/testing'

import { costumeOfRole, crabSvg, heroSvg } from './svg-crab'

describe('svg crabs', () => {
  test('role → savvy costume', () => {
    expect(costumeOfRole('lead')).toBe('medium')
    expect(costumeOfRole('reviewer')).toBe('heavy')
    expect(costumeOfRole('fixer')).toBe('careful')
    expect(costumeOfRole('implementer')).toBe('typist')
    expect(costumeOfRole('other', 'Explore')).toBe('explore')
    expect(costumeOfRole('research')).toBe('other')
  })

  test('a walking crab carries the run class; the hero sleeps without it', () => {
    expect(crabSvg('typist', true)).toContain('c-typist run')
    expect(crabSvg('heavy', false)).not.toContain(' run"')
    expect(heroSvg('asleep')).not.toContain(' run"')
    expect(heroSvg('typing')).toMatch(/^<svg [^>]*width="34" height="32"/)
  })
})
