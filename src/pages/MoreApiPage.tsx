import { useEffect, useState } from 'react'
import {
  and,
  assign,
  cancel,
  createActor,
  createMachine,
  enqueueActions,
  emit,
  fromPromise,
  fromTransition,
  getInitialSnapshot,
  getNextSnapshot,
  log,
  not,
  or,
  raise,
  sendParent,
  setup,
  stateIn,
  toPromise,
  waitFor,
} from 'xstate'
import { useActorRef, useSelector } from '@xstate/react'
import { Example } from '../components/Example'

/* ---------- 1. Rocket launch: raise (delayed), cancel, emit, enqueueActions, and/or/not/stateIn ---------- */

const rocketMachine = setup({
  types: {
    context: {} as { fuel: number; weatherOk: boolean; count: number },
    events: {} as { type: 'FUEL' } | { type: 'TOGGLE_WEATHER' } | { type: 'LAUNCH' } | { type: 'ABORT' } | { type: 'TICK' } | { type: 'RESET' },
    emitted: {} as { type: 'notify'; message: string },
  },
  guards: {
    fuelFull: ({ context }) => context.fuel >= 100,
    weatherOk: ({ context }) => context.weatherOk,
    lastTick: ({ context }) => context.count <= 1,
  },
}).createMachine({
  id: 'rocket',
  context: { fuel: 0, weatherOk: true, count: 5 },
  initial: 'ground',
  on: {
    // Weather can't change once the countdown or flight has started
    TOGGLE_WEATHER: {
      guard: not(or([stateIn('#rocket.countdown'), stateIn('#rocket.flying')])),
      actions: assign({ weatherOk: ({ context }) => !context.weatherOk }),
    },
  },
  states: {
    ground: {
      on: {
        FUEL: {
          actions: enqueueActions(({ context, enqueue }) => {
            const fuel = Math.min(100, context.fuel + 25)
            enqueue.assign({ fuel })
            if (fuel === 100) enqueue.emit({ type: 'notify', message: '⛽ Tank full' })
          }),
        },
        LAUNCH: [
          { guard: and(['fuelFull', 'weatherOk']), target: 'countdown' },
          { actions: emit({ type: 'notify', message: '🚫 Need full tank and good weather' }) },
        ],
      },
    },
    countdown: {
      entry: [assign({ count: 5 }), raise({ type: 'TICK' }, { delay: 1000, id: 'tick' })],
      on: {
        TICK: [
          { guard: 'lastTick', target: 'flying' },
          {
            actions: enqueueActions(({ context, enqueue }) => {
              enqueue.assign({ count: context.count - 1 })
              enqueue.raise({ type: 'TICK' }, { delay: 1000, id: 'tick' })
            }),
          },
        ],
        ABORT: {
          target: 'ground',
          actions: [cancel('tick'), log('countdown aborted'), emit({ type: 'notify', message: '🛑 Launch aborted' })],
        },
      },
    },
    flying: {
      entry: [assign({ fuel: 0 }), emit({ type: 'notify', message: '🚀 Liftoff!' })],
      after: { 3000: 'orbit' },
    },
    orbit: {
      entry: emit({ type: 'notify', message: '🛰️ Reached orbit' }),
      on: { RESET: { target: 'ground', actions: assign({ count: 5 }) } },
    },
  },
})

function RocketExample() {
  const ref = useActorRef(rocketMachine)
  const snapshot = useSelector(ref, (s) => s)
  const [toasts, setToasts] = useState<string[]>([])

  // Emitted events are a side channel: listen with actor.on()
  useEffect(() => {
    const sub = ref.on('notify', (e) => setToasts((t) => [e.message, ...t].slice(0, 4)))
    return () => sub.unsubscribe()
  }, [ref])

  const { fuel, weatherOk, count } = snapshot.context
  const stage = String(snapshot.value)

  return (
    <Example
      title="Rocket launch"
      description="Delayed raise + cancel, emit to the UI, enqueueActions, and combined guards (and / or / not / stateIn)."
      state={{ value: snapshot.value, ...snapshot.context }}
    >
      <div className="rocket">
        <div className={`rocket-ship rocket-${stage}`}>🚀</div>
        <div className="rocket-info">
          <div className="meter"><div style={{ width: `${fuel}%` }} /></div>
          <span>{weatherOk ? '☀️ Clear' : '⛈️ Storm'}</span>
          {stage === 'countdown' && <strong className="rocket-count">T−{count}</strong>}
        </div>
      </div>
      <button onClick={() => ref.send({ type: 'FUEL' })} disabled={stage !== 'ground'}>Fuel +25%</button>
      <button onClick={() => ref.send({ type: 'TOGGLE_WEATHER' })} disabled={!snapshot.can({ type: 'TOGGLE_WEATHER' })}>Toggle weather</button>
      <button onClick={() => ref.send({ type: 'LAUNCH' })} disabled={stage !== 'ground'}>Launch</button>
      <button onClick={() => ref.send({ type: 'ABORT' })} disabled={stage !== 'countdown'}>Abort</button>
      <button onClick={() => ref.send({ type: 'RESET' })} disabled={stage !== 'orbit'}>Reset</button>
      <ul className="toasts">{toasts.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}</ul>
    </Example>
  )
}

/* ---------- 2. Pixel editor with undo/redo: fromTransition (reducer-style logic) ---------- */

const SIZE = 8
type Grid = boolean[]
type PixelEvent = { type: 'PAINT'; index: number } | { type: 'UNDO' } | { type: 'REDO' } | { type: 'CLEAR' }

const pixelLogic = fromTransition(
  (state: { past: Grid[]; present: Grid; future: Grid[] }, event: PixelEvent) => {
    switch (event.type) {
      case 'PAINT': {
        const next = [...state.present]
        next[event.index] = !next[event.index]
        return { past: [...state.past, state.present], present: next, future: [] }
      }
      case 'UNDO':
        if (!state.past.length) return state
        return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
      case 'REDO':
        if (!state.future.length) return state
        return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
      case 'CLEAR':
        return { past: [...state.past, state.present], present: Array(SIZE * SIZE).fill(false), future: [] }
    }
  },
  { past: [], present: Array(SIZE * SIZE).fill(false), future: [] },
)

function PixelExample() {
  const ref = useActorRef(pixelLogic)
  const { past, present, future } = useSelector(ref, (s) => s.context)

  return (
    <Example
      title="Pixel editor (fromTransition)"
      description="A plain reducer turned into an actor — undo/redo history for free."
      state={{ painted: present.filter(Boolean).length, undo: past.length, redo: future.length }}
    >
      <div className="pixels">
        {present.map((on, i) => (
          <button key={i} className={on ? 'pixel on' : 'pixel'} aria-label={`pixel ${i}`} onClick={() => ref.send({ type: 'PAINT', index: i })} />
        ))}
      </div>
      <button disabled={!past.length} onClick={() => ref.send({ type: 'UNDO' })}>Undo</button>
      <button disabled={!future.length} onClick={() => ref.send({ type: 'REDO' })}>Redo</button>
      <button onClick={() => ref.send({ type: 'CLEAR' })}>Clear</button>
    </Example>
  )
}

/* ---------- 3. Download manager: spawnChild, stopChild, sendParent ---------- */

const downloadMachine = setup({
  types: {
    input: {} as { id: string },
    context: {} as { id: string; progress: number },
  },
}).createMachine({
  context: ({ input }) => ({ id: input.id, progress: 0 }),
  initial: 'running',
  states: {
    running: {
      after: {
        250: [
          { guard: ({ context }) => context.progress >= 90, target: 'done' },
          {
            target: 'running',
            reenter: true,
            actions: [
              assign({ progress: ({ context }) => context.progress + 10 }),
              sendParent(({ context }) => ({ type: 'PROGRESS', id: context.id, progress: context.progress })),
            ],
          },
        ],
      },
    },
    done: {
      type: 'final',
      entry: sendParent(({ context }) => ({ type: 'PROGRESS', id: context.id, progress: 100 })),
    },
  },
})

const managerMachine = setup({
  types: {
    context: {} as { next: number; downloads: Record<string, number> },
    events: {} as { type: 'ADD' } | { type: 'CANCEL'; id: string } | { type: 'PROGRESS'; id: string; progress: number },
  },
  actors: { download: downloadMachine },
}).createMachine({
  context: { next: 1, downloads: {} },
  on: {
    ADD: {
      actions: enqueueActions(({ context, enqueue }) => {
        const id = `file-${context.next}`
        enqueue.spawnChild('download', { id, input: { id } })
        enqueue.assign({ next: context.next + 1, downloads: { ...context.downloads, [id]: 0 } })
      }),
    },
    CANCEL: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        enqueue.stopChild(event.id)
        const { [event.id]: _removed, ...rest } = context.downloads
        enqueue.assign({ downloads: rest })
      }),
    },
    PROGRESS: {
      guard: ({ context, event }) => event.id in context.downloads,
      actions: assign({ downloads: ({ context, event }) => ({ ...context.downloads, [event.id]: event.progress }) }),
    },
  },
})

function DownloadsExample() {
  const ref = useActorRef(managerMachine)
  const downloads = useSelector(ref, (s) => s.context.downloads)
  const children = useSelector(ref, (s) => Object.keys(s.children))

  return (
    <Example
      title="Download manager"
      description="Parent spawns child actors (spawnChild), children report back (sendParent), cancel stops them (stopChild)."
      state={{ liveChildren: children }}
    >
      <button onClick={() => ref.send({ type: 'ADD' })}>Add download</button>
      <div className="downloads">
        {Object.entries(downloads).map(([id, progress]) => (
          <div key={id} className="download">
            <span>{id}</span>
            <div className="meter"><div style={{ width: `${progress}%` }} /></div>
            {progress < 100 ? <button onClick={() => ref.send({ type: 'CANCEL', id })}>✕</button> : <span>✅</span>}
          </div>
        ))}
      </div>
    </Example>
  )
}

/* ---------- 4. Scripting actors: waitFor, toPromise, getNextSnapshot ---------- */

const vendingMachine = createMachine({
  id: 'vending',
  initial: 'idle',
  states: {
    idle: { on: { COIN: 'paid' } },
    paid: { on: { SELECT: 'dispensing' } },
    dispensing: { after: { 800: 'done' } },
    done: { type: 'final' },
  },
})

const fetchSnack = fromPromise(async () => {
  await new Promise((r) => setTimeout(r, 500))
  return ['🍫', '🥨', '🍪'][Math.floor(Math.random() * 3)]
})

function ScriptExample() {
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  // Pure function: compute the next state without running an actor
  const preview = getNextSnapshot(vendingMachine, getInitialSnapshot(vendingMachine), { type: 'COIN' })

  async function run() {
    setRunning(true)
    setLines([])
    const say = (line: string) => setLines((l) => [...l, line])

    const actor = createActor(vendingMachine).start()
    say(`start → ${String(actor.getSnapshot().value)}`)
    actor.send({ type: 'COIN' })
    say(`COIN → ${String(actor.getSnapshot().value)}`)
    actor.send({ type: 'SELECT' })
    say(`SELECT → ${String(actor.getSnapshot().value)}`)

    await waitFor(actor, (s) => s.status === 'done', { timeout: 5000 })
    say('waitFor: machine reached final state')

    const snack = await toPromise(createActor(fetchSnack).start())
    say(`toPromise: got ${snack}`)
    setRunning(false)
  }

  return (
    <Example
      title="Scripting actors"
      description="Drive an actor imperatively with await: waitFor + toPromise. getNextSnapshot previews a transition."
      state={{ previewAfterCOIN: preview.value }}
    >
      <button disabled={running} onClick={run}>{running ? 'Running…' : 'Run script'}</button>
      <ol className="script">{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
    </Example>
  )
}

export default function MoreApiPage() {
  return (
    <>
      <RocketExample />
      <PixelExample />
      <DownloadsExample />
      <ScriptExample />
    </>
  )
}
