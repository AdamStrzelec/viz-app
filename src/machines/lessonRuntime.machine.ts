import { assign, setup } from 'xstate'
import { ALL_POSITIONS, SAMPLE_LESSON } from './lessonRuntime.data'

// Learner runtime, modelled on pakiety/lekcja-ui/src/lib/srs.ts (React port) with the v2 engine
// (lekcje/_silnik/demo/index.html) as a switchable variant for the one known divergence.

export const DAY = 86_400_000
export const MINUTE = 60_000
export const SRS_INTERVALS = [0, 1, 3, 7, 16, 35] as const
export const MASTERED_STREAK = 2
export const SRS_STORAGE_KEY = 'med_srs_v1'
export const UI_KEY = `med_ui_${SAMPLE_LESSON.slug}`

export type SrsItem = { box: number; due: number; ok: number; n: number; zle: number; lekcja: string; mod: string; typ: string }
export type SrsState = { ver: 1; items: Record<string, SrsItem> }
/** react = srs.ts (miss → due = now + 0), v2 = demo/index.html ocen() (miss → due = now + 10 min) */
export type DueMode = 'react' | 'v2'
export type BiegMode = 'dzis' | 'bledy' | 'mix'

export const itemKey = (cid: string) => `${SAMPLE_LESSON.slug}:${cid}`
export const LESSON_KEYS = ALL_POSITIONS.map((p) => itemKey(p.cid))

export function rate(state: SrsState, key: string, ok: boolean, now: number, mode: DueMode): SrsState {
  const prev = state.items[key]
  if (!prev) return state
  const box = ok ? Math.min(SRS_INTERVALS.length - 1, prev.box + 1) : 0
  const due = !ok && mode === 'v2' ? now + 10 * MINUTE : now + SRS_INTERVALS[box] * DAY
  const item = { ...prev, box, due, ok: ok ? prev.ok + 1 : 0, n: prev.n + 1, zle: prev.zle + (ok ? 0 : 1) }
  return { ver: 1, items: { ...state.items, [key]: item } }
}

export const isMastered = (it?: SrsItem) => Boolean(it && it.ok >= MASTERED_STREAK)
export const isDue = (it: SrsItem | undefined, now: number) => Boolean(it && it.due <= now)

export function progress(srs: SrsState, now: number, akty: string[]) {
  const items = LESSON_KEYS.map((k) => srs.items[k])
  return {
    wszystkie: LESSON_KEYS.length,
    opanowane: items.filter(isMastered).length,
    dzis: items.filter((it) => isDue(it, now)).length,
    bledy: items.filter((it) => it && it.zle > 0).length,
    // v2 "Przerobione" bar: unique acts / (positions * 2), capped at 100%
    przerobione: Math.min(1, akty.length / (LESSON_KEYS.length * 2)),
  }
}

export function biegQueue(srs: SrsState, now: number, mode: BiegMode) {
  return LESSON_KEYS.filter((k) => {
    const it = srs.items[k]
    if (!it) return false
    if (mode === 'bledy') return it.zle > 0
    if (mode === 'dzis') return isDue(it, now)
    return true
  })
}

type Ctx = {
  now: number
  dueMode: DueMode
  srs: SrsState
  akty: string[]
  module: string | null
  biegMode: BiegMode | null
  queue: string[]
  lastEvent: string
}

export type RuntimeEvent =
  | { type: 'LOAD' }
  | { type: 'SET_DUE_MODE'; mode: DueMode }
  | { type: 'OPEN_MODULE'; mod: string }
  | { type: 'STEP'; mod: string; i: number }
  | { type: 'ANSWER'; cid: string; ok: boolean }
  | { type: 'START_BIEG'; mode: BiegMode }
  | { type: 'START_KOLOKWIUM' }
  | { type: 'BACK' }
  | { type: 'ADVANCE'; days: number }
  | { type: 'RESET' }

const initialContext = (dueMode: DueMode = 'react'): Ctx => ({
  now: 8 * 60 * MINUTE, // day 0, 08:00
  dueMode,
  srs: { ver: 1, items: {} },
  akty: [],
  module: null,
  biegMode: null,
  queue: [],
  lastEvent: '—',
})

const addAkt = (ctx: Ctx, k: string) => (ctx.akty.includes(k) ? ctx.akty : [...ctx.akty, k])

const rateFromEvent = (context: Ctx, event: RuntimeEvent) =>
  event.type === 'ANSWER' ? rate(context.srs, itemKey(event.cid), event.ok, context.now, context.dueMode) : context.srs

export const lessonRuntimeMachine = setup({
  types: { context: {} as Ctx, events: {} as RuntimeEvent },
  actions: {
    // ocen(): rate + akt('ocena:cid')
    rateWithAkt: assign(({ context, event }) => ({
      srs: rateFromEvent(context, event),
      akty: event.type === 'ANSWER' ? addAkt(context, `ocena:${event.cid}`) : context.akty,
    })),
    // bieg().dalej(): rates inline, never calls akt() — the bug shown on the page
    rateNoAkt: assign(({ context, event }) => ({
      srs: rateFromEvent(context, event),
      queue: event.type === 'ANSWER' ? context.queue.filter((k) => k !== itemKey(event.cid)) : context.queue,
    })),
    stamp: assign({ lastEvent: ({ event }) => JSON.stringify(event) }),
  },
  guards: {
    // PROPOSED: lesson counts as completed when every position is mastered (ok >= 2) after this answer
    completesLesson: ({ context, event }) => {
      const srs = rateFromEvent(context, event)
      return LESSON_KEYS.every((k) => isMastered(srs.items[k]))
    },
    knownCid: ({ context, event }) => event.type === 'ANSWER' && Boolean(context.srs.items[itemKey(event.cid)]),
  },
}).createMachine({
  id: 'lessonRuntime',
  initial: 'boot',
  context: initialContext(),
  on: {
    RESET: { target: '.boot', actions: assign(({ context }) => initialContext(context.dueMode)) },
    ADVANCE: { actions: [assign({ now: ({ context, event }) => context.now + event.days * DAY }), 'stamp'] },
  },
  states: {
    boot: {
      on: {
        SET_DUE_MODE: { actions: assign({ dueMode: ({ event }) => event.mode }) },
        // parse claims → read med_srs_v1 + med_ui_{slug} → zbierzPozycje/rejestruj ("{slug}:{cid}")
        LOAD: {
          target: 'menu',
          actions: [
            assign({
              srs: ({ context }) => {
                const items = { ...context.srs.items }
                for (const p of ALL_POSITIONS) {
                  items[itemKey(p.cid)] ??= { box: 0, due: 0, ok: 0, n: 0, zle: 0, lekcja: SAMPLE_LESSON.slug, mod: p.mod, typ: p.typ }
                }
                return { ver: 1 as const, items }
              },
            }),
            'stamp',
          ],
        },
      },
    },
    menu: {
      entry: assign({ module: null, biegMode: null, queue: [] }),
      on: {
        OPEN_MODULE: { target: 'module', actions: [assign({ module: ({ event }) => event.mod }), 'stamp'] },
        START_BIEG: {
          target: 'bieg',
          actions: [
            assign({ biegMode: ({ event }) => event.mode, queue: ({ context, event }) => biegQueue(context.srs, context.now, event.mode) }),
            'stamp',
          ],
        },
        START_KOLOKWIUM: { target: 'kolokwium', actions: 'stamp' },
      },
    },
    module: {
      on: {
        STEP: { actions: [assign({ akty: ({ context, event }) => addAkt(context, `krok:${event.mod}:${event.i}`) }), 'stamp'] },
        ANSWER: [
          { guard: 'completesLesson', target: 'completed', actions: ['rateWithAkt', 'stamp'] },
          { guard: 'knownCid', actions: ['rateWithAkt', 'stamp'] },
        ],
        BACK: { target: 'menu', actions: 'stamp' },
      },
    },
    bieg: {
      on: {
        ANSWER: [
          { guard: 'completesLesson', target: 'completed', actions: ['rateNoAkt', 'stamp'] },
          { guard: 'knownCid', actions: ['rateNoAkt', 'stamp'] },
        ],
        BACK: { target: 'menu', actions: 'stamp' },
      },
    },
    kolokwium: {
      // timed exam; every answer goes through ocen() → counts as an akt
      on: {
        ANSWER: [
          { guard: 'completesLesson', target: 'completed', actions: ['rateWithAkt', 'stamp'] },
          { guard: 'knownCid', actions: ['rateWithAkt', 'stamp'] },
        ],
        BACK: { target: 'menu', actions: 'stamp' },
      },
    },
    // PROPOSED state — the v2 engine and React port have no explicit "lesson completed" state
    completed: {
      tags: ['proposed'],
      on: { BACK: { target: 'menu', actions: 'stamp' } },
    },
  },
})
