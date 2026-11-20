// Files a Bash call made: pure helpers for the one listing after the call, and for paths its command names.
import type { OutputFile } from '../types'

// Folders below the working directory never listed: every dot folder (.git, .venv, .pytest_cache, .next and the
// like), dependencies, build output and tool caches.
export const SKIP_DIRS = ['node_modules', 'target', 'dist', 'build', 'out', 'coverage', '__pycache__']
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

// One find: below the working directory (-mindepth 1, so the directory itself is never judged), prune folders
// that are dot folders, skipped or match an ignore glob, then print every regular file modified after the stamp.
// -type d keeps a file whose own name matches. POSIX primaries plus -mindepth, -newermt and -iname, which BSD
// and GNU find both have.
export const findArgv = (cwd: string, stamp: string, ignore: readonly string[]) => [
  'find', cwd, '-mindepth', '1',
  '-type', 'd', '(', '-name', '.*', ...SKIP_DIRS.flatMap(name => ['-o', '-name', name]),
  ...ignore.flatMap(glob => ['-o', '-iname', findGlob(glob)]), ')', '-prune',
  '-o', '-type', 'f', '-newermt', stamp, '-print',
]

// A path below the working directory inside a dot folder, a skipped folder or one matching an ignore glob, the
// same rule as the listing's: only the folders between the working directory and the file count.
export const isSkipped = (path: string, cwd: string, ignore: readonly RegExp[]) =>
  path.startsWith(`${cwd}/`) && path.slice(cwd.length + 1).split('/').slice(0, -1)
    .some(part => part.startsWith('.') || SKIP_DIRS.includes(part) || ignore.some(pattern => pattern.test(part)))

// Never listed: Finder's .DS_Store and editor swap and backup files (.x.swp, .x.swo, x~, .#x).
export const isJunk = (path: string) => {
  const name = path.split('/').pop() ?? path

  return name === '.DS_Store' || /^\..*\.sw[op]$/.test(name) || name.endsWith('~') || name.startsWith('.#')
}

// The listing's paths, or undefined for a failed listing. find exits 1 when a folder can't be read or a file
// vanished mid-walk while still printing the rest: those errors alone keep the output, any other loses it.
export const listedPaths = (ran: { exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean } | undefined) => {
  if (!ran || ran.isStdoutTruncated) return undefined
  const errors = ran.stderr.split('\n').filter(Boolean)
  const isPartial = ran.exitCode === 1 && errors.length > 0 &&
    errors.every(line => /: (Permission denied|No such file or directory)$/.test(line))
  if (ran.exitCode !== 0 && !isPartial) return undefined

  return ran.stdout.split('\n').filter(line => line.startsWith('/'))
}

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
