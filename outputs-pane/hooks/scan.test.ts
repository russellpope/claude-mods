import { describe, expect, test } from 'claude-code/testing'

import { globList } from './globs'
import { birthArgv, findArgv, isSkipped, kindOf, namedPaths, parseBirths, stampOf } from './scan'

describe('stampOf', () => {
  test('the second before the call began, in UTC, as BSD and GNU find -newermt both read it under TZ=UTC', () => {
    // BSD find compares whole seconds and wants strictly newer: a file written at 06:52:51.4, in the call's
    // first second, is newer than 06:52:50 but not than 06:52:51 (seen live on macOS 26, 2026-11-18).
    expect(stampOf(Date.UTC(2026, 10, 19, 6, 52, 51, 900))).toBe('2026-11-19 06:52:50')
    expect(stampOf(Date.UTC(2026, 10, 19, 0, 0, 0, 0))).toBe('2026-11-18 23:59:59')
  })
})

describe('findArgv', () => {
  test('prunes the build and tool folders and the ignore globs, then lists files newer than the stamp', () => {
    expect(findArgv('/w/p', '2026-11-19 06:52:51', ['vendor', 'out*'])).toEqual([
      'find', '/w/p',
      '(', '-name', '.git', '-o', '-name', 'node_modules', '-o', '-name', 'target', '-o', '-name', 'dist',
      '-o', '-name', 'build', '-o', '-name', '.venv', '-o', '-name', '__pycache__', '-o', '-name', '.codegraph',
      '-o', '-iname', 'vendor', '-o', '-iname', 'out*', ')', '-prune',
      '-o', '-type', 'f', '-newermt', '2026-11-19 06:52:51', '-print',
    ])
  })

  test('a [ in an ignore glob is literal, as in the scratch setting', () => {
    expect(findArgv('/w', 's', ['a[1]'])).toContain('a\\[1]')
  })
})

describe('isSkipped', () => {
  test('a path inside a skipped or ignored folder is skipped, wherever that folder sits', () => {
    const ignore = globList('vendor*')
    expect(isSkipped('/w/p/node_modules/x/a.js', ignore)).toBe(true)
    expect(isSkipped('/w/p/Vendored/a.js', ignore)).toBe(true)
    expect(isSkipped('/w/p/.git/config', ignore)).toBe(true)
    expect(isSkipped('/w/p/src/vendor.rs', ignore)).toBe(false)
    expect(isSkipped('/w/p/src/a.rs', ignore)).toBe(false)
  })
})

describe('namedPaths', () => {
  test('absolute and ~ paths in the command text, quoted ones whole, ~ expanded; relative ones are left to the scan', () => {
    const command = `python3 make.py --out=/tmp/s/deck.pptx && cp ~/x/a.mp4 "/Users/me/Movies/b c.mp4" out/ ; ffmpeg -i a.mov '/tmp/s/v.webm' 2>/dev/null | tee ~/log.txt`
    expect(namedPaths(command, '/Users/me')).toEqual([
      '/tmp/s/deck.pptx', '/Users/me/x/a.mp4', '/Users/me/Movies/b c.mp4', '/tmp/s/v.webm', '/dev/null', '/Users/me/log.txt',
    ])
  })

  test('no home leaves ~ paths out; a URL is not a path', () => {
    expect(namedPaths('cp ~/a /b; curl https://x.dev/c', '')).toEqual(['/b'])
  })
})

describe('birthArgv', () => {
  test('BSD stat on macOS, GNU stat on Linux, nothing elsewhere', () => {
    expect(birthArgv('macos', ['/a', '/b c'])).toEqual(['stat', '-f', '%B %N', '/a', '/b c'])
    expect(birthArgv('linux', ['/a'])).toEqual(['stat', '-c', '%W %n', '/a'])
    expect(birthArgv('wsl', ['/a'])).toEqual(['stat', '-c', '%W %n', '/a'])
    expect(birthArgv('windows', ['/a'])).toBeUndefined()
    expect(birthArgv(undefined, ['/a'])).toBeUndefined()
  })
})

describe('parseBirths', () => {
  test('seconds per path; 0 or - means the platform cannot tell', () => {
    const births = parseBirths('1795071159 /w/a b.pptx\n0 /w/c\n- /w/d\n')
    expect(births.get('/w/a b.pptx')).toBe(1795071159000)
    expect(births.get('/w/c')).toBeUndefined()
    expect(births.has('/w/c')).toBe(false)
    expect(births.has('/w/d')).toBe(false)
  })
})

describe('kindOf', () => {
  test('born at or after the stamp is new, before is edit; unknown is new unless already listed', () => {
    expect(kindOf(2000, 2000, undefined)).toBe('new')
    expect(kindOf(1000, 2000, undefined)).toBe('edit')
    expect(kindOf(undefined, 2000, undefined)).toBe('new')
    expect(kindOf(undefined, 2000, 'edit')).toBe('edit')
    expect(kindOf(undefined, 2000, 'new')).toBe('new')
  })
})
