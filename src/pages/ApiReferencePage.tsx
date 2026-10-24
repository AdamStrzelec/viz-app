import { useState } from 'react'
import { assign, createMachine, fromCallback, getNextTransitions, initialTransition, matchesState, sendTo, setup, transition } from 'xstate'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'
import { apiEntries, categories, type ApiCategory } from './apiReference.data'

/* ---------- 1. Pure transitions: initialTransition + transition, nothing is executed ---------- */

const doorMachine = createMachine({
  id: 'door',
  initial: 'closed',
  states: {
    closed: { on: { OPEN: 'opened', LOCK: 'locked' } },
    opened: { entry: { type: 'playSound' }, on: { CLOSE: 'closed' } },
    locked: { on: { UNLOCK: 'closed' } },
  },
})

type DoorEvent = { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'LOCK' } | { type: 'UNLOCK' }

/* ---------- 2. fromCallback + sendTo: ticker child, parent talks to it ---------- */

const tickerMachine = setup({
  types: { context: {} as { ticks: number }, events: {} as { type: 'TICK' } | { type: 'PAUSE' } | { type: 'RESUME' } },
  actors: {
    ticker: fromCallback<{ type: 'PAUSE' } | { type: 'RESUME' }>(({ sendBack, receive }) => {
      let paused = false
      const id = setInterval(() => !paused && sendBack({ type: 'TICK' }), 1000)
      receive((e) => (paused = e.type === 'PAUSE'))
      return () => clearInterval(id)
    }),
  },
}).createMachine({
  context: { ticks: 0 },
  invoke: { id: 'ticker', src: 'ticker' },
  on: {
    TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) },
    PAUSE: { actions: sendTo('ticker', { type: 'PAUSE' }) },
    RESUME: { actions: sendTo('ticker', { type: 'RESUME' }) },
  },
})

/* ---------- 3. Search/filter state of this page ---------- */

const filterMachine = setup({
  types: {
    context: {} as { query: string; selected: ApiCategory[] },
    events: {} as { type: 'SEARCH'; query: string } | { type: 'TOGGLE_CATEGORY'; category: ApiCategory } | { type: 'CLEAR' },
  },
}).createMachine({
  context: { query: '', selected: [] },
  on: {
    SEARCH: { actions: assign({ query: ({ event }) => event.query }) },
    TOGGLE_CATEGORY: {
      actions: assign({
        selected: ({ context, event }) =>
          context.selected.includes(event.category) ? context.selected.filter((c) => c !== event.category) : [...context.selected, event.category],
      }),
    },
    CLEAR: { actions: assign({ query: '', selected: [] }) },
  },
})

export default function ApiReferencePage() {
  const [door, setDoor] = useState(() => initialTransition(doorMachine)[0])
  const [lastActions, setLastActions] = useState<string[]>([])
  const [ticker, sendTicker] = useMachine(tickerMachine)
  const [filter, sendFilter] = useMachine(filterMachine)
  const [paused, setPaused] = useState(false)

  const step = (event: DoorEvent) => {
    const [next, actions] = transition(doorMachine, door, event)
    setDoor(next)
    setLastActions(actions.map((a) => a.type))
  }

  const nextEvents = getNextTransitions(door).map((t) => t.eventType)
  const { query, selected } = filter.context
  const q = query.trim().toLowerCase()
  const visible = apiEntries.filter(
    (e) =>
      (selected.length === 0 || selected.includes(e.category)) &&
      (q === '' || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)),
  )

  return (
    <>
      <Example
        title="transition / initialTransition"
        description="Pure functions: compute next snapshot and return actions without running them. getNextTransitions lists available events."
        state={{ value: door.value, actions: lastActions, nextEvents, isClosed: matchesState('closed', door.value) }}
      >
        {(['OPEN', 'CLOSE', 'LOCK', 'UNLOCK'] as const).map((type) => (
          <button key={type} disabled={!nextEvents.includes(type)} onClick={() => step({ type })}>
            {type}
          </button>
        ))}
      </Example>

      <Example title="fromCallback + sendTo" description="Invoked callback actor sends TICK every second; parent forwards PAUSE/RESUME to it with sendTo." state={ticker.context}>
        <span>⏱ {ticker.context.ticks}</span>
        <button
          onClick={() => {
            sendTicker({ type: paused ? 'RESUME' : 'PAUSE' })
            setPaused(!paused)
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </Example>

      <Example wide title={`API reference — xstate 5.33.3 (${visible.length})`} description="Source: jsdocs.io/package/xstate. Filter state below is itself an xstate machine." state={null}>
        <input className="payload" placeholder="Search…" value={query} onChange={(e) => sendFilter({ type: 'SEARCH', query: e.target.value })} />
        <div className="quick">
          {categories.map((c) => (
            <button key={c} className={selected.includes(c) ? 'chip selected' : 'chip'} onClick={() => sendFilter({ type: 'TOGGLE_CATEGORY', category: c })}>
              {c}
            </button>
          ))}
          <button className="chip" onClick={() => sendFilter({ type: 'CLEAR' })}>clear</button>
        </div>
        {categories.map((category) => {
          const entries = visible.filter((e) => e.category === category)
          if (entries.length === 0) return null
          return (
            <section key={category} className="api-group">
              <h3 className="api-group-title">
                {category} <span className="muted">{entries.length}</span>
              </h3>
              <div className="api-list">
                {entries.map((e) => (
                  <div key={e.name} className="api-card">
                    <div className="api-card-head">
                      <strong>{e.name}</strong>
                      {e.replacement && <span className="badge no">deprecated → {e.replacement}</span>}
                    </div>
                    <code>{e.signature}</code>
                    <span className="muted">{e.description}</span>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
        {visible.length === 0 && <span className="muted">No matches.</span>}
      </Example>
    </>
  )
}
