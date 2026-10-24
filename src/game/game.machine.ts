import { assign, setup } from 'xstate'
import { LEVELS, answerLabels, evaluate, expectedAnswer, isCircuit, isSolved, type GameLevel, type Signals } from './gates'

const STORAGE_KEY = 'viz-app:gates-stars'

function loadStars(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as number[]) : []
  } catch {
    return []
  }
}

function saveStars(stars: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stars))
  } catch {
    // storage unavailable — progress lives only in memory
  }
}

export function startInputs(level: GameLevel): boolean[] {
  if (!isCircuit(level)) return []
  if (level.mode === 'predict') return [...level.fixed]
  if (level.mode === 'solve' && level.start) return [...level.start]
  return level.inputs.map(() => false)
}

function freshLevel(index: number) {
  const level = LEVELS[index]
  const inputs = startInputs(level)
  return {
    level: index,
    inputs,
    memory: isCircuit(level) ? evaluate(level, inputs) : {},
    answer: answerLabels(level).map(() => false),
    mistakes: 0,
    wrong: false,
  }
}

type Context = {
  level: number
  inputs: boolean[]
  memory: Signals
  answer: boolean[] // player's answer bits (predict / sequence / block)
  mistakes: number
  wrong: boolean
  stars: number[]
}

type Event =
  | { type: 'TOGGLE'; index: number }
  | { type: 'TOGGLE_ANSWER'; index: number }
  | { type: 'CHECK' }
  | { type: 'NEXT' }
  | { type: 'SELECT'; level: number }
  | { type: 'RESET_PROGRESS' }

export const unlockedCount = (stars: number[]) => Math.min(LEVELS.length, stars.filter((s) => s > 0).length + 1)

export const gameMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  guards: {
    canToggle: ({ context, event }) => {
      const level = LEVELS[context.level]
      return event.type === 'TOGGLE' && level.mode === 'solve' && !level.locked?.[event.index]
    },
    isSolved: ({ context }) => {
      const level = LEVELS[context.level]
      if (level.mode === 'solve') return isSolved(level, context.inputs, context.memory)
      return expectedAnswer(level).every((bit, i) => context.answer[i] === bit)
    },
    isLastLevel: ({ context }) => context.level === LEVELS.length - 1,
    isUnlocked: ({ context, event }) => event.type === 'SELECT' && event.level < unlockedCount(context.stars),
  },
  actions: {
    markWrong: assign({ mistakes: ({ context }) => context.mistakes + 1, wrong: true }),
    recordStars: assign({
      stars: ({ context }) => {
        const earned = context.mistakes === 0 ? 3 : context.mistakes === 1 ? 2 : 1
        const stars = [...context.stars]
        stars[context.level] = Math.max(stars[context.level] ?? 0, earned)
        saveStars(stars)
        return stars
      },
    }),
    loadLevel: assign((_, params: { level: number }) => freshLevel(params.level)),
  },
}).createMachine({
  id: 'gatesGame',
  context: () => {
    const stars = loadStars()
    return { ...freshLevel(Math.min(unlockedCount(stars) - 1, LEVELS.length - 1)), stars }
  },
  initial: 'playing',
  on: {
    SELECT: {
      guard: 'isUnlocked',
      target: '.playing',
      actions: { type: 'loadLevel', params: ({ event }) => ({ level: event.level }) },
    },
    RESET_PROGRESS: {
      target: '.playing',
      actions: [assign({ stars: () => (saveStars([]), []) }), { type: 'loadLevel', params: { level: 0 } }],
    },
  },
  states: {
    playing: {
      on: {
        TOGGLE: {
          guard: 'canToggle',
          actions: assign(({ context, event }) => {
            const level = LEVELS[context.level]
            const inputs = context.inputs.map((v, i) => (i === event.index ? !v : v))
            // Keep settled signals so feedback circuits remember their state
            return { inputs, memory: isCircuit(level) ? evaluate(level, inputs, context.memory) : {}, wrong: false }
          }),
        },
        TOGGLE_ANSWER: {
          actions: assign({
            answer: ({ context, event }) => context.answer.map((v, i) => (i === event.index ? !v : v)),
            wrong: false,
          }),
        },
        CHECK: [{ guard: 'isSolved', target: 'success', actions: 'recordStars' }, { actions: 'markWrong' }],
      },
    },
    success: {
      on: {
        NEXT: [
          { guard: 'isLastLevel', target: 'finished' },
          { target: 'playing', actions: { type: 'loadLevel', params: ({ context }) => ({ level: context.level + 1 }) } },
        ],
      },
    },
    finished: {},
  },
})
