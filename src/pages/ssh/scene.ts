import type { NodeId } from '../../machines/ssh.machine'
import type { EdgeDef } from '../../machines/ssh/view'

// Fixed scene layout in a 1000 x 620 coordinate space. Nodes are HTML, edges are SVG on top of the same grid.
export const W = 1000
export const H = 620
export const NODE_W = 180
export const NODE_H = 70
export const BOUNDARY_X = 430

export const NODE_POS: Record<NodeId, [number, number]> = {
  request: [110, 60],
  path: [110, 170],
  lookup: [110, 280],
  channel: [300, 400],
  auth: [540, 140],
  rule: [540, 270],
  policy: [820, 270],
  gate: [680, 450],
  exec: [900, 450],
  result: [790, 570],
}

export const NODE_ORDER: NodeId[] = ['request', 'path', 'lookup', 'channel', 'auth', 'rule', 'policy', 'gate', 'exec', 'result']

export type SceneEdge = EdgeDef & { labelAt?: [number, number] }

export const EDGES: SceneEdge[] = [
  { from: 'request', to: 'path', points: [[110, 95], [110, 135]] },
  { from: 'path', to: 'lookup', points: [[110, 205], [110, 245]] },
  { from: 'lookup', to: 'auth', label: 'A · brak mastera', labelAt: [300, 270], points: [[200, 280], [400, 280], [400, 140], [450, 140]] },
  { from: 'lookup', to: 'channel', label: 'B · master istnieje', labelAt: [14, 336], points: [[110, 315], [110, 400], [210, 400]] },
  { from: 'auth', to: 'rule', points: [[540, 175], [540, 235]] },
  { from: 'rule', to: 'policy', points: [[630, 255], [730, 255]] },
  { from: 'channel', to: 'policy', label: 'polityka odziedziczona', labelAt: [450, 372], points: [[390, 380], [700, 380], [700, 290], [730, 290]] },
  { from: 'policy', to: 'gate', label: 'command=', labelAt: [768, 350], points: [[760, 305], [760, 395], [680, 395], [680, 415]] },
  { from: 'policy', to: 'exec', label: 'brak command=', labelAt: [878, 330], points: [[870, 305], [870, 395], [900, 395], [900, 415]] },
  { from: 'gate', to: 'result', points: [[680, 485], [680, 570], [700, 570]] },
  { from: 'exec', to: 'result', points: [[900, 485], [900, 570], [880, 570]] },
]
