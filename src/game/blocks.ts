// Block-level puzzles: bigger machines shown as blocks instead of individual gates

export type Bits = boolean[] // MSB first

export const toBits = (value: number, width = 4): Bits =>
  Array.from({ length: width }, (_, i) => ((value >> (width - 1 - i)) & 1) === 1)
export const fromBits = (bits: Bits) => bits.reduce((n, b) => n * 2 + Number(b), 0)
export const bitString = (bits: Bits) => bits.map(Number).join('')
const bits = (s: string): Bits => [...s].map((c) => c === '1')

export type AdderSpec = { kind: 'adder'; a: string; b: string }
export type CounterSpec = { kind: 'counter'; start: string; enable: boolean[] } // one entry per TICK
export type AluSpec = { kind: 'alu'; a: string; b: string; op: string }
export type Instruction = { op: 'LOAD'; reg: 'A' | 'B'; value: number } | { op: 'ADD' | 'XOR'; reg: 'A' | 'B'; src: 'A' | 'B' } | { op: 'OUT'; reg: 'A' | 'B' }
export type CpuSpec = { kind: 'cpu'; program: Instruction[] }

export type BlockSpec = AdderSpec | CounterSpec | AluSpec | CpuSpec

/** Ripple-carry adder: per stage (LSB first) sum and carry-out. */
export function rippleAdd(a: string, b: string) {
  const A = bits(a).reverse()
  const B = bits(b).reverse()
  let carry = false
  const stages = A.map((ai, i) => {
    const cin = carry
    const sum = (ai !== B[i]) !== cin
    carry = (ai && B[i]) || (cin && ai !== B[i])
    return { a: ai, b: B[i], cin, sum, cout: carry }
  })
  return { stages, sum: stages.map((s) => s.sum).reverse(), carry }
}

export function runCounter(spec: CounterSpec) {
  const trace = [fromBits(bits(spec.start))]
  for (const enabled of spec.enable) trace.push(enabled ? (trace[trace.length - 1] + 1) % 16 : trace[trace.length - 1])
  return trace
}

export const ALU_OPS: Record<string, { label: string; fn: (a: number, b: number) => number }> = {
  '00': { label: 'A AND B', fn: (a, b) => a & b },
  '01': { label: 'A OR B', fn: (a, b) => a | b },
  '10': { label: 'A XOR B', fn: (a, b) => a ^ b },
  '11': { label: 'A + B', fn: (a, b) => (a + b) % 16 },
}

export const runAlu = (spec: AluSpec) => ALU_OPS[spec.op].fn(fromBits(bits(spec.a)), fromBits(bits(spec.b)))

export const formatInstruction = (ins: Instruction) =>
  ins.op === 'LOAD' ? `LOAD ${ins.reg}, ${ins.value}` : ins.op === 'OUT' ? `OUT ${ins.reg}` : `${ins.op} ${ins.reg}, ${ins.src}`

/** 4-bit toy CPU: registers A and B, results wrap modulo 16. */
export function runCpu(spec: CpuSpec) {
  const regs = { A: 0, B: 0 }
  let out = 0
  const trace = spec.program.map((ins) => {
    if (ins.op === 'LOAD') regs[ins.reg] = ins.value % 16
    else if (ins.op === 'ADD') regs[ins.reg] = (regs[ins.reg] + regs[ins.src]) % 16
    else if (ins.op === 'XOR') regs[ins.reg] = regs[ins.reg] ^ regs[ins.src]
    else out = regs[ins.reg]
    return { ins, A: regs.A, B: regs.B, out }
  })
  return { trace, out }
}

/** Expected answer bits for a block puzzle. */
export function blockAnswer(spec: BlockSpec): Bits {
  switch (spec.kind) {
    case 'adder': {
      const { sum, carry } = rippleAdd(spec.a, spec.b)
      return [carry, ...sum]
    }
    case 'counter': {
      const trace = runCounter(spec)
      return toBits(trace[trace.length - 1])
    }
    case 'alu':
      return toBits(runAlu(spec))
    case 'cpu':
      return toBits(runCpu(spec).out)
  }
}

export const blockAnswerLabels = (spec: BlockSpec) => (spec.kind === 'adder' ? ['Cout', 'S3', 'S2', 'S1', 'S0'] : ['b3', 'b2', 'b1', 'b0'])
