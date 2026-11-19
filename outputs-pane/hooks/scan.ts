// Files a Bash call made: pure helpers for the one listing after the call, and for paths its command names.
import type { OutputFile } from '../types'

// Folders never listed: version control, dependencies, build output, tool caches.
export const SKIP_DIRS = ['.git', 'node_modules', 'target', 'dist', 'build', '.venv', '__pycache__', '.codegraph']
// More changed files than this in one call is a build: the listing adds none of them.
export const SCAN_CAP = 50
// The listing's budget; a slower one lists nothing.
export const SCAN_TIMEOUT_MS = 2000

// The second before the call began, in UTC, as `YYYY-MM-DD HH:MM:SS`: the one -newermt spelling that BSD find
// (macOS) and GNU find both read; run under TZ=UTC so both read it as UTC. BSD find misreads an ISO `T`.
// BSD find compares whole seconds and wants strictly newer, so a stamp of the call's own second would miss a
// file written in that second; GNU find compares finer, so it may also list one written up to a second before.
export const stampOf = (ms: number) => new Date((Math.floor(ms / 1000) - 1) * 1000).toISOString().slice(0, 19).replace('T', ' ')

// find's -iname takes [ as a class; the settings' globs take it literally.
const findGlob = (glob: string) => glob.replace(/\[/g, '\\[')

// One find: prune the skipped folders and the ignore globs by name, then print every regular file modified
// after the stamp. Only POSIX find primaries plus -newermt and -iname, which BSD and GNU find both have.
export const findArgv = (cwd: string, stamp: string, ignore: readonly string[]) => [
  'find', cwd,
  '(', ...SKIP_DIRS.flatMap((name, i) => [...(i ? ['-o'] : []), '-name', name]),
  ...ignore.flatMap(glob => ['-o', '-iname', findGlob(glob)]), ')', '-prune',
  '-o', '-type', 'f', '-newermt', stamp, '-print',
]

// A path inside a skipped folder or one matching an ignore glob; the file's own name is not checked.
export const isSkipped = (path: string, ignore: readonly RegExp[]) =>
  path.split('/').slice(0, -1).some(part => SKIP_DIRS.includes(part) || ignore.some(pattern => pattern.test(part)))

// Absolute and ~ paths in the command text: quoted ones whole, bare ones up to a space or shell operator.
// Relative paths are left to the listing of the working directory.
const NAMED = /"((?:~|\/)[^"]*)"|'((?:~|\/)[^']*)'|(?:^|[\s=<>|;&(])((?:~\/|\/)[^\s'"`;|&<>()]*)/g

export const namedPaths = (command: string, home: string) =>
  [...command.matchAll(NAMED)].map(match => match[1] ?? match[2] ?? match[3] ?? '')
    .flatMap(path => path.startsWith('~/') ? (home ? [home + path.slice(1)] : []) : path.startsWith('/') ? [path] : [])
    .filter((path, i, all) => path.length > 1 && all.indexOf(path) === i)

// Birth times in seconds, one `<seconds> <path>` line per file: BSD stat on macOS, GNU stat on Linux.
// Other platforms cannot tell.
export const birthArgv = (platform: string | undefined, paths: readonly string[]) =>
  platform === 'macos' ? ['stat', '-f', '%B %N', ...paths]
    : platform === 'linux' || platform === 'wsl' ? ['stat', '-c', '%W %n', ...paths]
      : undefined

// Births by path in milliseconds; GNU stat prints 0 (or - in older builds) where the file system keeps none.
export const parseBirths = (text: string) => {
  const births = new Map<string, number>()
  for (const line of text.split('\n')) {
    const cut = line.indexOf(' ')
    const seconds = Number(line.slice(0, cut))
    if (cut > 0 && Number.isFinite(seconds) && seconds > 0) births.set(line.slice(cut + 1), seconds * 1000)
  }

  return births
}

// Made during the call is new, existing before is edit. Unknown: a file the pane lists keeps its kind,
// any other is new.
export const kindOf = (birthMs: number | undefined, stampMs: number, listed: OutputFile['kind'] | undefined): OutputFile['kind'] =>
  birthMs !== undefined ? (birthMs >= stampMs ? 'new' : 'edit') : listed ?? 'new'
