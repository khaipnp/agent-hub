import type { AgentActivity, StepRow, StepStatus, TurnEndReason, TurnRow } from '../types'

export type Activity = Record<string, AgentActivity>

export const MAX_STEPS = 200
export const MAX_TURNS = 20
const PROMPT_CHARS = 500
const SUMMARY_CHARS = 80

const SECRETS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(token|secret|password|passwd|api[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
]

export function redact(text: string): string {
  return SECRETS.reduce(
    (out, pattern) =>
      // A pattern without groups hands the offset where `key` would be.
      out.replace(pattern, (_match: string, key: unknown, sep: unknown) =>
        typeof key === 'string' && typeof sep === 'string' ? `${key}${sep}***` : '***',
      ),
    text,
  )
}

const firstLine = (text: string): string => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''

const cut = (text: string, chars = SUMMARY_CHARS): string =>
  text.length > chars ? `${text.slice(0, chars - 1)}…` : text

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** The few words that say what a call ran on, by the tool's own arguments. */
export function summarize(tool: string, args: Readonly<Record<string, unknown>>): string {
  const todos = args.todos
  const text =
    tool === 'Bash'
      ? str(args.command) && firstLine(String(args.command))
      : tool === 'Grep'
        ? [str(args.pattern) && `"${String(args.pattern)}"`, str(args.path) ?? str(args.glob)].filter(Boolean).join(' ')
        : tool === 'TodoWrite' && Array.isArray(todos)
          ? `${todos.length} item${todos.length === 1 ? '' : 's'}`
          : (str(args.file_path) ??
            str(args.notebook_path) ??
            str(args.pattern) ??
            str(args.url) ??
            str(args.query) ??
            str(args.description) ??
            str(args.skill) ??
            str(args.subject) ??
            Object.values(args).map(str).find(Boolean))

  return cut(redact(text || ''))
}

const blank = (): AgentActivity => ({ turns: [], steps: [], toolCount: 0, errorCount: 0 })

// State written before turns were kept has none.
const turnsOf = (one: AgentActivity): TurnRow[] => one.turns ?? []

const put = (activity: Activity, id: string, next: AgentActivity): Activity => ({ ...activity, [id]: next })

export function applyTurnBegin(
  activity: Activity,
  agentId: string,
  turnId: string,
  prompt: string,
  now: number,
): Activity {
  const prev = activity[agentId] ?? blank()
  const turn: TurnRow = { turnId, prompt: cut(redact(prompt.trim()), PROMPT_CHARS), startedAt: now }

  return put(activity, agentId, { ...prev, turnId, turns: [...turnsOf(prev), turn].slice(-MAX_TURNS) })
}

export function applyStepStart(activity: Activity, agentId: string, step: StepRow): Activity {
  const prev = activity[agentId] ?? blank()
  const row: StepRow = prev.turnId === undefined ? step : { ...step, turnId: prev.turnId }

  return put(activity, agentId, {
    ...prev,
    steps: [...prev.steps, row].slice(-MAX_STEPS),
    toolCount: prev.toolCount + 1,
  })
}

export function applyStepEnd(
  activity: Activity,
  agentId: string,
  stepId: string,
  status: Exclude<StepStatus, 'running'>,
  now: number,
  note?: string,
): Activity {
  const prev = activity[agentId]
  const step = prev?.steps.find(one => one.id === stepId)
  if (prev === undefined || step === undefined || step.status !== 'running') return activity

  const ended: StepRow = { ...step, status, endedAt: now }
  if (note) ended.note = cut(redact(firstLine(note)), 120)

  return put(activity, agentId, {
    ...prev,
    steps: prev.steps.map(one => (one.id === stepId ? ended : one)),
    errorCount: prev.errorCount + (status === 'error' ? 1 : 0),
  })
}

/** A turn that ended badly leaves its calls unanswered: they read as errors. */
export function applyTurnEnd(
  activity: Activity,
  agentId: string,
  turnId: string,
  reason: TurnEndReason,
  now: number,
): Activity {
  const prev = activity[agentId]
  if (prev === undefined) return activity

  const isBroken = reason === 'aborted' || reason === 'error'
  const open = prev.steps.filter(step => step.status === 'running')
  const steps =
    isBroken && open.length > 0
      ? prev.steps.map(step =>
          step.status === 'running' ? { ...step, status: 'error' as const, endedAt: now, note: 'turn stopped' } : step,
        )
      : prev.steps

  const { turnId: _ended, ...rest } = prev

  return put(activity, agentId, {
    ...rest,
    turns: turnsOf(prev).map(turn => (turn.turnId === turnId ? { ...turn, endedAt: now, reason } : turn)),
    steps,
    errorCount: prev.errorCount + (steps === prev.steps ? 0 : open.length),
  })
}

export type StepGroup = { turnId?: string; turn?: TurnRow; number?: number; steps: StepRow[] }

/**
 * The steps grouped by the turn they ran in, in order; steps whose turn's
 * start went unheard form a group of their own with no turn.
 */
export function groupSteps(one: AgentActivity): StepGroup[] {
  const turns = turnsOf(one)
  const groups: StepGroup[] = []
  for (const step of one.steps) {
    const last = groups.at(-1)
    if (last !== undefined && last.turnId === step.turnId) {
      last.steps.push(step)
      continue
    }
    const index = turns.findIndex(turn => turn.turnId === step.turnId)
    const turn = turns[index]
    groups.push(turn === undefined ? { turnId: step.turnId, steps: [step] } : { turnId: step.turnId, turn, number: index + 1, steps: [step] })
  }
  // A turn that has begun and called nothing yet still shows.
  for (const [index, turn] of turns.entries()) {
    if (!groups.some(group => group.turnId === turn.turnId)) groups.push({ turnId: turn.turnId, turn, number: index + 1, steps: [] })
  }

  return groups.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
}

// When a running agent's work reads as stuck: a call or a silence this long,
// the same call this many times running, or this many errors in a row.
export const STALL_MS = 120_000
export const REPEAT_LIMIT = 4
export const ERROR_LIMIT = 3

const clock = (ms: number): string => {
  const total = Math.floor(ms / 1000)

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const sameCall = (a: StepRow, b: StepRow): boolean => a.tool === b.tool && a.summary === b.summary

/**
 * Why a running agent may be stuck, in a few words, or undefined: one call
 * running long, a long silence after its last call, the same call over and
 * over, or failure after failure.
 */
export function stuckNote(one: AgentActivity | undefined, startedAt: number, now: number): string | undefined {
  const steps = one?.steps ?? []
  const last = steps.at(-1)

  if (last?.status === 'running' && now - last.startedAt >= STALL_MS) {
    return `${last.tool} running for ${clock(now - last.startedAt)}`
  }
  const quietSince = last === undefined ? startedAt : last.endedAt
  if (quietSince !== undefined && now - quietSince >= STALL_MS) {
    return `no tool call for ${clock(now - quietSince)}`
  }

  if (last !== undefined) {
    let run = 0
    for (let i = steps.length - 1; i >= 0 && sameCall(steps[i]!, last); i -= 1) run += 1
    if (run >= REPEAT_LIMIT) return `same call ×${run}: ${last.tool} ${last.summary}`.trim()
  }

  const tail = steps.slice(-ERROR_LIMIT)
  if (tail.length === ERROR_LIMIT && tail.every(step => step.status === 'error' || step.status === 'denied')) {
    return `${ERROR_LIMIT} failed calls in a row`
  }

  return undefined
}

/** Keeps the agents the roster still holds, and any with a call still running. */
export function pruneActivity(activity: Activity, keep: ReadonlySet<string>): Activity {
  const entries = Object.entries(activity).filter(
    ([id, one]) => keep.has(id) || one.steps.some(step => step.status === 'running'),
  )

  return entries.length === Object.keys(activity).length ? activity : Object.fromEntries(entries)
}

export function formatStepDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`

  const total = Math.floor(ms / 1000)

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
