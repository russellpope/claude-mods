import { describe, expect, test } from 'claude-code/testing'

import { completeRun, spawnRun, stepRun } from './inproc'

describe('in-process runs', () => {
  test('spawn, step, complete', () => {
    let list = spawnRun([], { id: 'a1', agentId: 'a1', type: 'Explore', description: 'find x', model: 'claude-haiku-5-5', at: 10 })
    list = stepRun(list, 'a1', 'claude-haiku-5-5', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    list = stepRun(list, 'zz', 'claude-haiku-5-5', { input_tokens: 999 })
    expect(list[0]).toMatchObject({ status: 'running', tokens: 110, contextTokens: 110 })
    expect(list[0]?.costUsd).toBeGreaterThan(0)
    list = completeRun(list, 'a1', true, 50)
    expect(list[0]).toMatchObject({ status: 'done', endedAt: 50 })
    expect(completeRun(list, 'a1', false, 60)[0]?.status).toBe('failed')
  })

  test('keeps the last 50 runs; a re-spawned id replaces its old row', () => {
    let list: ReturnType<typeof spawnRun> = []
    for (let i = 0; i < 60; i++) list = spawnRun(list, { id: `r${i}`, type: 't', description: '', model: '', at: i })
    expect(list).toHaveLength(50)
    expect(spawnRun(list, { id: 'r59', type: 't', description: 'again', model: '', at: 99 }).filter(r => r.id === 'r59')).toHaveLength(1)
  })
})
