import { assign, setup } from 'xstate'

/**
 * Three small machines, each explaining one Git concept.
 * 1. fileMachine     — lifecycle of a single file (working tree → index → repository)
 * 2. mergeMachine    — merge with conflicts (merge / resolve / commit / abort)
 * 3. branchesMachine — commits, branches, HEAD, merge / rebase, detached HEAD, plus a mocked remote (push / fetch / pull / PRs)
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
export type PullRequest = { id: number; from: string; status: 'open' | 'merged' | 'closed' }
// The mocked server (origin). Commits keep their id when they travel between repos, like a hash
export type Remote = { commits: Commit[]; branches: Record<string, string> }
// One person's clone. `tracking` = origin/<name> pointers: what this clone last learned about the remote (moved only by fetch / pull / push)
export type LocalRepo = { commits: Commit[]; branches: Record<string, string>; head: Head; tracking: Record<string, string> }
// The active person's clone is flattened into the top-level fields; the other people's clones wait in `others`.
// Remote and pull requests are shared by everyone.
export type RepoState = LocalRepo & {
  person: string
  others: Record<string, LocalRepo>
  remote: Remote
  prs: PullRequest[]
}
export const PEOPLE = ['Osoba 1', 'Osoba 2']
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
  | { type: 'PUSH'; name: string }
  | { type: 'FETCH' }
  | { type: 'PULL' }
  | { type: 'SWITCH_PERSON'; id: string }
  | { type: 'OPEN_PR'; from: string }
  | { type: 'MERGE_PR'; id: number }
  | { type: 'CLOSE_PR'; id: number }

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

// Ids are unique across every clone and the remote, so a new commit never collides with one only somebody else has
const idCount = (c: BranchesContext) =>
  new Set([...c.commits, ...c.remote.commits, ...Object.values(c.others).flatMap((o) => o.commits)].map((x) => x.id)).size
const nextId = (c: BranchesContext) => `c${idCount(c) + 1}`

const snapshotOf = (c: RepoState): RepoState => ({
  commits: c.commits,
  branches: c.branches,
  head: c.head,
  tracking: c.tracking,
  person: c.person,
  others: c.others,
  remote: c.remote,
  prs: c.prs,
})

// ---------- Remote: what each command would do right now (shared by guards and UI previews) ----------

export const BASE = 'main'

// Commits of `source` reachable from `tip` that `target` lacks, parents first
function missing(target: Commit[], source: Commit[], tip: string): Commit[] {
  const have = new Set(target.map((c) => c.id))
  const needed = ancestors(source, tip)
  return source.filter((c) => needed.has(c.id) && !have.has(c.id))
}

const withCommits = (target: Commit[], source: Commit[], tips: string[]) =>
  tips.reduce((acc, tip) => [...acc, ...missing(acc, source, tip)], target)

// Everything drawn in the graph: local commits plus the ones that exist only on the remote
export const allCommits = (c: BranchesContext): Commit[] => withCommits(c.commits, c.remote.commits, Object.values(c.remote.branches))

export const remoteOnlyIds = (c: BranchesContext): Set<string> => {
  const local = new Set(c.commits.map((x) => x.id))
  return new Set(allCommits(c).filter((x) => !local.has(x.id)).map((x) => x.id))
}

export type PushKind = 'new' | 'fast-forward' | 'up-to-date' | 'rejected'

export function pushKind(c: BranchesContext, name: string): PushKind {
  const remoteTip = c.remote.branches[name]
  if (remoteTip === undefined) return 'new'
  if (remoteTip === c.branches[name]) return 'up-to-date'
  // Rejected: the remote has commits the local branch does not contain (diverged, or simply behind)
  return ancestors(c.commits, c.branches[name]).has(remoteTip) ? 'fast-forward' : 'rejected'
}

export type PullKind = 'fast-forward' | 'merge-commit' | 'up-to-date' | 'no-remote' | 'detached'

export function pullKind(c: BranchesContext): PullKind {
  if (c.head.kind === 'detached') return 'detached'
  const remoteTip = c.remote.branches[c.head.name]
  if (remoteTip === undefined) return 'no-remote'
  const all = withCommits(c.commits, c.remote.commits, [remoteTip])
  const tip = headCommitId(c)
  if (ancestors(all, tip).has(remoteTip)) return 'up-to-date'
  return ancestors(all, remoteTip).has(tip) ? 'fast-forward' : 'merge-commit'
}

export const fetchNeeded = (c: BranchesContext) => Object.entries(c.remote.branches).some(([name, id]) => c.tracking[name] !== id)

export type PrKind = 'ok' | 'exists' | 'no-changes' | 'base'

export function prKind(c: BranchesContext, from: string): PrKind {
  if (from === BASE) return 'base'
  if (c.prs.some((p) => p.from === from && p.status === 'open')) return 'exists'
  return ancestors(c.remote.commits, c.remote.branches[BASE]).has(c.remote.branches[from]) ? 'no-changes' : 'ok'
}

const findOpenPr = (c: BranchesContext, id: number) => c.prs.find((p) => p.id === id && p.status === 'open')

export const canMergePr = (c: BranchesContext, id: number) => {
  const pr = findOpenPr(c, id)
  return !!pr && c.remote.branches[pr.from] !== undefined && prKind({ ...c, prs: [] }, pr.from) === 'ok'
}

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
    canPush: ({ context, event }) => event.type === 'PUSH' && event.name in context.branches && ['new', 'fast-forward'].includes(pushKind(context, event.name)),
    canFetch: ({ context }) => fetchNeeded(context),
    canPull: ({ context }) => ['fast-forward', 'merge-commit'].includes(pullKind(context)),
    canOpenPr: ({ context, event }) => event.type === 'OPEN_PR' && event.from in context.remote.branches && prKind(context, event.from) === 'ok',
    canMergePr: ({ context, event }) => event.type === 'MERGE_PR' && canMergePr(context, event.id),
    canClosePr: ({ context, event }) => event.type === 'CLOSE_PR' && !!findOpenPr(context, event.id),
    switchToBranch: ({ context, event }) => event.type === 'SWITCH_PERSON' && context.others[event.id]?.head.kind === 'branch',
    switchToDetached: ({ context, event }) => event.type === 'SWITCH_PERSON' && context.others[event.id]?.head.kind === 'detached',
    undoToBranch: ({ context }) => context.past.at(-1)?.head.kind === 'branch',
    undoToDetached: ({ context }) => context.past.at(-1)?.head.kind === 'detached',
    redoToBranch: ({ context }) => context.future[0]?.head.kind === 'branch',
    redoToDetached: ({ context }) => context.future[0]?.head.kind === 'detached',
  },
  actions: {
    // Must run before the action that changes the repo: stores the current state and drops the redo branch
    record: assign(({ context }) => ({
      past: [...context.past, snapshotOf(context)],
      future: [],
    })),
    undo: assign(({ context }) => ({
      ...context.past.at(-1)!,
      past: context.past.slice(0, -1),
      future: [snapshotOf(context), ...context.future],
    })),
    redo: assign(({ context }) => ({
      ...context.future[0],
      past: [...context.past, snapshotOf(context)],
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
        const id = `c${idCount(context) + created.length + 1}`
        created.push({ id, parents: [tip], message: c.message })
        tip = id
      }
      return { commits: [...context.commits, ...created], branches: { ...context.branches, [context.head.name]: tip } }
    }),
    push: assign(({ context, event }) => {
      if (event.type !== 'PUSH') return {}
      const tip = context.branches[event.name]
      const { remote } = context
      return {
        remote: { commits: [...remote.commits, ...missing(remote.commits, context.commits, tip)], branches: { ...remote.branches, [event.name]: tip } },
        tracking: { ...context.tracking, [event.name]: tip },
      }
    }),
    fetch: assign(({ context }) => ({
      commits: withCommits(context.commits, context.remote.commits, Object.values(context.remote.branches)),
      tracking: { ...context.remote.branches },
    })),
    // pull = fetch + merge origin/<current branch> into the current branch
    pull: assign(({ context }) => {
      if (context.head.kind !== 'branch') return {}
      const { remote, head } = context
      const remoteTip = remote.branches[head.name]
      const commits = withCommits(context.commits, remote.commits, Object.values(remote.branches))
      if (pullKind(context) === 'fast-forward') {
        return { commits, branches: { ...context.branches, [head.name]: remoteTip }, tracking: { ...remote.branches } }
      }
      const id = nextId(context)
      const merge: Commit = { id, parents: [headCommitId(context), remoteTip], message: `Merge origin/${head.name}` }
      return { commits: [...commits, merge], branches: { ...context.branches, [head.name]: id }, tracking: { ...remote.branches } }
    }),
    // Parks the active clone in `others` and loads another person's clone
    switchPerson: assign(({ context, event }) => {
      if (event.type !== 'SWITCH_PERSON') return {}
      const { [event.id]: next, ...rest } = context.others
      const current: LocalRepo = { commits: context.commits, branches: context.branches, head: context.head, tracking: context.tracking }
      return { ...next, person: event.id, others: { ...rest, [context.person]: current } }
    }),
    openPr: assign(({ context, event }) =>
      event.type === 'OPEN_PR' ? { prs: [...context.prs, { id: context.prs.length + 1, from: event.from, status: 'open' as const }] } : {},
    ),
    // Merge commit on the remote main (GitHub's default "Create a merge commit")
    mergePr: assign(({ context, event }) => {
      if (event.type !== 'MERGE_PR') return {}
      const pr = findOpenPr(context, event.id)!
      const { remote } = context
      const id = nextId(context)
      const commit: Commit = { id, parents: [remote.branches[BASE], remote.branches[pr.from]], message: `Merge PR #${pr.id} (${pr.from})` }
      return {
        remote: { commits: [...remote.commits, commit], branches: { ...remote.branches, [BASE]: id } },
        prs: context.prs.map((p) => (p.id === pr.id ? { ...p, status: 'merged' as const } : p)),
      }
    }),
    closePr: assign(({ context, event }) =>
      event.type === 'CLOSE_PR' ? { prs: context.prs.map((p) => (p.id === event.id ? { ...p, status: 'closed' as const } : p)) } : {},
    ),
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
    remote: { commits: [{ id: 'c1', parents: [], message: 'initial commit' }], branches: { main: 'c1' } },
    tracking: { main: 'c1' },
    person: PEOPLE[0],
    others: {
      [PEOPLE[1]]: { commits: [{ id: 'c1', parents: [], message: 'initial commit' }], branches: { main: 'c1' }, head: { kind: 'branch', name: 'main' }, tracking: { main: 'c1' } },
    },
    prs: [],
    past: [],
    future: [],
  },
  on: {
    // Remote commands do not depend on the HEAD state, so they live at the root
    PUSH: { guard: 'canPush', actions: ['record', 'push'] },
    FETCH: { guard: 'canFetch', actions: ['record', 'fetch'] },
    PULL: { guard: 'canPull', actions: ['record', 'pull'] },
    OPEN_PR: { guard: 'canOpenPr', actions: ['record', 'openPr'] },
    MERGE_PR: { guard: 'canMergePr', actions: ['record', 'mergePr'] },
    CLOSE_PR: { guard: 'canClosePr', actions: ['record', 'closePr'] },
    SWITCH_PERSON: [
      { guard: 'switchToBranch', target: '.onBranch', actions: ['record', 'switchPerson'] },
      { guard: 'switchToDetached', target: '.detached', actions: ['record', 'switchPerson'] },
    ],
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
