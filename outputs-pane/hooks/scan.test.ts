import { describe, expect, test } from 'claude-code/testing'

import { globList } from './globs'
import { birthArgv, findArgv, isJunk, isSkipped, kindOf, listedPaths, namedPaths, parseBirths, stampOf } from './scan'

describe('stampOf', () => {
  test('the second before the call began, in UTC, as BSD and GNU find -newermt both read it under TZ=UTC', () => {
    // BSD find compares whole seconds and wants strictly newer: a file written at 06:52:51.4, in the call's
    // first second, is newer than 06:52:50 but not than 06:52:51 (seen live on macOS 26, 2026-11-18).
    expect(stampOf(Date.UTC(2026, 10, 19, 6, 52, 51, 900))).toBe('2026-11-19 06:52:50')
    expect(stampOf(Date.UTC(2026, 10, 19, 0, 0, 0, 0))).toBe('2026-11-18 23:59:59')
  })
})

describe('findArgv', () => {
  test('below the working directory only, prunes folders (dot folders, build and tool folders, ignore globs), then lists newer files', () => {
    expect(findArgv('/w/p', '2026-11-19 06:52:51', ['vendor', 'out*'])).toEqual([
      'find', '/w/p', '-mindepth', '1',
      '-type', 'd', '(', '-name', '.*', '-o', '-name', 'node_modules', '-o', '-name', 'target', '-o', '-name', 'dist',
      '-o', '-name', 'build', '-o', '-name', 'out', '-o', '-name', 'coverage', '-o', '-name', '__pycache__',
      '-o', '-iname', 'vendor', '-o', '-iname', 'out*', ')', '-prune',
      '-o', '-type', 'f', '-newermt', '2026-11-19 06:52:51', '-print',
    ])
  })

  test('a [ in an ignore glob is literal, as in the scratch setting', () => {
    expect(findArgv('/w', 's', ['a[1]'])).toContain('a\\[1]')
  })
})

describe('isSkipped', () => {
  test('judged on the folders below the working directory, never its ancestors', () => {
    const ignore = globList('vendor*, out*')
    expect(isSkipped('/Users/x/build/proj/src/a.ts', '/Users/x/build/proj', [])).toBe(false)
    expect(isSkipped('/Users/x/outreach/src/a.ts', '/Users/x/outreach', ignore)).toBe(false)
    expect(isSkipped('/w/p/node_modules/x/a.js', '/w/p', ignore)).toBe(true)
    expect(isSkipped('/w/p/Vendored/a.js', '/w/p', ignore)).toBe(true)
    expect(isSkipped('/w/p/.pytest_cache/v/cache/lastfailed', '/w/p', ignore)).toBe(true)
    expect(isSkipped('/w/p/coverage/lcov.info', '/w/p', ignore)).toBe(true)
  })

  test('a file whose own name matches is not skipped: ignore names folders', () => {
    const ignore = globList('vendor*, out*')
    expect(isSkipped('/w/p/src/vendor.rs', '/w/p', ignore)).toBe(false)
    expect(isSkipped('/w/p/sub/output.pdf', '/w/p', ignore)).toBe(false)
    expect(isSkipped('/w/p/.env', '/w/p', ignore)).toBe(false)
  })
})

describe('isJunk', () => {
  test('.DS_Store and editor swap and backup files are never listed', () => {
    for (const path of ['/w/.DS_Store', '/w/src/.main.rs.swp', '/w/.a.swo', '/w/notes.md~', '/w/.#main.rs'])
      expect([path, isJunk(path)]).toEqual([path, true])
    for (const path of ['/w/.env', '/w/a.swp', '/w/main.rs', '/w/.gitignore'])
      expect([path, isJunk(path)]).toEqual([path, false])
  })
})

describe('listedPaths', () => {
  test('exit 0 keeps the output', () => {
    expect(listedPaths({ exitCode: 0, stdout: '/w/a\n/w/b\n', stderr: '' })).toEqual(['/w/a', '/w/b'])
  })

  test('exit 1 whose errors are only unreadable or vanished paths keeps the output', () => {
    const stderr = 'find: /w/locked: Permission denied\nfind: /w/tmp/x: No such file or directory\n'
    expect(listedPaths({ exitCode: 1, stdout: '/w/a\n', stderr })).toEqual(['/w/a'])
  })

  test('any other failure lists nothing', () => {
    expect(listedPaths({ exitCode: 1, stdout: '/w/a\n', stderr: 'find: -newermt: bad date\n' })).toBeUndefined()
    expect(listedPaths({ exitCode: 1, stdout: '/w/a\n', stderr: 'find: /w/l: Permission denied\nfind: oops\n' })).toBeUndefined()
    expect(listedPaths({ exitCode: 1, stdout: '/w/a\n', stderr: '' })).toBeUndefined()
    expect(listedPaths({ exitCode: 2, stdout: '/w/a\n', stderr: 'find: /w/l: Permission denied\n' })).toBeUndefined()
    expect(listedPaths({ exitCode: 0, stdout: '/w/a\n', stderr: '', isStdoutTruncated: true })).toBeUndefined()
    expect(listedPaths(undefined)).toBeUndefined()
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
