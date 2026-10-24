import { blockAnswer, blockAnswerLabels, type BlockSpec } from './blocks'

export type GateType = 'NOT' | 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR'

export type Gate = { id: string; type: GateType; inputs: string[] }

type LevelText = { title: string; lesson: string; expression: string }

/** Puzzle played on a gate-level circuit. */
export type Level = LevelText & {
  inputs: string[]
  gates: Gate[] // gates may reference later gates (feedback loops)
  outputs?: string[] // output gate ids, default: last gate
  outputLabels?: string[]
  locked?: boolean[] // inputs the player cannot toggle
} & (
  | {
      mode: 'solve'
      target: boolean | boolean[] // one value per output
      start?: boolean[]
      requireInputs?: boolean[] // inputs must also end in this state (e.g. latch: both released)
    }
  | { mode: 'predict'; fixed: boolean[] } // answer every output
  | { mode: 'sequence'; steps: boolean[][] } // answer the first output after each step (memory carries over)
)

/** Puzzle played on a bigger machine drawn as blocks. */
export type BlockLevel = LevelText & { mode: 'block'; block: BlockSpec }

export type GameLevel = Level | BlockLevel

export const isCircuit = (level: GameLevel): level is Level => level.mode !== 'block'

export const GATE_FN: Record<GateType, (v: boolean[]) => boolean> = {
  NOT: (v) => !v[0],
  AND: (v) => v.every(Boolean),
  OR: (v) => v.some(Boolean),
  NAND: (v) => !v.every(Boolean),
  NOR: (v) => !v.some(Boolean),
  XOR: (v) => v.filter(Boolean).length % 2 === 1,
  XNOR: (v) => v.filter(Boolean).length % 2 === 0,
}

export const GATE_INFO: Record<GateType, string> = {
  NOT: 'Odwraca sygnał: 0 → 1, 1 → 0.',
  AND: '1 tylko gdy wszystkie wejścia = 1.',
  OR: '1 gdy choć jedno wejście = 1.',
  NAND: 'Odwrotność AND: 0 tylko gdy wszystkie = 1.',
  NOR: 'Odwrotność OR: 1 tylko gdy wszystkie = 0.',
  XOR: '1 gdy wejścia są różne (nieparzysta liczba jedynek).',
  XNOR: '1 gdy wejścia są takie same.',
}

export type Signals = Record<string, boolean>

/**
 * Evaluate every node. `previous` holds the last gate values, so circuits with
 * feedback (latches) keep their memory; we iterate until the signals settle.
 */
export function evaluate(level: Level, inputValues: boolean[], previous: Signals = {}): Signals {
  const values: Signals = { ...previous }
  level.inputs.forEach((name, i) => (values[name] = inputValues[i] ?? false))
  for (let pass = 0; pass < 20; pass++) {
    let changed = false
    for (const gate of level.gates) {
      const next = GATE_FN[gate.type](gate.inputs.map((src) => values[src] ?? false))
      if (values[gate.id] !== next) changed = true
      values[gate.id] = next
    }
    if (!changed) break
  }
  return values
}

export const outputIds = (level: Level) => level.outputs ?? [level.gates[level.gates.length - 1].id]

export const outputOf = (level: Level, inputValues: boolean[], previous?: Signals) =>
  evaluate(level, inputValues, previous)[outputIds(level)[0]]

/** Run the steps of a sequence puzzle; returns the first output after each step. */
export function runSequence(level: Level & { mode: 'sequence' }): boolean[] {
  let memory = evaluate(level, level.inputs.map(() => false))
  return level.steps.map((step) => {
    memory = evaluate(level, step, memory)
    return memory[outputIds(level)[0]]
  })
}

/** Correct answer bits for answer-type puzzles (predict / sequence / block). */
export function expectedAnswer(level: GameLevel): boolean[] {
  if (level.mode === 'block') return blockAnswer(level.block)
  if (level.mode === 'sequence') return runSequence(level)
  if (level.mode === 'predict') {
    const values = evaluate(level, level.fixed)
    return outputIds(level).map((id) => values[id])
  }
  return []
}

export function answerLabels(level: GameLevel): string[] {
  if (level.mode === 'block') return blockAnswerLabels(level.block)
  if (level.mode === 'sequence') return level.steps.map((_, i) => `krok ${i + 1}`)
  return outputIds(level).map((_, i) => level.outputLabels?.[i] ?? 'Q')
}

export function isSolved(level: Level, inputValues: boolean[], previous: Signals): boolean {
  if (level.mode !== 'solve') return false
  const values = evaluate(level, inputValues, previous)
  const targets = Array.isArray(level.target) ? level.target : [level.target]
  const outputsOk = outputIds(level).every((id, i) => targets[i] === undefined || values[id] === targets[i])
  const inputsOk = !level.requireInputs || level.requireInputs.every((v, i) => inputValues[i] === v)
  return outputsOk && inputsOk
}

export const LEVELS: GameLevel[] = [
  {
    title: 'NOT',
    lesson: 'Bramka NOT (negacja) odwraca sygnał. Ustaw wejście tak, żeby Q = 1.',
    expression: 'Q = ¬A',
    inputs: ['A'],
    gates: [{ id: 'q', type: 'NOT', inputs: ['A'] }],
    mode: 'solve',
    target: true,
    start: [true],
  },
  {
    title: 'AND',
    lesson: 'AND daje 1 tylko gdy oba wejścia są 1. Zapal wyjście.',
    expression: 'Q = A · B',
    inputs: ['A', 'B'],
    gates: [{ id: 'q', type: 'AND', inputs: ['A', 'B'] }],
    mode: 'solve',
    target: true,
  },
  {
    title: 'OR',
    lesson: 'OR daje 1 gdy choć jedno wejście jest 1. Tym razem zgaś wyjście (Q = 0).',
    expression: 'Q = A + B',
    inputs: ['A', 'B'],
    gates: [{ id: 'q', type: 'OR', inputs: ['A', 'B'] }],
    mode: 'solve',
    target: false,
    start: [true, false],
  },
  {
    title: 'NAND — przewiduj',
    lesson: 'NAND to AND z negacją (kółko na wyjściu). Wejścia są ustalone — jaki będzie wynik?',
    expression: 'Q = ¬(A · B)',
    inputs: ['A', 'B'],
    gates: [{ id: 'q', type: 'NAND', inputs: ['A', 'B'] }],
    mode: 'predict',
    fixed: [true, true],
  },
  {
    title: 'NOR',
    lesson: 'NOR to OR z negacją. Zapal wyjście.',
    expression: 'Q = ¬(A + B)',
    inputs: ['A', 'B'],
    gates: [{ id: 'q', type: 'NOR', inputs: ['A', 'B'] }],
    mode: 'solve',
    target: true,
    start: [true, true],
  },
  {
    title: 'XOR',
    lesson: 'XOR (alternatywa wykluczająca) daje 1, gdy wejścia są różne. Zapal wyjście.',
    expression: 'Q = A ⊕ B',
    inputs: ['A', 'B'],
    gates: [{ id: 'q', type: 'XOR', inputs: ['A', 'B'] }],
    mode: 'solve',
    target: true,
  },
  {
    title: 'XNOR — przewiduj',
    lesson: 'XNOR daje 1, gdy wejścia są takie same. Jaki będzie wynik?',
    expression: 'Q = ¬(A ⊕ B)',
    inputs: ['A', 'B'],
    gates: [{ id: 'q', type: 'XNOR', inputs: ['A', 'B'] }],
    mode: 'predict',
    fixed: [true, false],
  },
  {
    title: 'Pierwszy układ',
    lesson: 'Bramki można łączyć. Wyjście NOT trafia do AND. Zapal Q.',
    expression: 'Q = ¬A · B',
    inputs: ['A', 'B'],
    gates: [
      { id: 'n', type: 'NOT', inputs: ['A'] },
      { id: 'q', type: 'AND', inputs: ['n', 'B'] },
    ],
    mode: 'solve',
    target: true,
  },
  {
    title: 'Trzy wejścia',
    lesson: 'AND z trzema wejściami potrzebuje trzech jedynek. Zapal Q.',
    expression: 'Q = ¬(A · B) · B · ¬C',
    inputs: ['A', 'B', 'C'],
    gates: [
      { id: 'nand', type: 'NAND', inputs: ['A', 'B'] },
      { id: 'nc', type: 'NOT', inputs: ['C'] },
      { id: 'q', type: 'AND', inputs: ['nand', 'B', 'nc'] },
    ],
    mode: 'solve',
    target: true,
  },
  {
    title: 'OR + NOR',
    lesson: 'Śledź sygnał gałąź po gałęzi. Zapal Q.',
    expression: 'Q = (A + B) · ¬(A + ¬B)',
    inputs: ['A', 'B'],
    gates: [
      { id: 'or', type: 'OR', inputs: ['A', 'B'] },
      { id: 'nb', type: 'NOT', inputs: ['B'] },
      { id: 'nor', type: 'NOR', inputs: ['A', 'nb'] },
      { id: 'q', type: 'AND', inputs: ['or', 'nor'] },
    ],
    mode: 'solve',
    target: true,
  },
  {
    title: 'XOR z samych NAND',
    lesson: 'Z samych bramek NAND da się zbudować każdą inną. Policz krok po kroku — jaki wynik?',
    expression: 'Q = NAND(NAND(A, n), NAND(B, n)), n = NAND(A, B)',
    inputs: ['A', 'B'],
    gates: [
      { id: 'n1', type: 'NAND', inputs: ['A', 'B'] },
      { id: 'n2', type: 'NAND', inputs: ['A', 'n1'] },
      { id: 'n3', type: 'NAND', inputs: ['B', 'n1'] },
      { id: 'q', type: 'NAND', inputs: ['n2', 'n3'] },
    ],
    mode: 'predict',
    fixed: [true, false],
  },
  {
    title: 'Duży układ',
    lesson: 'Prawdziwy układ z automatyki. Znajdź kombinację, która zapala Q.',
    expression: 'Q = ¬(ABC)·(¬A+¬B+C) · (A·¬B)·(A+B+¬C)',
    inputs: ['A', 'B', 'C'],
    gates: [
      { id: 'g1', type: 'AND', inputs: ['A', 'B', 'C'] },
      { id: 'na', type: 'NOT', inputs: ['A'] },
      { id: 'nb', type: 'NOT', inputs: ['B'] },
      { id: 'nc', type: 'NOT', inputs: ['C'] },
      { id: 'n1', type: 'NOT', inputs: ['g1'] },
      { id: 'g3', type: 'OR', inputs: ['na', 'nb', 'C'] },
      { id: 'g5', type: 'AND', inputs: ['A', 'nb'] },
      { id: 'g6', type: 'OR', inputs: ['A', 'B', 'nc'] },
      { id: 'g4', type: 'AND', inputs: ['n1', 'g3'] },
      { id: 'g7', type: 'AND', inputs: ['g5', 'g6'] },
      { id: 'q', type: 'AND', inputs: ['g4', 'g7'] },
    ],
    mode: 'solve',
    target: true,
  },
  {
    title: 'Duży układ — przewiduj',
    lesson: 'Ten sam duży układ, ustalone wejścia. Bez podglądu sygnałów — jaki będzie wynik?',
    expression: 'Q = ¬(ABC)·(¬A+¬B+C) · (A·¬B)·(A+B+¬C)',
    inputs: ['A', 'B', 'C'],
    gates: [
      { id: 'g1', type: 'AND', inputs: ['A', 'B', 'C'] },
      { id: 'na', type: 'NOT', inputs: ['A'] },
      { id: 'nb', type: 'NOT', inputs: ['B'] },
      { id: 'nc', type: 'NOT', inputs: ['C'] },
      { id: 'n1', type: 'NOT', inputs: ['g1'] },
      { id: 'g3', type: 'OR', inputs: ['na', 'nb', 'C'] },
      { id: 'g5', type: 'AND', inputs: ['A', 'nb'] },
      { id: 'g6', type: 'OR', inputs: ['A', 'B', 'nc'] },
      { id: 'g4', type: 'AND', inputs: ['n1', 'g3'] },
      { id: 'g7', type: 'AND', inputs: ['g5', 'g6'] },
      { id: 'q', type: 'AND', inputs: ['g4', 'g7'] },
    ],
    mode: 'predict',
    fixed: [true, true, false],
  },
  {
    title: 'Multiplekser 2→1 (MUX)',
    lesson: 'Cyfrowy przełącznik torów: S wybiera, które wejście danych trafia na Q. D0 = 0 jest zablokowane — przepuść sygnał z D1, żeby Q = 1.',
    expression: 'Q = D0·¬S + D1·S',
    inputs: ['D0', 'D1', 'S'],
    locked: [true, false, false],
    gates: [
      { id: 'ns', type: 'NOT', inputs: ['S'] },
      { id: 'a0', type: 'AND', inputs: ['D0', 'ns'] },
      { id: 'a1', type: 'AND', inputs: ['D1', 'S'] },
      { id: 'q', type: 'OR', inputs: ['a0', 'a1'] },
    ],
    mode: 'solve',
    target: true,
  },
  {
    title: 'Komparator 2-bitowy',
    lesson: 'Sprawdzenie IF (A == B). XNOR daje 1 dla równych bitów. Liczba A = 10₂ jest ustalona — dobierz bity B, żeby Equal = 1.',
    expression: 'Equal = ¬(A1 ⊕ B1) · ¬(A0 ⊕ B0)',
    inputs: ['A1', 'A0', 'B1', 'B0'],
    locked: [true, true, false, false],
    start: [true, false, false, true],
    outputLabels: ['EQ'],
    gates: [
      { id: 'x1', type: 'XNOR', inputs: ['A1', 'B1'] },
      { id: 'x0', type: 'XNOR', inputs: ['A0', 'B0'] },
      { id: 'eq', type: 'AND', inputs: ['x1', 'x0'] },
    ],
    mode: 'solve',
    target: true,
  },
  {
    title: 'Generator parzystości',
    lesson: 'Bit parzystości wykrywa przekłamania w transmisji: P = 1 przy nieparzystej liczbie jedynek. Trzy wejścia są zapalone — zgaś P.',
    expression: 'P = (A ⊕ B) ⊕ (C ⊕ D)',
    inputs: ['A', 'B', 'C', 'D'],
    start: [true, true, true, false],
    outputLabels: ['P'],
    gates: [
      { id: 'x1', type: 'XOR', inputs: ['A', 'B'] },
      { id: 'x2', type: 'XOR', inputs: ['C', 'D'] },
      { id: 'p', type: 'XOR', inputs: ['x1', 'x2'] },
    ],
    mode: 'solve',
    target: false,
  },
  {
    title: 'Pełny sumator (Full Adder)',
    lesson: 'Serce ALU: dodaje A + B + przeniesienie Cin. Policz binarnie 1 + 1 + 1 = 11₂ — zapal oba wyjścia: S i Cout.',
    expression: 'S = A ⊕ B ⊕ Cin,  Cout = A·B + Cin·(A ⊕ B)',
    inputs: ['A', 'B', 'Cin'],
    outputs: ['s', 'cout'],
    outputLabels: ['S', 'Cout'],
    gates: [
      { id: 'x1', type: 'XOR', inputs: ['A', 'B'] },
      { id: 'ab', type: 'AND', inputs: ['A', 'B'] },
      { id: 's', type: 'XOR', inputs: ['x1', 'Cin'] },
      { id: 'cx', type: 'AND', inputs: ['Cin', 'x1'] },
      { id: 'cout', type: 'OR', inputs: ['ab', 'cx'] },
    ],
    mode: 'solve',
    target: [true, true],
  },
  {
    title: 'Zatrzask SR (pamięć)',
    lesson: 'Sprzężenie zwrotne: wyjście każdej bramki NOR wraca na wejście drugiej, więc układ pamięta stan. Zapisz 1 (S), a potem zwolnij oba wejścia — Q ma dalej świecić. S = R = 1 to stan zakazany.',
    expression: 'Q = ¬(R + Q̄),  Q̄ = ¬(S + Q)',
    inputs: ['S', 'R'],
    outputs: ['q', 'qn'],
    outputLabels: ['Q', 'Q̄'],
    gates: [
      { id: 'qn', type: 'NOR', inputs: ['S', 'q'] },
      { id: 'q', type: 'NOR', inputs: ['R', 'qn'] },
    ],
    mode: 'solve',
    target: [true, false],
    requireInputs: [false, false],
  },
  {
    title: 'MUX 4→1 — który kabel przejdzie?',
    lesson: 'Cztery dane, dwa bity wyboru S1 S0. Wygląda groźnie, ale wystarczy ustalić, które AND jest aktywne — reszty nie trzeba liczyć.',
    expression: 'Q = D[S1S0]  (S1S0 = 10 → D2)',
    inputs: ['D0', 'D1', 'D2', 'D3', 'S1', 'S0'],
    gates: [
      { id: 'n1', type: 'NOT', inputs: ['S1'] },
      { id: 'n0', type: 'NOT', inputs: ['S0'] },
      { id: 'a0', type: 'AND', inputs: ['D0', 'n1', 'n0'] },
      { id: 'a1', type: 'AND', inputs: ['D1', 'n1', 'S0'] },
      { id: 'a2', type: 'AND', inputs: ['D2', 'S1', 'n0'] },
      { id: 'a3', type: 'AND', inputs: ['D3', 'S1', 'S0'] },
      { id: 'q', type: 'OR', inputs: ['a0', 'a1', 'a2', 'a3'] },
    ],
    mode: 'predict',
    fixed: [true, false, true, false, true, false],
  },
  {
    title: 'Bramki nauczyły się dodawać',
    lesson: 'Ten sam pełny sumator, ale teraz przewidujesz oba wyjścia. Ile to 1 + 1 + 1 binarnie?',
    expression: 'S = A ⊕ B ⊕ Cin,  Cout = A·B + Cin·(A ⊕ B)',
    inputs: ['A', 'B', 'Cin'],
    outputs: ['s', 'cout'],
    outputLabels: ['S', 'Cout'],
    gates: [
      { id: 'x1', type: 'XOR', inputs: ['A', 'B'] },
      { id: 'ab', type: 'AND', inputs: ['A', 'B'] },
      { id: 's', type: 'XOR', inputs: ['x1', 'Cin'] },
      { id: 'cx', type: 'AND', inputs: ['Cin', 'x1'] },
      { id: 'cout', type: 'OR', inputs: ['ab', 'cx'] },
    ],
    mode: 'predict',
    fixed: [true, true, true],
  },
  {
    title: 'Kto większy? — komparator',
    lesson: 'Komparator 2-bitowy wystawia trzy wyniki: A>B, A=B, A<B. A = 10₂, B = 01₂ — które światło się zapali?',
    expression: 'GT = A1·¬B1 + (A1⊙B1)·A0·¬B0,  EQ = (A1⊙B1)·(A0⊙B0),  LT = ¬A1·B1 + (A1⊙B1)·¬A0·B0',
    inputs: ['A1', 'A0', 'B1', 'B0'],
    outputs: ['gt', 'eq', 'lt'],
    outputLabels: ['A>B', 'A=B', 'A<B'],
    gates: [
      { id: 'na1', type: 'NOT', inputs: ['A1'] },
      { id: 'na0', type: 'NOT', inputs: ['A0'] },
      { id: 'nb1', type: 'NOT', inputs: ['B1'] },
      { id: 'nb0', type: 'NOT', inputs: ['B0'] },
      { id: 'x1', type: 'XNOR', inputs: ['A1', 'B1'] },
      { id: 'x0', type: 'XNOR', inputs: ['A0', 'B0'] },
      { id: 'g1', type: 'AND', inputs: ['A1', 'nb1'] },
      { id: 'g0', type: 'AND', inputs: ['x1', 'A0', 'nb0'] },
      { id: 'l1', type: 'AND', inputs: ['na1', 'B1'] },
      { id: 'l0', type: 'AND', inputs: ['x1', 'na0', 'B0'] },
      { id: 'gt', type: 'OR', inputs: ['g1', 'g0'] },
      { id: 'eq', type: 'AND', inputs: ['x1', 'x0'] },
      { id: 'lt', type: 'OR', inputs: ['l1', 'l0'] },
    ],
    mode: 'predict',
    fixed: [true, false, false, true],
  },
  {
    title: 'Układ pamięta — oś czasu',
    lesson: 'Zatrzask SR w czasie. Początkowo Q = 0. Podaj Q po każdym z czterech kroków — wynik zależy od tego, co było wcześniej.',
    expression: 'Q = ¬(R + Q̄),  Q̄ = ¬(S + Q)',
    inputs: ['S', 'R'],
    outputs: ['q', 'qn'],
    outputLabels: ['Q', 'Q̄'],
    gates: [
      { id: 'qn', type: 'NOR', inputs: ['S', 'q'] },
      { id: 'q', type: 'NOR', inputs: ['R', 'qn'] },
    ],
    mode: 'sequence',
    steps: [
      [true, false],
      [false, false],
      [false, true],
      [false, false],
    ],
  },
  {
    title: 'Efekt domina — sumator 4-bit',
    lesson: 'Cztery pełne sumatory w łańcuchu: przeniesienie z każdego stopnia wpada do następnego. Policz 0111 + 0001.',
    expression: '0111 + 0001 = ?',
    mode: 'block',
    block: { kind: 'adder', a: '0111', b: '0001' },
  },
  {
    title: 'Przepełnienie',
    lesson: 'Ten sam sumator: 1111 + 0001. Cztery bity wyniku to nie wszystko — patrz na Cout.',
    expression: '1111 + 0001 = ?',
    mode: 'block',
    block: { kind: 'adder', a: '1111', b: '0001' },
  },
  {
    title: 'Przycisk TICK — licznik',
    lesson: 'Licznik 4-bitowy modulo 16. Startuje od 1101, ENABLE = 1. Co pokaże po 5 impulsach?',
    expression: '1101 + 5 (mod 16) = ?',
    mode: 'block',
    block: { kind: 'counter', start: '1101', enable: [true, true, true, true, true] },
  },
  {
    title: 'Licznik z ENABLE',
    lesson: 'Gdy ENABLE = 0, impuls TICK nic nie zmienia. Start 0110 — co pokaże licznik po wszystkich impulsach?',
    expression: 'licz tylko impulsy z EN = 1',
    mode: 'block',
    block: { kind: 'counter', start: '0110', enable: [true, false, true, true, false, true] },
  },
  {
    title: 'Mały mózg kalkulatora — ALU',
    lesson: 'ALU liczy wszystkie operacje równolegle, a multiplekser wybiera wynik kodem OP. A = 0110, B = 0011, OP = 11.',
    expression: 'OP: 00 AND · 01 OR · 10 XOR · 11 ADD',
    mode: 'block',
    block: { kind: 'alu', a: '0110', b: '0011', op: '11' },
  },
  {
    title: 'ALU — tryb logiczny',
    lesson: 'Te same liczby, inny kod operacji: OP = 10. Policz bit po bicie.',
    expression: 'OP: 00 AND · 01 OR · 10 XOR · 11 ADD',
    mode: 'block',
    block: { kind: 'alu', a: '0110', b: '0011', op: '10' },
  },
  {
    title: 'Boss: mini procesor',
    lesson: 'Dwa rejestry 4-bitowe (A, B), ALU i program. Wykonaj program w głowie i podaj binarnie, co wypisze OUT.',
    expression: 'LOAD · ADD · XOR · OUT (wynik mod 16)',
    mode: 'block',
    block: {
      kind: 'cpu',
      program: [
        { op: 'LOAD', reg: 'A', value: 3 },
        { op: 'LOAD', reg: 'B', value: 5 },
        { op: 'ADD', reg: 'A', src: 'B' },
        { op: 'OUT', reg: 'A' },
      ],
    },
  },
]
