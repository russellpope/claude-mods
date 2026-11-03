import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { iconFor } from './icons'
import { editorArgv, matches, ownerLabel, remember, scratchPatterns, sectionOf, shorten, splitPath, viewerArgv } from './register'

describe('remember', () => {
  test('newest first, deduped, created files stay new', () => {
    let list = remember([], '/w/a.md', 'new', 1)
    list = remember(list, '/w/b.rs', 'edit', 2)
    list = remember(list, '/w/a.md', 'edit', 3)
    expect(list.map(f => [f.path, f.kind])).toEqual([['/w/a.md', 'new'], ['/w/b.rs', 'edit']])
  })
})

describe('shorten', () => {
  test('relative to cwd, then ~, else absolute', () => {
    expect(shorten('/home/me/other/y.rs', '/home/me/p', '/home/me')).toBe('~/other/y.rs')
    expect(shorten('/Users/me/p/docs/x.md', '/Users/me/p', '/Users/me')).toBe('docs/x.md')
    expect(shorten('/Users/me/other/y.rs', '/Users/me/p', '/Users/me')).toBe('~/other/y.rs')
    expect(shorten('/tmp/z.txt', '/Users/me/p', '/Users/me')).toBe('/tmp/z.txt')
  })
})

describe('iconFor', () => {
  test('by special name, then extension, else the plain file glyph', () => {
    expect(iconFor('/w/Cargo.toml').glyph).toBe('')
    expect(iconFor('/w/notes.MD').glyph).toBe('')
    expect(iconFor('/w/README').glyph).toBe('')
    expect(iconFor('/w/mystery.xyz').glyph).toBe('')
    expect(iconFor('/w/.env').glyph).toBe('')
  })
})

describe('splitPath', () => {
  test('dir keeps its trailing slash; a bare name has none', () => {
    expect(splitPath('docs/specs/plan.md')).toEqual({ dir: 'docs/specs/', name: 'plan.md' })
    expect(splitPath('plan.md')).toEqual({ dir: '', name: 'plan.md' })
  })
})

describe('editorArgv', () => {
  test('the setting is a command line with the path last; blank falls back to zed', () => {
    expect(editorArgv('code -r', '/w/a.md')).toEqual(['code', '-r', '/w/a.md'])
    expect(editorArgv('  /usr/local/bin/zed ', '/w/a.md')).toEqual(['/usr/local/bin/zed', '/w/a.md'])
    expect(editorArgv('', '/w/a.md')).toEqual(['zed', '/w/a.md'])
    expect(editorArgv(undefined, '/w/a.md')).toEqual(['zed', '/w/a.md'])
  })
})

describe('sections', () => {
  test('markdown and text are planning; the rest is code', () => {
    expect(sectionOf('/w/docs/plan.md')).toBe('planning')
    expect(sectionOf('/w/NOTES.TXT')).toBe('planning')
    expect(sectionOf('/w/src/main.rs')).toBe('code')
    expect(sectionOf('/w/README')).toBe('code')
  })

  test('a name matching a scratch pattern is scratch, whatever its extension or folder', () => {
    const scratch = scratchPatterns('msg-*')
    expect(sectionOf('/Users/me/gate-logs/msg-merge-p2a.txt', scratch)).toBe('scratch')
    expect(sectionOf('/w/.superpowers/sdd/MSG-PKG.TXT', scratch)).toBe('scratch')
    expect(sectionOf('/w/msg-notes/plan.md', scratch)).toBe('planning')
    expect(sectionOf('/w/src/main.rs', scratch)).toBe('code')
  })
})

describe('scratchPatterns', () => {
  test('a comma-separated list of globs; * and ? are wildcards, the rest is literal', () => {
    const scratch = scratchPatterns('msg-*, v?.log')
    expect(sectionOf('/w/v1.log', scratch)).toBe('scratch')
    expect(sectionOf('/w/v12.log', scratch)).toBe('code')
    expect(sectionOf('/w/v1xlog', scratch)).toBe('code')
  })

  test('blank means no scratch; unset means the default msg-*', () => {
    expect(sectionOf('/w/msg-a.txt', scratchPatterns(''))).toBe('planning')
    expect(sectionOf('/w/msg-a.txt', scratchPatterns(undefined))).toBe('scratch')
  })
})

describe('matches', () => {
  test('the shown path holds the query, ignoring case and spaces around it; blank matches all', () => {
    expect(matches('docs/I343-plan.md', 'i343')).toBe(true)
    expect(matches('~/gate-logs/msg-a.txt', ' gate-logs ')).toBe(true)
    expect(matches('src/main.rs', 'plan')).toBe(false)
    expect(matches('src/main.rs', '  ')).toBe(true)
  })
})

describe('pane', () => {
  test('a written file shows up and a click opens it in zed', async ($, on) => {
    const ran: string[][] = []
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('process.run', (_$, e) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
    on('ui.toast', () => ({ value: undefined }))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/docs/plan.md', content: '# hi' })

    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    expect(await ui.findAll({ type: 'Button', text: 'plan.md' })).toHaveLength(1)

    await ui.press({ key: 'open:/Users/me/p/docs/plan.md' })
    expect(ran).toEqual([['zed', '/Users/me/p/docs/plan.md']])
  })

  test('a successful Write pops the pane open; an Edit does not', async ($, on) => {
    const opened: string[] = []
    on('tool.call', () => ({ result: 'ok' } as never))
    on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } as never })

    await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/w/a.rs', old_string: 'a', new_string: 'b' } as never)
    expect(opened).toEqual([])

    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/w/notes.md', content: '# n' })
    expect(opened).toEqual(['outputs'])
  })

  test('a failed Write does not pop the pane', async ($, on) => {
    const opened: string[] = []
    on('tool.call', () => ({ result: 'boom', isError: true } as never))
    on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } as never })

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/w/bad.md', content: '' })
    expect(opened).toEqual([])
  })

  test('clicking a section header folds it and clicking again unfolds it', async ($, on) => {
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/docs/plan.md', content: '# p' })
    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/Users/me/p/src/main.rs', content: 'fn main() {}' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    expect(await ui.findAll({ type: 'Button', text: 'plan.md' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Button', text: 'main.rs' })).toHaveLength(1)

    await ui.press({ key: 'fold:planning' })
    expect(await ui.findAll({ type: 'Button', text: 'plan.md' })).toHaveLength(0)
    expect(await ui.findAll({ type: 'Button', text: 'main.rs' })).toHaveLength(1)

    await ui.press({ key: 'fold:planning' })
    expect(await ui.findAll({ type: 'Button', text: 'plan.md' })).toHaveLength(1)
  })

  test('the editor setting decides what a click runs', { options: { editor: 'code -r' } }, async ($, on) => {
    const ran: string[][] = []
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))
    on('process.run', (_$, e) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
    on('ui.toast', () => ({ value: undefined }))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/x.rs', content: 'x' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    await ui.press({ key: 'open:/Users/me/p/x.rs' })
    expect(ran).toEqual([['code', '-r', '/Users/me/p/x.rs']])
  })

  test('a scratch file lands in a scratch section that starts folded', async ($, on) => {
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/gate-logs/msg-merge.txt', content: 'm' })
    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/Users/me/p/notes.txt', content: 'n' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    expect(await ui.findAll({ type: 'Button', text: 'notes.txt' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Button', text: 'msg-merge.txt' })).toHaveLength(0)

    await ui.press({ key: 'fold:scratch' })
    expect(await ui.findAll({ type: 'Button', text: 'msg-merge.txt' })).toHaveLength(1)
  })

  test('the scratch setting decides what counts as scratch', { options: { scratch: '*.log' } }, async ($, on) => {
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/gate.log', content: 'g' })
    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/Users/me/p/msg-a.txt', content: 'm' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    expect(await ui.findAll({ type: 'Button', text: 'gate.log' })).toHaveLength(0)
    expect(await ui.findAll({ type: 'Button', text: 'msg-a.txt' })).toHaveLength(1)
  })

  test('every file is drawn, with no cut-off, however short the pane', async ($, on) => {
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))

    for (let i = 0; i < 30; i++) {
      await $.tool.call({ tool: 'Write', tool_use_id: `t${i}`, file_path: `/Users/me/p/src/f${i}.rs`, content: 'x' })
    }
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs', viewport: { columns: 36, rows: 12 } } as never)
    const rows = (await ui.findAll({ type: 'Button' })).filter(found => found.key?.startsWith('open:'))
    expect(rows).toHaveLength(30)
    expect(await ui.findAll({ text: /more/ })).toHaveLength(0)
  })

  test('typing in the filter narrows the list and counts the matches', async ($, on) => {
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))
    on('ui.scroll', () => ({ value: {} } as never))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/docs/I343-plan.md', content: '# p' })
    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/Users/me/p/src/main.rs', content: 'fn main() {}' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })

    await ui.input({ key: 'filter', text: 'i343', kind: 'change' })
    expect(await ui.findAll({ type: 'Button', text: 'I343-plan.md' })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Button', text: 'main.rs' })).toHaveLength(0)
    expect(await ui.findAll({ text: '1 of 2' })).not.toHaveLength(0)

    await ui.input({ key: 'filter', text: '', kind: 'change' })
    expect(await ui.findAll({ type: 'Button', text: 'main.rs' })).toHaveLength(1)
  })

  test('Enter in the filter opens the first match', async ($, on) => {
    const ran: string[][] = []
    on('tool.call', () => ({ result: 'ok' } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))
    on('ui.open', () => ({ value: { isPlaced: true } } as never))
    on('ui.scroll', () => ({ value: {} } as never))
    on('process.run', (_$, e) => { ran.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
    on('ui.toast', () => ({ value: undefined }))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/docs/plan.md', content: '# p' })
    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/Users/me/p/src/main.rs', content: 'fn main() {}' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })

    await ui.input({ key: 'filter', text: 'MAIN' })
    expect(ran).toEqual([['zed', '/Users/me/p/src/main.rs']])
  })

  test('a failed write is not listed', async ($, on) => {
    on('tool.call', () => ({ result: 'boom', isError: true } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/bad.md', content: '' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    expect(await ui.findAll({ type: 'Button', text: 'bad.md' })).toHaveLength(0)
  })
})

describe('viewerArgv', () => {
  test('planning files get the markdown viewer, the rest the code viewer; blank falls back to glow and bat', () => {
    expect(viewerArgv({}, '/w/plan.md')).toEqual(['glow', '-p', '/w/plan.md'])
    expect(viewerArgv({}, '/w/main.rs')).toEqual(['bat', '--paging=always', '/w/main.rs'])
    expect(viewerArgv({ markdownViewer: ' mdcat ', codeViewer: 'nvim -R' }, '/w/notes.txt')).toEqual(['mdcat', '/w/notes.txt'])
    expect(viewerArgv({ markdownViewer: ' mdcat ', codeViewer: 'nvim -R' }, '/w/main.rs')).toEqual(['nvim', '-R', '/w/main.rs'])
    expect(viewerArgv({ codeViewer: '' }, '/w/main.rs')).toEqual(['bat', '--paging=always', '/w/main.rs'])
  })
})

const VIEW = JSON.stringify({ windows: [{ blocks: [{ block_id: 'block:other', owner: 'client:near' }, { block_id: 'block:me', owner: 'client:far' }] }] })
const CLIENTS = JSON.stringify({ clients: [{ client_id: 'client:near', info: { label: 'Here' } }, { client_id: 'client:far', info: { label: 'Mac15' } }] })

describe('ownerLabel', () => {
  test('the label of the app owning the block; unowned, unknown or garbled means none', () => {
    expect(ownerLabel(VIEW, CLIENTS, 'block:me')).toBe('Mac15')
    expect(ownerLabel(VIEW, CLIENTS, 'block:other')).toBe('Here')
    expect(ownerLabel(VIEW, CLIENTS, 'block:gone')).toBeUndefined()
    expect(ownerLabel(VIEW, JSON.stringify({ clients: [] }), 'block:me')).toBeUndefined()
    expect(ownerLabel('not json', CLIENTS, 'block:me')).toBeUndefined()
  })
})

type Rex = { view?: string; machine?: string; isRexDown?: boolean; inRex?: boolean }

// A pane in a Rex session whose Claude pane (block:me) is owned by the app labelled Mac15.
const rexPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], rex: Rex = {}) => {
  const ran: string[][] = []
  let splits = 0
  const env: Record<string, string> = rex.inRex === false ? {} : { REX_SESSION: 'session:s', REX_BLOCK: 'block:me' }
  on('tool.call', () => ({ result: 'ok' } as never))
  on('session.cwd', () => ({ value: '/Users/me/p' }))
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: env[e.name] }) as never)
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } } as never)
    if (argv[0] === 'scutil') return answer(`${rex.machine ?? 'Here'}\n`)
    if (argv[0] !== 'rex') return answer('')
    if (rex.isRexDown) return answer('', 1)
    if (argv[1] === 'api') return answer(rex.view ?? VIEW)
    if (argv[1] === 'client') return answer(CLIENTS)
    if (argv[1] === 'split') return answer(JSON.stringify({ block_ids: [`block:viewer${++splits}`] }))
    return answer('')
  })

  await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/docs/plan.md', content: '# p' })
  await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/Users/me/p/src/main.rs', content: 'fn main() {}' })
  const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
  // What a click ran, without the lookups that decided it.
  const opened = () => ran.filter(argv => !(argv[0] === 'scutil' || (argv[0] === 'rex' && (argv[1] === 'api' || argv[1] === 'client'))))

  return { ui, opened }
}

describe('rex', () => {
  test('a click from another machine opens a viewer split right of Claude, glow for planning and bat for code', async ($, on) => {
    const { ui, opened } = await rexPane($, on)

    await ui.press({ key: 'open:/Users/me/p/docs/plan.md' })
    expect(opened()).toEqual([
      ['rex', 'split', '-s', 'session:s', '-b', 'block:me', '--split=right', '--label', 'plan.md', '--json', '--', 'glow', '-p', '/Users/me/p/docs/plan.md'],
    ])

    await ui.press({ key: 'open:/Users/me/p/src/main.rs' })
    expect(opened().slice(1)).toEqual([
      ['rex', 'block', 'close', '-s', 'session:s', 'block:viewer1'],
      ['rex', 'split', '-s', 'session:s', '-b', 'block:me', '--split=right', '--label', 'main.rs', '--json', '--', 'bat', '--paging=always', '/Users/me/p/src/main.rs'],
    ])
  })

  test('a click from this machine opens the editor', async ($, on) => {
    const { ui, opened } = await rexPane($, on, { machine: 'Mac15' })

    await ui.press({ key: 'open:/Users/me/p/docs/plan.md' })
    expect(opened()).toEqual([['zed', '/Users/me/p/docs/plan.md']])
  })

  test('outside Rex a click opens the editor without asking Rex anything', async ($, on) => {
    const { ui, opened } = await rexPane($, on, { inRex: false })

    await ui.press({ key: 'open:/Users/me/p/docs/plan.md' })
    expect(opened()).toEqual([['zed', '/Users/me/p/docs/plan.md']])
  })

  test('when Rex cannot say who owns the pane, a click opens the editor', async ($, on) => {
    const unowned = await rexPane($, on, { view: JSON.stringify({ windows: [{ blocks: [{ block_id: 'block:me' }] }] }) })
    await unowned.ui.press({ key: 'open:/Users/me/p/docs/plan.md' })
    expect(unowned.opened()).toEqual([['zed', '/Users/me/p/docs/plan.md']])
  })

  test('when rex fails, a click opens the editor', async ($, on) => {
    const { ui, opened } = await rexPane($, on, { isRexDown: true })

    await ui.press({ key: 'open:/Users/me/p/docs/plan.md' })
    expect(opened()).toEqual([['zed', '/Users/me/p/docs/plan.md']])
  })
})
