import { assign, createActor, fromCallback, fromPromise, sendTo, setup, type ActorRefFrom } from 'xstate'
import { useActorRef, useMachine, useSelector } from '@xstate/react'
import { Example } from '../components/Example'

// invoke + fromPromise
const fetchMachine = setup({
  types: { context: {} as { data: string | null; error: string | null } },
  actors: {
    fetchQuote: fromPromise(async () => {
      await new Promise((r) => setTimeout(r, 1000))
      if (Math.random() < 0.3) throw new Error('Random failure')
      return `Quote #${Math.floor(Math.random() * 100)}`
    }),
  },
}).createMachine({
  context: { data: null, error: null },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: {
      invoke: {
        src: 'fetchQuote',
        onDone: { target: 'success', actions: assign({ data: ({ event }) => event.output, error: null }) },
        onError: { target: 'failure', actions: assign({ error: ({ event }) => String((event.error as Error).message) }) },
      },
    },
    success: { on: { FETCH: 'loading' } },
    failure: { on: { RETRY: 'loading' } },
  },
})

// invoke + fromCallback (long-running ticker)
const stopwatchMachine = setup({
  types: { context: {} as { elapsed: number } },
  actors: {
    ticker: fromCallback(({ sendBack }) => {
      const id = setInterval(() => sendBack({ type: 'TICK' }), 100)
      return () => clearInterval(id)
    }),
  },
}).createMachine({
  context: { elapsed: 0 },
  initial: 'stopped',
  states: {
    stopped: { on: { START: 'running', RESET: { actions: assign({ elapsed: 0 }) } } },
    running: {
      invoke: { src: 'ticker' },
      on: { TICK: { actions: assign({ elapsed: ({ context }) => context.elapsed + 0.1 }) }, STOP: 'stopped' },
    },
  },
})

// spawnChild / spawn: dynamic child actors
const todoMachine = setup({
  types: { context: {} as { done: boolean }, input: {} as { title: string } },
}).createMachine({
  context: { done: false },
  on: { TOGGLE: { actions: assign({ done: ({ context }) => !context.done }) } },
})

const todosMachine = setup({
  types: { context: {} as { todos: { title: string; ref: ActorRefFrom<typeof todoMachine> }[] } },
  actors: { todo: todoMachine },
}).createMachine({
  context: { todos: [] },
  on: {
    ADD: {
      actions: assign({
        todos: ({ context, spawn }) => {
          const title = `Task ${context.todos.length + 1}`
          return [...context.todos, { title, ref: spawn('todo', { input: { title } }) }]
        },
      }),
    },
  },
})

function TodoItem({ title, actorRef }: { title: string; actorRef: ActorRefFrom<typeof todoMachine> }) {
  const done = useSelector(actorRef, (s) => s.context.done)
  return (
    <label style={{ width: '100%' }}>
      <input type="checkbox" checked={done} onChange={() => actorRef.send({ type: 'TOGGLE' })} /> {title}
    </label>
  )
}

// Actor communication: parent sends to child with sendTo
const pongMachine = setup({}).createMachine({
  context: { hits: 0 },
  on: { PING: { actions: [assign({ hits: ({ context }) => context.hits + 1 })] } },
})

const pingMachine = setup({ actors: { pong: pongMachine } }).createMachine({
  invoke: { id: 'pong', src: 'pong' },
  on: { SEND_PING: { actions: sendTo('pong', { type: 'PING' }) } },
})

function PingPong() {
  const ref = useActorRef(pingMachine)
  const pongRef = useSelector(ref, (s) => s.children.pong as ActorRefFrom<typeof pongMachine>)
  const hits = useSelector(pongRef, (s) => s.context.hits)
  return (
    <Example title="sendTo between actors" description="Parent forwards events to an invoked child." state={{ pongHits: hits }}>
      <button onClick={() => ref.send({ type: 'SEND_PING' })}>Ping child</button>
    </Example>
  )
}

// Standalone actor outside React, subscribed via useSelector
const globalCounter = createActor(
  setup({}).createMachine({ context: { n: 0 }, on: { INC: { actions: assign({ n: ({ context }) => context.n + 1 }) } } }),
).start()

function GlobalCounter() {
  const context = useSelector(globalCounter, (s) => s.context)
  return (
    <Example title="Global actor + useSelector" description="Actor lives outside React; survives page changes." state={context}>
      <button onClick={() => globalCounter.send({ type: 'INC' })}>Inc</button>
    </Example>
  )
}

export default function AsyncActorsPage() {
  const [fetchState, sendFetch] = useMachine(fetchMachine)
  const [sw, sendSw] = useMachine(stopwatchMachine)
  const [todos, sendTodos] = useMachine(todosMachine)

  return (
    <>
      <Example title="invoke fromPromise" description="Loading / success / failure (30% fails)." state={{ value: fetchState.value, ...fetchState.context }}>
        <button disabled={!fetchState.can({ type: 'FETCH' })} onClick={() => sendFetch({ type: 'FETCH' })}>Fetch</button>
        <button disabled={!fetchState.can({ type: 'RETRY' })} onClick={() => sendFetch({ type: 'RETRY' })}>Retry</button>
      </Example>

      <Example title="invoke fromCallback" description="Interval actor stopped automatically on exit." state={{ value: sw.value, elapsed: sw.context.elapsed.toFixed(1) }}>
        <button onClick={() => sendSw({ type: 'START' })}>Start</button>
        <button onClick={() => sendSw({ type: 'STOP' })}>Stop</button>
        <button onClick={() => sendSw({ type: 'RESET' })}>Reset</button>
      </Example>

      <Example title="spawn child actors" description="Each todo is its own actor." state={{ count: todos.context.todos.length }}>
        <button onClick={() => sendTodos({ type: 'ADD' })}>Add todo</button>
        {todos.context.todos.map((t) => (
          <TodoItem key={t.ref.id} title={t.title} actorRef={t.ref} />
        ))}
      </Example>

      <PingPong />

      <GlobalCounter />
    </>
  )
}
