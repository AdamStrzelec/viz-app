import { assign, setup } from 'xstate'

/**
 * Three small machines, each explaining one Git concept.
 * 1. fileMachine     — lifecycle of a single file (working tree → index → repository)
 * 2. mergeMachine    — merge with conflicts (merge / resolve / commit / abort)
 * 3. branchesMachine — commits, branches, HEAD, fast-forward vs merge commit, detached HEAD
 */

// ---------- 1. File lifecycle ----------

export const fileMachine = setup({
  types: { events: {} as { type: 'EDIT' | 'STAGE' | 'UNSTAGE' | 'COMMIT' | 'RESTORE' | 'RM_CACHED' } },
}).createMachine({
  id: 'gitFile',
  initial: 'untracked',
  states: {
    untracked: {
      description: 'Plik istnieje w working tree, ale Git go nie śledzi.',
      on: { STAGE: 'staged' },
    },
    unmodified: {
      description: 'Plik jest śledzony i identyczny z ostatnim commitem.',
      on: { EDIT: 'modified', RM_CACHED: 'untracked' },
    },
    modified: {
      description: 'Zmiany w working tree, jeszcze nie w index.',
      on: { STAGE: 'staged', RESTORE: 'unmodified' },
    },
    staged: {
      description: 'Zmiany w index — trafią do następnego commita.',
      on: { COMMIT: 'unmodified', UNSTAGE: 'modified', EDIT: 'stagedAndModified' },
    },
    stagedAndModified: {
      description: 'Część zmian w index, a po git add plik edytowano ponownie.',
      on: { STAGE: 'staged', COMMIT: 'modified', UNSTAGE: 'modified' },
    },
  },
})

export const fileCommands: Record<string, { cmd: string; hint: string }> = {
  STAGE: { cmd: 'git add <file>', hint: 'working tree → index' },
  UNSTAGE: { cmd: 'git restore --staged <file>', hint: 'index → working tree' },
  COMMIT: { cmd: 'git commit', hint: 'index → repository' },
  EDIT: { cmd: 'edytuj plik', hint: 'zmiana w working tree' },
  RESTORE: { cmd: 'git restore <file>', hint: 'porzuć zmiany z working tree' },
  RM_CACHED: { cmd: 'git rm --cached <file>', hint: 'przestań śledzić plik' },
}

// ---------- 2. Merge with conflicts ----------

export type MergeContext = { conflicts: string[]; resolved: string[] }

export const mergeMachine = setup({
  types: {
    context: {} as MergeContext,
    events: {} as { type: 'MERGE_CLEAN' } | { type: 'MERGE_CONFLICT' } | { type: 'RESOLVE'; file: string } | { type: 'COMMIT' } | { type: 'ABORT' } | { type: 'RESET' },
  },
  guards: {
    allResolved: ({ context }) => context.conflicts.length > 0 && context.conflicts.every((f) => context.resolved.includes(f)),
    stillUnresolved: ({ context, event }) =>
      event.type === 'RESOLVE' && context.conflicts.includes(event.file) && !context.resolved.includes(event.file),
  },
  actions: {
    markConflicts: assign({ conflicts: ['app.ts', 'README.md'], resolved: [] }),
    markResolved: assign({ resolved: ({ context, event }) => (event.type === 'RESOLVE' ? [...context.resolved, event.file] : context.resolved) }),
    clear: assign({ conflicts: [], resolved: [] }),
  },
}).createMachine({
  id: 'gitMerge',
  initial: 'clean',
  context: { conflicts: [], resolved: [] },
  states: {
    clean: {
      description: 'Brak merge w toku. Możesz wykonać git merge feature.',
      on: {
        MERGE_CLEAN: 'merged',
        MERGE_CONFLICT: { target: 'conflicted', actions: 'markConflicts' },
      },
    },
    conflicted: {
      description: 'MERGE_HEAD istnieje. Pliki z konfliktami czekają na ręczne rozwiązanie i git add.',
      on: {
        RESOLVE: { guard: 'stillUnresolved', actions: 'markResolved' },
        COMMIT: { guard: 'allResolved', target: 'merged', actions: 'clear' },
        ABORT: { target: 'clean', actions: 'clear' },
      },
    },
    merged: {
      description: 'Merge commit utworzony.',
      on: { RESET: { target: 'clean', actions: 'clear' } },
    },
  },
})

// ---------- 3. Branches, HEAD, merge ----------

export type Commit = { id: string; parents: string[]; message: string }
export type Head = { kind: 'branch'; name: string } | { kind: 'detached'; id: string }
export type RepoState = { commits: Commit[]; branches: Record<string, string>; head: Head }
// past / future hold earlier repo states, so UNDO / REDO can time-travel through the steps
export type BranchesContext = RepoState & { past: RepoState[]; future: RepoState[] }
export type BranchesEvent =
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'COMMIT' }
  | { type: 'BRANCH'; name: string }
  | { type: 'CHECKOUT'; target: string }
  | { type: 'MERGE'; name: string }
  | { type: 'REBASE'; name: string }

export const headCommitId = (c: BranchesContext) => (c.head.kind === 'branch' ? c.branches[c.head.name] : c.head.id)

// All commits reachable from `id` (including itself)
export function ancestors(commits: Commit[], id: string): Set<string> {
  const byId = new Map(commits.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    byId.get(current)?.parents.forEach((p) => stack.push(p))
  }
  return seen
}

export type MergeKind = 'fast-forward' | 'merge-commit' | 'up-to-date' | 'detached' | 'unknown'

// What `git merge <name>` would do right now — shared by the guards and the UI preview
export function mergeKind(context: BranchesContext, name: string): MergeKind {
  if (context.head.kind === 'detached') return 'detached'
  if (!(name in context.branches)) return 'unknown'
  const head = headCommitId(context)
  const target = context.branches[name]
  if (ancestors(context.commits, head).has(target)) return 'up-to-date'
  if (ancestors(context.commits, target).has(head)) return 'fast-forward'
  return 'merge-commit'
}

export type RebaseKind = 'fast-forward' | 'rebase' | 'up-to-date' | 'detached' | 'unknown'

// What `git rebase <name>` would do right now: same graph question as merge, but diverged history is replayed instead of joined
export function rebaseKind(context: BranchesContext, name: string): RebaseKind {
  const kind = mergeKind(context, name)
  return kind === 'merge-commit' ? 'rebase' : kind
}

const nextId = (c: BranchesContext) => `c${c.commits.length + 1}`

export const branchesMachine = setup({
  types: { context: {} as BranchesContext, events: {} as BranchesEvent },
  guards: {
    isBranch: ({ context, event }) => event.type === 'CHECKOUT' && event.target in context.branches,
    isCommit: ({ context, event }) => event.type === 'CHECKOUT' && context.commits.some((c) => c.id === event.target),
    isNewBranch: ({ context, event }) => event.type === 'BRANCH' && !(event.name in context.branches),
    canFastForward: ({ context, event }) => event.type === 'MERGE' && mergeKind(context, event.name) === 'fast-forward',
    canMergeCommit: ({ context, event }) => event.type === 'MERGE' && mergeKind(context, event.name) === 'merge-commit',
    canRebaseFastForward: ({ context, event }) => event.type === 'REBASE' && rebaseKind(context, event.name) === 'fast-forward',
    canRebase: ({ context, event }) => event.type === 'REBASE' && rebaseKind(context, event.name) === 'rebase',
    undoToBranch: ({ context }) => context.past.at(-1)?.head.kind === 'branch',
    undoToDetached: ({ context }) => context.past.at(-1)?.head.kind === 'detached',
    redoToBranch: ({ context }) => context.future[0]?.head.kind === 'branch',
    redoToDetached: ({ context }) => context.future[0]?.head.kind === 'detached',
  },
  actions: {
    // Must run before the action that changes the repo: stores the current state and drops the redo branch
    record: assign(({ context }) => ({
      past: [...context.past, { commits: context.commits, branches: context.branches, head: context.head }],
      future: [],
    })),
    undo: assign(({ context }) => ({
      ...context.past.at(-1)!,
      past: context.past.slice(0, -1),
      future: [{ commits: context.commits, branches: context.branches, head: context.head }, ...context.future],
    })),
    redo: assign(({ context }) => ({
      ...context.future[0],
      past: [...context.past, { commits: context.commits, branches: context.branches, head: context.head }],
      future: context.future.slice(1),
    })),
    commit: assign(({ context }) => {
      const id = nextId(context)
      const commit: Commit = { id, parents: [headCommitId(context)], message: `commit ${id}` }
      const commits = [...context.commits, commit]
      if (context.head.kind === 'branch') return { commits, branches: { ...context.branches, [context.head.name]: id } }
      return { commits, head: { kind: 'detached', id } as Head }
    }),
    branch: assign({
      branches: ({ context, event }) => (event.type === 'BRANCH' ? { ...context.branches, [event.name]: headCommitId(context) } : context.branches),
    }),
    attach: assign({ head: ({ event }) => (event.type === 'CHECKOUT' ? ({ kind: 'branch', name: event.target } as Head) : ({ kind: 'branch', name: 'main' } as Head)) }),
    detach: assign({ head: ({ event }) => (event.type === 'CHECKOUT' ? ({ kind: 'detached', id: event.target } as Head) : ({ kind: 'detached', id: 'c1' } as Head)) }),
    fastForward: assign({
      branches: ({ context, event }) =>
        (event.type === 'MERGE' || event.type === 'REBASE') && context.head.kind === 'branch'
          ? { ...context.branches, [context.head.name]: context.branches[event.name] }
          : context.branches,
    }),
    // Copies the commits unique to the current branch onto the target tip; originals stay in the graph, unreachable
    rebase: assign(({ context, event }) => {
      if (event.type !== 'REBASE' || context.head.kind !== 'branch') return {}
      const onto = ancestors(context.commits, context.branches[event.name])
      const mine = ancestors(context.commits, headCommitId(context))
      const replay = context.commits.filter((c) => mine.has(c.id) && !onto.has(c.id) && c.parents.length < 2)
      let tip = context.branches[event.name]
      const created: Commit[] = []
      for (const c of replay) {
        const id = `c${context.commits.length + created.length + 1}`
        created.push({ id, parents: [tip], message: c.message })
        tip = id
      }
      return { commits: [...context.commits, ...created], branches: { ...context.branches, [context.head.name]: tip } }
    }),
    mergeCommit: assign(({ context, event }) => {
      if (event.type !== 'MERGE' || context.head.kind !== 'branch') return {}
      const id = nextId(context)
      const commit: Commit = { id, parents: [headCommitId(context), context.branches[event.name]], message: `Merge ${event.name}` }
      return { commits: [...context.commits, commit], branches: { ...context.branches, [context.head.name]: id } }
    }),
  },
}).createMachine({
  id: 'gitBranches',
  initial: 'onBranch',
  context: {
    commits: [{ id: 'c1', parents: [], message: 'initial commit' }],
    branches: { main: 'c1' },
    head: { kind: 'branch', name: 'main' },
    past: [],
    future: [],
  },
  on: {
    UNDO: [
      { guard: 'undoToBranch', target: '.onBranch', actions: 'undo' },
      { guard: 'undoToDetached', target: '.detached', actions: 'undo' },
    ],
    REDO: [
      { guard: 'redoToBranch', target: '.onBranch', actions: 'redo' },
      { guard: 'redoToDetached', target: '.detached', actions: 'redo' },
    ],
  },
  states: {
    onBranch: {
      description: 'HEAD wskazuje na branch — nowe commity przesuwają ten branch.',
      on: {
        COMMIT: { actions: ['record', 'commit'] },
        BRANCH: { guard: 'isNewBranch', actions: ['record', 'branch'] },
        CHECKOUT: [
          { guard: 'isBranch', actions: ['record', 'attach'] },
          { guard: 'isCommit', target: 'detached', actions: ['record', 'detach'] },
        ],
        MERGE: [
          { guard: 'canFastForward', actions: ['record', 'fastForward'] },
          { guard: 'canMergeCommit', actions: ['record', 'mergeCommit'] },
        ],
        REBASE: [
          { guard: 'canRebaseFastForward', actions: ['record', 'fastForward'] },
          { guard: 'canRebase', actions: ['record', 'rebase'] },
        ],
      },
    },
    detached: {
      description: 'Detached HEAD — HEAD wskazuje na commit. Nowe commity nie należą do żadnego brancha.',
      on: {
        COMMIT: { actions: ['record', 'commit'] },
        BRANCH: { guard: 'isNewBranch', actions: ['record', 'branch'] },
        CHECKOUT: [
          { guard: 'isBranch', target: 'onBranch', actions: ['record', 'attach'] },
          { guard: 'isCommit', actions: ['record', 'detach'] },
        ],
      },
    },
  },
})
