export type AgentRowStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'

export type TurnEndReason = 'answer' | 'aborted' | 'refusal' | 'error'

/**
 * One agent as the pane knows it: what `$.agent.list()` last said of it,
 * plus the times the turn events gave, kept after the engine drops it.
 */
export type AgentRow = {
  id: string
  type: string
  description: string
  name?: string
  parentId?: string
  /** A teammate goes idle between turns instead of ending. */
  isTeammate: boolean
  /** The person's prompt it was first seen under (PluginState's `task`); absent in rows from before tasks were kept. */
  task?: number
  status: AgentRowStatus
  /** Seen in `$.agent.list()` at least once; forks and workflow loops never are. */
  isListed: boolean
  /** In the latest `$.agent.list()` snapshot. */
  inList: boolean
  firstSeenAt: number
  startedAt?: number
  endedAt?: number
  reason?: TurnEndReason
}

export type StepStatus = 'running' | 'done' | 'error' | 'denied'

/** One tool call an agent made. */
export type StepRow = {
  /** The call's tool_use_id. */
  id: string
  /** The agent's turn it ran in, when its start was heard. */
  turnId?: string
  tool: string
  /** What it ran on, cut short and with secrets masked: a path, a command, a pattern. */
  summary: string
  status: StepStatus
  startedAt: number
  endedAt?: number
  /** The first line of an error, or why the call was refused. */
  note?: string
}

/** One run of an agent's loop: a subagent has one, a teammate one per wake. */
export type TurnRow = {
  turnId: string
  /** The prompt it began with, cut short and with secrets masked; "" for a continuation. */
  prompt: string
  startedAt: number
  endedAt?: number
  reason?: TurnEndReason
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** One item of an agent's plan, from its TodoWrite or TaskCreate / TaskUpdate calls. */
export type TodoItem = {
  id: string
  text: string
  status: TodoStatus
  /** What the item reads as while in progress ("Running tests"), when the call gave one. */
  active?: string
  /** When the main conversation last put it in progress, for its elapsed time. */
  startedAt?: number
}

/** What an agent's turns cost, summed: the API's four token counts and the last model. */
export type TokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  model: string
}

/** What one agent did: its turns, its latest steps and its counts over all of them. */
export type AgentActivity = {
  /** The turn running now, which new steps belong to. */
  turnId?: string
  turns: TurnRow[]
  steps: StepRow[]
  toolCount: number
  errorCount: number
  /** Absent until the agent writes a plan, and in state written before plans were kept. */
  todos?: TodoItem[]
  /** The turns that ended, summed; absent until one ends with usage. */
  usage?: TokenUsage
  /** The running turn's requests so far, from each model step; cleared as the turn ends. */
  live?: TokenUsage
}

declare module 'claude-code' {
  interface PluginState {
    'agent-hub': {
      agents: Record<string, AgentRow>
      /** The main conversation's task checklist, from its TaskCreate / TaskUpdate / TodoWrite calls. */
      tasks: TodoItem[]
      /** The task the main conversation works on now: its tool calls are logged under it. */
      currentTask: string | null
      /** Each task's log: the main conversation's tool calls while it was the current task. */
      taskLogs: Record<string, AgentActivity>
      activity: Record<string, AgentActivity>
      now: number
      /** The agent the pane shows in detail; null shows the list. */
      selected: string | null
      /** Messages sent from the pane, counted: the field is drawn anew after each. */
      sendCount: number
      /** The agent a first press of stop asked about; a second press stops it. */
      confirmStop: string | null
      /** The context window the session's last response filled: its tokens and its size; null before a reading. */
      context: { tokens: number; window: number } | null
      /** What the whole session has cost, in US dollars, as /cost totals it; null before a reading. */
      sessionCostUsd: number | null
      /** The person's prompts so far, counted: each one starts a task. */
      task: number
      /** The list shows every agent of the session, not only the latest task's. */
      showAll: boolean
      /** Running agents' cards list their latest steps; off, only what runs now. Finished cards stay folded. */
      isExpanded: boolean
    }
  }
}
