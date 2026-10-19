import { describe, expect, test } from 'claude-code/testing'

import type { AgentActivity, StepRow } from '../types'
import {
  applyStepEnd,
  applyStepStart,
  applyTurnBegin,
  applyTurnEnd,
  formatStepDuration,
  groupSteps,
  MAX_STEPS,
  pruneActivity,
  redact,
  STALL_MS,
  stuckNote,
  summarize,
} from './steps'

const step = (id: string, extra: Partial<StepRow> = {}): StepRow => ({
  id,
  tool: 'Read',
  summary: 'src/x.ts',
  status: 'running',
  startedAt: 0,
  ...extra,
})

describe('steps', () => {
  test('a call says what it ran on', () => {
    expect(summarize('Read', { file_path: 'src/route.ts' })).toBe('src/route.ts')
    expect(summarize('Bash', { command: '\nnpm test -- route\necho done' })).toBe('npm test -- route')
    expect(summarize('Grep', { pattern: 'navigate(', path: 'src' })).toBe('"navigate(" src')
    expect(summarize('Agent', { description: 'write the tests', prompt: 'Write the tests' })).toBe('write the tests')
    expect(summarize('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 items')
    expect(summarize('Bash', { command: 'x'.repeat(200) })).toHaveLength(80)
  })

  test('secrets in arguments are masked', () => {
    expect(redact('curl -H "Authorization: Bearer abcdefgh12345678"')).toBe('curl -H "Authorization: ***"')
    expect(redact('API_KEY=sk-live_0123456789abcdef npm start')).toBe('API_KEY=*** npm start')
    expect(redact('export password: hunter22')).toBe('export password: ***')
    expect(redact('git push https://ghp_0123456789abcdefghijABCD@github.com')).toBe('git push https://***@github.com')
    expect(redact('cat README.md')).toBe('cat README.md')
  })

  test('a step runs, then ends with its status, under the current turn', () => {
    let acts = applyTurnBegin({}, 'a', 't1', 'Find the routes', 0)
    acts = applyStepStart(acts, 'a', step('s1'))
    expect(acts.a?.steps[0]).toMatchObject({ status: 'running', turnId: 't1' })

    acts = applyStepEnd(acts, 'a', 's1', 'error', 4300, 'Error: Cannot find module\n  at x')
    expect(acts.a?.steps[0]).toMatchObject({ status: 'error', endedAt: 4300, note: 'Error: Cannot find module' })
    expect(acts.a).toMatchObject({ toolCount: 1, errorCount: 1 })
  })

  test('a refused call keeps its reason and is not counted as an error', () => {
    let acts = applyStepStart({}, 'a', step('s1', { tool: 'Bash' }))
    acts = applyStepEnd(acts, 'a', 's1', 'denied', 10, 'Permission denied by the user')

    expect(acts.a?.steps[0]).toMatchObject({ status: 'denied', note: 'Permission denied by the user' })
    expect(acts.a?.errorCount).toBe(0)
  })

  test('a step ends only once', () => {
    let acts = applyStepStart({}, 'a', step('s1'))
    acts = applyStepEnd(acts, 'a', 's1', 'done', 10)
    const again = applyStepEnd(acts, 'a', 's1', 'error', 20, 'late')

    expect(again).toBe(acts)
  })

  test('a broken turn turns its open calls into errors', () => {
    let acts = applyStepStart({}, 'a', step('s1'))
    acts = applyStepStart(acts, 'a', step('s2'))
    acts = applyStepEnd(acts, 'a', 's1', 'done', 5)
    acts = applyTurnEnd(acts, 'a', 't1', 'aborted', 9)

    expect(acts.a?.steps.map(one => one.status)).toEqual(['done', 'error'])
    expect(acts.a?.steps[1]?.note).toBe('turn stopped')
    expect(acts.a?.errorCount).toBe(1)
  })

  test('only the latest steps are kept, the count goes on', () => {
    let acts = {}
    for (let i = 0; i < MAX_STEPS + 3; i += 1) acts = applyStepStart(acts, 'a', step(`s${i}`))
    const one = (acts as ReturnType<typeof applyStepStart>).a

    expect(one?.steps).toHaveLength(MAX_STEPS)
    expect(one?.steps[0]?.id).toBe('s3')
    expect(one?.toolCount).toBe(MAX_STEPS + 3)
  })

  test('agents the roster dropped go, unless a call still runs', () => {
    let acts = applyStepStart({}, 'gone', step('s1'))
    acts = applyStepEnd(acts, 'gone', 's1', 'done', 1)
    acts = applyStepStart(acts, 'busy', step('s2'))
    acts = applyStepStart(acts, 'kept', step('s3'))

    expect(Object.keys(pruneActivity(acts, new Set(['kept'])))).toEqual(['busy', 'kept'])
    expect(pruneActivity(acts, new Set(['gone', 'busy', 'kept']))).toBe(acts)
  })

  test('steps group under the turn they ran in', () => {
    let acts = applyStepStart({}, 'a', step('early'))
    acts = applyTurnBegin(acts, 'a', 't1', '  Find the routes  ', 10)
    acts = applyStepStart(acts, 'a', step('s1'))
    acts = applyStepStart(acts, 'a', step('s2'))
    acts = applyTurnEnd(acts, 'a', 't1', 'answer', 20)
    acts = applyTurnBegin(acts, 'a', 't2', '', 30)
    const groups = groupSteps(acts.a!)

    expect(groups.map(group => [group.number, group.steps.map(one => one.id)])).toEqual([
      [undefined, ['early']],
      [1, ['s1', 's2']],
      [2, []],
    ])
    expect(groups[1]?.turn).toMatchObject({ prompt: 'Find the routes', endedAt: 20, reason: 'answer' })
  })

  test('a turn prompt is cut and masked', () => {
    const acts = applyTurnBegin({}, 'a', 't1', `token=abc123def456 ${'x'.repeat(600)}`, 0)

    expect(acts.a?.turns[0]?.prompt.startsWith('token=*** ')).toBe(true)
    expect(acts.a?.turns[0]?.prompt).toHaveLength(500)
  })

  test('activity written before turns were kept still groups', () => {
    const old = { steps: [step('s1')], toolCount: 1, errorCount: 0 } as unknown as AgentActivity

    expect(groupSteps(old).map(group => group.steps.length)).toEqual([1])
  })

  test('a running agent reads as stuck on a long call, a long silence, a loop or failures', () => {
    const at = (id: string, extra: Partial<StepRow>) => step(id, { status: 'done', endedAt: 1, ...extra })
    const acts = (steps: StepRow[]) => ({ turns: [], steps, toolCount: steps.length, errorCount: 0 })

    expect(stuckNote(acts([step('s1', { tool: 'Bash', startedAt: 0 })]), 0, STALL_MS + 5000)).toBe('Bash running for 2:05')
    expect(stuckNote(acts([at('s1', { endedAt: 1000 })]), 0, 1000 + STALL_MS)).toBe('no tool call for 2:00')
    expect(stuckNote(acts([]), 0, STALL_MS)).toBe('no tool call for 2:00')

    const loop = [at('a', {}), at('b', {}), at('c', {}), at('d', {}), at('e', {})]
    expect(stuckNote(acts(loop), 0, 2)).toBe('same call ×5: Read src/x.ts')

    const failing = [at('a', { status: 'error', summary: '1' }), at('b', { status: 'denied', summary: '2' }), at('c', { status: 'error', summary: '3' })]
    expect(stuckNote(acts(failing), 0, 2)).toBe('3 failed calls in a row')

    const fine = [at('a', { summary: '1' }), at('b', { summary: '2' }), at('c', { status: 'error', summary: '3' })]
    expect(stuckNote(acts(fine), 0, 2)).toBeUndefined()
  })

  test('step durations read in tenths of a second, then m:ss', () => {
    expect(formatStepDuration(230)).toBe('0.2s')
    expect(formatStepDuration(4300)).toBe('4.3s')
    expect(formatStepDuration(95_000)).toBe('1:35')
  })
})
