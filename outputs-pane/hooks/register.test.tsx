import { describe, expect, test } from 'claude-code/testing'

import { iconFor } from './icons'
import { budget, editorArgv, remember, sectionOf, shorten, splitPath } from './register'

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

  test('planning takes up to half the rows, code the rest; a folded section takes none', () => {
    expect(budget(1, 20, [], 10)).toEqual({ planning: 1, code: 9 })
    expect(budget(20, 20, [], 10)).toEqual({ planning: 5, code: 5 })
    expect(budget(20, 20, ['planning'], 10)).toEqual({ planning: 0, code: 10 })
    expect(budget(3, 2, ['code'], 10)).toEqual({ planning: 3, code: 0 })
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

  test('a failed write is not listed', async ($, on) => {
    on('tool.call', () => ({ result: 'boom', isError: true } as never))
    on('session.cwd', () => ({ value: '/Users/me/p' }))

    await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/Users/me/p/bad.md', content: '' })
    const ui = await $.ui.mount({ plugin: 'outputs-pane', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'outputs' })
    expect(await ui.findAll({ type: 'Button', text: 'bad.md' })).toHaveLength(0)
  })
})
