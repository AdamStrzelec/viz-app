import { evaluate, outputIds, type Gate, type GateType, type Level, type Signals } from './gates'

const COL_W = 130
const ROW_H = 74
const BUS_GAP = 30
const TOP = 46

const BUBBLE: GateType[] = ['NOT', 'NAND', 'NOR', 'XNOR']
const OR_LIKE: GateType[] = ['OR', 'NOR', 'XOR', 'XNOR']

const outX = (type: GateType) => (type === 'NOT' ? 44 : 60) + (BUBBLE.includes(type) ? 9 : 0)

// Gate outline drawn in a 60×40 box (NOT is a 44×40 triangle)
export function GateShape({ type }: { type: GateType }) {
  const base = type === 'NOT' ? 'M0,4 L44,20 L0,36 Z' : OR_LIKE.includes(type) ? 'M0,0 Q38,0 60,20 Q38,40 0,40 Q14,20 0,0 Z' : 'M0,0 H40 A20,20 0 0 1 40,40 H0 Z'
  const bx = type === 'NOT' ? 48.5 : 64.5
  return (
    <>
      {(type === 'XOR' || type === 'XNOR') && <path d="M-7,0 Q7,20 -7,40" className="gate-line" />}
      <path d={base} className="gate-body" />
      {BUBBLE.includes(type) && <circle cx={bx} cy={20} r={4.5} className="gate-body" />}
    </>
  )
}

type Placed = Gate & { x: number; y: number }

function layout(level: Level) {
  const left = 24 + level.inputs.length * BUS_GAP + 24
  const depth: Record<string, number> = {}
  level.inputs.forEach((name) => (depth[name] = 0))
  const placed: Record<string, Placed> = {}
  const columns: Record<number, number[]> = {}
  let nextSlot = 0

  // Pass 1: columns. Sources not seen yet are feedback wires and don't affect the column
  for (const gate of level.gates) {
    depth[gate.id] = 1 + Math.max(0, ...gate.inputs.filter((src) => src in depth).map((src) => depth[src]))
  }
  // Outputs go to the last column so their wires never run through other gates
  const lastColumn = Math.max(...level.gates.map((g) => depth[g.id]))
  for (const id of outputIds(level)) depth[id] = lastColumn
  // Drop empty columns
  const used = [...new Set(level.gates.map((g) => depth[g.id]))].sort((a, b) => a - b)
  for (const g of level.gates) depth[g.id] = used.indexOf(depth[g.id]) + 1

  // Pass 2: rows, column by column
  const ordered = [...level.gates].sort((a, b) => depth[a.id] - depth[b.id])
  for (const gate of ordered) {
    const d = depth[gate.id]
    const sourceYs = gate.inputs.filter((src) => placed[src]).map((src) => placed[src].y)
    let y = sourceYs.length ? sourceYs.reduce((a, b) => a + b, 0) / sourceYs.length : TOP + 20 + nextSlot++ * ROW_H
    const taken = (columns[d] ??= [])
    // A bus wire to a deeper gate must not run through gates in earlier columns
    const busPins = gate.inputs.flatMap((src, k) => (depth[src] === 0 ? [k] : []))
    const pinOffset = (k: number) => (gate.type === 'NOT' ? 0 : -20 + ((k + 1) * 40) / (gate.inputs.length + 1))
    const crossesGate = (y: number) =>
      d > 1 && busPins.some((k) => Object.values(placed).some((g) => depth[g.id] < d && Math.abs(g.y - (y + pinOffset(k))) < 28))
    while (taken.some((t) => Math.abs(t - y) < ROW_H * 0.8) || crossesGate(y)) y += ROW_H * 0.4
    taken.push(y)
    placed[gate.id] = { ...gate, x: left + (d - 1) * COL_W, y }
  }

  const gates = Object.values(placed)
  // Each gate output gets its own vertical lane, so different signals never share a wire
  const lane: Record<string, number> = {}
  const perColumn: Record<number, number> = {}
  for (const g of [...gates].sort((a, b) => a.y - b.y)) lane[g.id] = perColumn[depth[g.id]] = (perColumn[depth[g.id]] ?? -1) + 1
  const maxDepth = Math.max(...Object.values(depth))
  const hasFeedback = gates.some((g) => g.inputs.some((src) => placed[src] && placed[src].x >= g.x))
  return {
    gates,
    placed,
    lane,
    left,
    width: left + maxDepth * COL_W + 20,
    height: Math.max(...gates.map((g) => g.y)) + (hasFeedback ? 80 : 50),
  }
}

const pinY = (gate: Placed, k: number) => (gate.type === 'NOT' ? gate.y : gate.y - 20 + ((k + 1) * 40) / (gate.inputs.length + 1))
const pinX = (gate: Placed) => gate.x + (OR_LIKE.includes(gate.type) ? 7 : 0)
const busX = (i: number) => 24 + i * BUS_GAP

type Props = { level: Level; inputs: boolean[]; memory?: Signals; reveal: boolean; onToggle?: (index: number) => void }

export function Circuit({ level, inputs, memory, reveal, onToggle }: Props) {
  const { gates, placed, lane, width, height } = layout(level)
  const values = evaluate(level, inputs, memory)
  const outputs = outputIds(level).map((id) => placed[id])

  // Inputs are always visible; internal wires only when revealed
  const wireClass = (src: string) => {
    const isInput = level.inputs.includes(src)
    if (!reveal && !isInput) return 'wire unknown'
    return values[src] ? 'wire on' : 'wire off'
  }

  return (
    <svg className="circuit" viewBox={`0 0 ${width + 60} ${height}`} role="img" aria-label={level.expression}>
      {level.inputs.map((name, i) => (
        <g
          key={name}
          className={level.locked?.[i] ? 'input-locked' : onToggle ? 'input-toggle' : undefined}
          onClick={() => !level.locked?.[i] && onToggle?.(i)}
        >
          <line x1={busX(i)} y1={TOP - 10} x2={busX(i)} y2={height - 10} className={values[name] ? 'wire on' : 'wire off'} />
          <circle cx={busX(i)} cy={18} r={12} className={values[name] ? 'pin on' : 'pin off'} />
          <text x={busX(i)} y={22} textAnchor="middle" className="pin-text">{values[name] ? 1 : 0}</text>
          <text x={busX(i)} y={TOP - 4} textAnchor="middle" className="label">{level.locked?.[i] ? `🔒${name}` : name}</text>
        </g>
      ))}

      {gates.flatMap((gate) =>
        gate.inputs.map((src, k) => {
          const y = pinY(gate, k)
          const x2 = pinX(gate)
          const source = placed[src]
          if (!source) {
            const bx = busX(level.inputs.indexOf(src))
            return (
              <g key={`${gate.id}-${k}`}>
                <path d={`M${bx},${y} H${x2}`} className={wireClass(src)} />
                <circle cx={bx} cy={y} r={3.5} className={values[src] ? 'joint on' : 'joint off'} />
              </g>
            )
          }
          const sx = source.x + outX(source.type)
          if (source.x >= gate.x) {
            // Feedback: loop below both gates and come back from the left
            const loopY = Math.max(source.y, gate.y) + 40 + lane[src] * 8
            const d = `M${sx},${source.y} H${sx + 14} V${loopY} H${x2 - 18 - lane[src] * 8} V${y} H${x2}`
            return <path key={`${gate.id}-${k}`} d={d} className={wireClass(src)} />
          }
          const mid = sx + 12 + lane[src] * 8
          return <path key={`${gate.id}-${k}`} d={`M${sx},${source.y} H${mid} V${y} H${x2}`} className={wireClass(src)} />
        }),
      )}

      {gates.map((gate) => (
        <g key={gate.id} transform={`translate(${gate.x},${gate.y - 20})`} className="gate">
          <GateShape type={gate.type} />
          <text x={gate.type === 'NOT' ? 15 : 24} y={24} className="gate-label" textAnchor="middle">
            {gate.type === 'NOT' ? '' : gate.type}
          </text>
        </g>
      ))}

      {outputs.map((out, i) => {
        const on = values[out.id]
        const state = reveal ? (on ? 'on' : 'off') : 'unknown'
        return (
          <g key={out.id}>
            <path d={`M${out.x + outX(out.type)},${out.y} H${width + 10}`} className={`wire ${state}`} />
            <circle cx={width + 26} cy={out.y} r={14} className={`bulb ${state}`} />
            <text x={width + 26} y={out.y + 4} textAnchor="middle" className="pin-text">{reveal ? Number(on) : '?'}</text>
            <text x={width + 26} y={out.y - 20} textAnchor="middle" className="label">{level.outputLabels?.[i] ?? 'Q'}</text>
          </g>
        )
      })}
    </svg>
  )
}
