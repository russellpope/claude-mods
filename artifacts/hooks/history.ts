import type { EngineInterface } from 'claude-code'

import type { ArtifactMeta, Shown } from '../types'
import { DEFAULT_KIND, newId, parseFile, projectKey, renderFile } from './store'
import type { ShowArgs } from './store'

/** A refusal the show tool passes to the model as it is. */
export class ShowError extends Error {}

/** The project's history folder: `~/.claude/artifacts/<base name>-<hash>`, keyed by the main working tree. */
export async function historyDir($: EngineInterface): Promise<{ dir: string; project: string; home: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  if (!home) throw new ShowError('HOME is not set, so there is no ~/.claude/artifacts to keep the history in')
  const root = (await $.session.repo())?.root ?? (await $.session.root())
  return { dir: `${home}/.claude/artifacts/${await projectKey(root)}`, project: root.split('/').pop() || root, home }
}

export const tilde = (path: string, home: string): string => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

// Headers read once per file and time: the 5 s refresh re-reads only what changed.
const cache = new Map<string, { mtimeMs: number; meta: ArtifactMeta }>()

/** Every artifact in the folder, by its header; none when the folder doesn't exist yet. */
export async function readHistory($: EngineInterface, dir: string): Promise<ArtifactMeta[]> {
  if (!(await $.fs.exists(dir))) return []
  const entries = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
  return Promise.all(
    entries.map(async f => {
      const path = `${dir}/${f.name}`
      const hit = cache.get(path)
      if (hit && hit.mtimeMs === f.mtimeMs) return hit.meta
      const { meta } = parseFile(f.name.slice(0, -3), await $.fs.read(path), f.mtimeMs)
      cache.set(path, { mtimeMs: f.mtimeMs, meta })
      return meta
    }),
  )
}

/** One artifact for the reader: the latest version, or an earlier one from `.versions`. */
export async function readArtifact($: EngineInterface, dir: string, id: string, version?: number): Promise<Shown> {
  const latestPath = `${dir}/${id}.md`
  const latest = parseFile(id, await $.fs.read(latestPath), 0)
  if (version === undefined || version === latest.meta.version) return { ...latest, latest: latest.meta.version, path: latestPath }
  const path = `${dir}/.versions/${id}/v${version}.md`
  const old = parseFile(id, await $.fs.read(path), 0)
  return { ...old, latest: latest.meta.version, path }
}

/** The session checkout's branch; empty when git fails or HEAD is detached. */
export async function currentBranch($: EngineInterface): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', await $.session.root(), 'branch', '--show-current'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

/** Posts a new artifact, or with `args.id` a new version of one; answers its header. */
export async function post($: EngineInterface, dir: string, args: ShowArgs, now: number): Promise<ArtifactMeta> {
  const items = await readHistory($, dir)
  const iso = new Date(now).toISOString()
  const stamp = { updated: iso, branch: await currentBranch($), session: await $.session.id() }
  let meta: ArtifactMeta
  if (args.id) {
    const cur = items.find(m => m.id === args.id)
    if (!cur) throw new ShowError(`no artifact "${args.id}" in this project; mcp__artifacts__list shows the ids`)
    // fs has no rename: the version it replaces is copied as it stands, then overwritten.
    await $.fs.write(`${dir}/.versions/${cur.id}/v${cur.version}.md`, await $.fs.read(`${dir}/${cur.id}.md`))
    meta = { ...cur, ...stamp, title: args.title, kind: args.kind ?? cur.kind, version: cur.version + 1 }
  } else {
    const id = newId(args.title, now, new Set(items.map(m => m.id)))
    meta = { id, title: args.title, kind: args.kind ?? DEFAULT_KIND, version: 1, created: iso, ...stamp }
  }
  await $.fs.write(`${dir}/${meta.id}.md`, renderFile(meta, args.body))
  return meta
}

/** Copies the latest version into the session checkout's docs/artifacts/; answers the path written. */
export async function keepInRepo($: EngineInterface, dir: string, id: string): Promise<string> {
  const path = `${await $.session.root()}/docs/artifacts/${id}.md`
  await $.fs.write(path, await $.fs.read(`${dir}/${id}.md`))
  return path
}
