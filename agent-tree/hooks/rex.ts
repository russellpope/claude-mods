import type { AgentStatus, HerdrAgent } from '../types'

// Rex has no agent list. One `rex do` script reads every terminal block in every session, on this
// server and on each host `rex hosts` lists: the status the program reports (OSC 7501), its
// foreground process, its title, and each window's label. A host that does not answer is skipped.
export const LIST_SCRIPT = `
local out = { panes = {}, windows = {}, down = {} }
local function gather(api, server)
  local sl = api.call("session.list")
  for _, s in ipairs(sl and sl.sessions or {}) do
    api.call("session.attach", { session_id = s.session_id })
    local v = api.call("session.view", { session_id = s.session_id })
    for _, w in ipairs(v and v.windows or {}) do
      if w.window_id and w.label then out.windows[w.window_id] = w.label end
    end
    local bl = api.call("session.list_blocks", { session_id = s.session_id })
    for _, b in ipairs(bl and bl.blocks or {}) do
      if b.creator_name == "com.superlogical.terminal" then
        local p = { server = server, session = s.session_id, window = b.window_id, block = b.block_id, label = b.label, owner = b.owner }
        for _, m in ipairs({ "program_status", "process", "title" }) do
          p[m] = api.call("block.method", { session_id = s.session_id, block_id = b.block_id, method = m, args = {} })
        end
        out.panes[#out.panes + 1] = p
      end
    end
  end
end
gather(rex, nil)
for _, label in ipairs(rex.servers() or {}) do
  local ok = pcall(function() gather(rex.server(label), label) end)
  if not ok then out.down[#out.down + 1] = label end
end
return out
`

export const LIST_ARGV = ['rex', 'do', '-e', LIST_SCRIPT, '--json']

type Record7501 = { id?: string; state?: string; app?: string }
type RawPane = {
  server?: string
  session?: string
  window?: string
  block?: string
  label?: string
  owner?: string
  program_status?: { records?: Record7501[] | Record<string, never> }
  process?: { foreground?: { pid?: number; name?: string; cwd?: string } }
  title?: { title?: string }
}

// Harnesses that report no status are still agents when they run in the foreground.
const KNOWN = ['claude', 'codex', 'opencode']
const STATUSES: readonly AgentStatus[] = ['idle', 'working', 'blocked', 'done']
const SIGNAL = /^(DONE|BLOCKED):/i

const harnessOf = (app: string, fg: string): string => (app === 'claude-code' ? 'claude' : app || (KNOWN.includes(fg) ? fg : ''))

// 'error' is a failed program: it needs you, as blocked does. Unknown states read as idle, as the protocol asks.
const statusOf = (state: string | undefined): AgentStatus =>
  state === undefined ? 'unknown' : state === 'error' ? 'blocked' : STATUSES.includes(state as AgentStatus) ? (state as AgentStatus) : 'idle'

/**
 * A block's label is both its name and, once a worker sets `DONE: …` or `BLOCKED: …`, its title:
 * Rex keeps one label per block where herdr keeps an agent name and a metadata title.
 */
export const toAgent = (p: RawPane): HerdrAgent | null => {
  // Through Lua an empty list comes back as {}.
  const records = Array.isArray(p.program_status?.records) ? p.program_status.records : []
  const rec = records.find(r => !r.id) ?? records.find(r => r.app)
  const fg = p.process?.foreground
  const harness = harnessOf(rec?.app ?? '', fg?.name ?? '')
  if (!p.block || !harness) return null
  const label = p.label ?? ''
  const isSignal = SIGNAL.test(label)
  return {
    pane: p.block,
    name: isSignal || label === 'shell' ? '' : label,
    harness,
    status: statusOf(rec?.state),
    title: isSignal ? label : '',
    label: p.title?.title ?? '',
    cwd: fg?.cwd ?? '',
    workspace: p.session ?? '',
    session: '',
    // A new process in the block is a new agent, as a new herdr terminal is.
    terminal: fg?.pid ? `${p.block}#${fg.pid}` : p.block,
    tab: p.window ?? '',
    ...(p.server ? { server: p.server } : {}),
  }
}

export type RexList = { agents: HerdrAgent[]; labels: Record<string, string>; owners: Record<string, string>; names: Record<string, string>; down: string[] }

/** The list script's stdout → agents, window labels, and each block's owning client and label. Throws on anything else. */
export const parseRexList = (stdout: string): RexList => {
  const o = JSON.parse(stdout) as { panes?: RawPane[] | Record<string, never>; windows?: Record<string, string> | unknown[]; down?: string[] | Record<string, never> } | null
  if (!o || typeof o !== 'object' || !('panes' in o)) throw new Error('not a rex pane list')
  // Lua encodes an empty table as {}, so an empty list or map may arrive as either.
  const panes = Array.isArray(o.panes) ? o.panes : []
  const labels = o.windows && !Array.isArray(o.windows) ? o.windows : {}
  const owners: Record<string, string> = Object.fromEntries(panes.flatMap(p => (p.block && p.owner ? [[p.block, p.owner]] : [])))
  const names: Record<string, string> = Object.fromEntries(panes.flatMap(p => (p.block && p.label && p.label !== 'shell' ? [[p.block, p.label]] : [])))
  const down = Array.isArray(o.down) ? o.down.filter((d): d is string => typeof d === 'string') : []
  return { agents: panes.flatMap(p => toAgent(p) ?? []), labels, owners, names, down }
}

/**
 * A block keeps the name it had before its label became `DONE: …` or `BLOCKED: …`, so rows and
 * dings stay named. `known` maps each agent's terminal to its last name and is updated in place.
 */
export const keepNames = (agents: HerdrAgent[], known: Map<string, string>): HerdrAgent[] =>
  agents.map(a => {
    if (a.name) known.set(a.terminal, a.name)
    const name = known.get(a.terminal)
    return a.name || !name ? a : { ...a, name }
  })

/** The pid behind a Rex agent's `terminal`; NaN for a herdr terminal or a block with no process. */
export const pidOf = (a: HerdrAgent): number => Number(/#(\d+)$/.exec(a.terminal)?.[1] ?? NaN)

/** `~/.claude/sessions/<pid>.json` → the session id Claude Code is running. */
export const parseClaudeSessionFile = (text: string): string => {
  try {
    const id = (JSON.parse(text) as { sessionId?: unknown }).sessionId
    return typeof id === 'string' ? id : ''
  } catch {
    return ''
  }
}

// codex logs each line with process_uuid `pid:<pid>:<uuid>` and the thread it belongs to; the
// thread id is the session id herdr reports and the rollout file's name ends in.
export const CODEX_THREAD_ARGV = (home: string, pid: number): string[] => [
  '/bin/sh',
  '-c',
  'for db in "$1"/.codex*/logs_*.sqlite; do [ -f "$db" ] && sqlite3 -readonly "$db" "select thread_id from logs where process_uuid like \'pid:$2:%\' and thread_id is not null order by id desc limit 1" 2>/dev/null; done | head -n 1',
  'sh',
  home,
  String(pid),
]

const REX_SPAWN = /(?:^|[;&|(`\n]|\$\(|\b(?:if|then|do|else|time|exec)\s)\s*rex\s+(?:-\S+\s+(?:\S+\s+)?)*(?:run|split|new|window\s+new|send(?!-))\b/
// The team skills' helper (deepthought skills/lib/rex-team.sh), known by its verb and first argument,
// a session (a variable or a session id), since a lead may call it through any name: a path, a
// variable, an alias. A false match costs only an agent list before and after.
const HELPER_SPAWN = /\b(?:spawn|prompt)\s+["']?(?:\$\{?\w+\}?|session:)/

/**
 * True when a `rex` command can start an agent: it creates a block (`rex run|split|new|window new`,
 * or the team helper's `spawn`) or types into one (`rex send`, the helper's `prompt`). What runs
 * there may come from a variable or a script, so the agent list before and after the call decides
 * which agents are new.
 */
export const invokesRexSpawn = (command: string): boolean => REX_SPAWN.test(command) || HELPER_SPAWN.test(command)

/**
 * True when the command names an agent harness: a block it printed is then recorded even before
 * its agent shows. Quoted text counts: Rex takes the command to run as words, often a quoted `sh -c`.
 */
export const namesHarness = (command: string): boolean => /\b(?:claude|codex|opencode)\b/.test(command)

/** Every block a `rex run|split|new|window new` printed: `block_ids` in its JSON, or a bare id on a line. */
export const parseRexStarted = (stdout: string): string[] => {
  const ids = new Set<string>()
  for (const m of stdout.matchAll(/"block_ids"\s*:\s*\[([^\]]*)\]/g)) for (const id of (m[1] ?? '').match(/block:[0-9a-f-]+/g) ?? []) ids.add(id)
  for (const line of stdout.split('\n')) if (/^block:[0-9a-f-]+$/.test(line.trim())) ids.add(line.trim())
  return [...ids]
}

/**
 * Focus a block in its session, on its own server, then ask the app showing `root` to show that
 * session and window. The app is a client of this server, so a remote block's session is selected there
 * only if the app is connected to that host too.
 */
export const focusArgvs = (target: HerdrAgent, client: string): string[][] => {
  const server = target.server ? ['-S', target.server] : []
  // `client` is a client id on this server: another host knows the app by another id.
  const app = client && !target.server ? ['-C', client] : []
  return [
    ['rex', ...server, 'api', 'call', '-s', target.workspace, 'session.focus_block', JSON.stringify({ session_id: target.workspace, block_id: target.pane })],
    ['rex', ...server, ...app, 'do', 'session.select', `session_id=${target.workspace}`, ...(target.tab ? [`window_id=${target.tab}`] : [])],
  ]
}
