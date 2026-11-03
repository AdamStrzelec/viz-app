import type { Commit, Head } from '../../machines/git.machine'

export const STEP = 104
export const LANE_HEIGHT = 56
export const PILL_HEIGHT = 20
export const RADIUS = 10
const PAD_X = 64
const PAD_BOTTOM = 28

export type GraphNode = { id: string; x: number; y: number; lane: number; merge: boolean }
export type GraphEdge = { from: string; to: string; secondParent: boolean }
export type Label = { text: string; kind: 'branch' | 'branch-active' | 'remote' | 'remote-live' | 'head' | 'head-detached' }
export type GraphLayout = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  // Pill stack per commit, bottom (closest to the commit) first
  labels: Record<string, Label[]>
  width: number
  height: number
}

// Pure layout: x = topological depth, y = lane. Commits must be ordered parents-first.
// `remoteRefs` are remote-tracking pointers (origin/<name>); `remoteAhead` are tips on the server that were not fetched yet.
export function layoutGraph(
  commits: Commit[],
  branches: Record<string, string>,
  head: Head,
  remoteRefs: Record<string, string> = {},
  remoteAhead: Record<string, string> = {},
): GraphLayout {
  const depth = new Map<string, number>()
  const lane = new Map<string, number>()
  const children = new Map<string, number>()
  let lanes = 0

  for (const commit of commits) {
    const [first, ...rest] = commit.parents
    depth.set(commit.id, Math.max(-1, ...commit.parents.map((p) => depth.get(p) ?? 0)) + 1)
    const isMerge = rest.length > 0
    if (first === undefined) {
      lane.set(commit.id, lanes++)
    } else if (isMerge || (children.get(first) ?? 0) === 0) {
      // merge commit returns to its first parent's lane; first child continues the parent's lane
      lane.set(commit.id, lane.get(first) ?? 0)
    } else {
      lane.set(commit.id, lanes++)
    }
    commit.parents.forEach((p) => children.set(p, (children.get(p) ?? 0) + 1))
  }

  const labels: Record<string, Label[]> = {}
  const push = (id: string, label: Label) => (labels[id] ??= []).push(label)
  const activeName = head.kind === 'branch' ? head.name : null
  for (const [name, id] of Object.entries(branches)) {
    if (name !== activeName) push(id, { text: name, kind: 'branch' })
  }
  for (const [name, id] of Object.entries(remoteRefs)) push(id, { text: `origin/${name}`, kind: 'remote' })
  for (const [name, id] of Object.entries(remoteAhead)) push(id, { text: `☁ origin/${name}`, kind: 'remote-live' })
  if (head.kind === 'branch') {
    push(branches[head.name], { text: head.name, kind: 'branch-active' })
    push(branches[head.name], { text: 'HEAD', kind: 'head' })
  } else {
    push(head.id, { text: 'HEAD (detached)', kind: 'head-detached' })
  }

  const maxStack = Math.max(1, ...Object.values(labels).map((l) => l.length))
  const padTop = maxStack * (PILL_HEIGHT + 2) + 20
  // Lanes must be far enough apart for the pill stack above a commit not to cover the lane above it
  const laneGap = Math.max(LANE_HEIGHT, maxStack * (PILL_HEIGHT + 2) + 2 * RADIUS + 30)
  const maxDepth = Math.max(0, ...depth.values())

  const nodes = commits.map((c) => ({
    id: c.id,
    x: PAD_X + (depth.get(c.id) ?? 0) * STEP,
    y: padTop + (lane.get(c.id) ?? 0) * laneGap,
    lane: lane.get(c.id) ?? 0,
    merge: c.parents.length > 1,
  }))
  const edges = commits.flatMap((c) => c.parents.map((p, i) => ({ from: p, to: c.id, secondParent: i > 0 })))

  return {
    nodes,
    edges,
    labels,
    width: PAD_X * 2 + maxDepth * STEP + 60,
    height: padTop + Math.max(0, lanes - 1) * laneGap + RADIUS + PAD_BOTTOM,
  }
}
