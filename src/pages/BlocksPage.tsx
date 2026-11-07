import { NavLink } from 'react-router-dom'
import { assign, fromPromise, setup } from 'xstate'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'
import { blockKinds, blocks, pageLabels, recipes, type BlockKind } from './blocks.data'

/* ---------- Live recipe: request with retry + backoff ---------- */

const MAX_RETRIES = 2

const retryMachine = setup({
  types: {
    context: {} as { retries: number; failNext: number; result: string | null },
    events: {} as { type: 'FETCH' } | { type: 'SET_FAILURES'; count: number } | { type: 'RESET' },
  },
  actors: {
    fakeRequest: fromPromise<string, { fail: boolean }>(
      ({ input }) => new Promise((resolve, reject) => setTimeout(() => (input.fail ? reject(new Error('503')) : resolve('200 OK')), 700)),
    ),
  },
  guards: { canRetry: ({ context }) => context.retries < MAX_RETRIES },
}).createMachine({
  id: 'retry',
  context: { retries: 0, failNext: 1, result: null },
  initial: 'idle',
  on: { RESET: { target: '.idle', actions: assign({ retries: 0, result: null }) } },
  states: {
    idle: {
      on: {
        FETCH: 'loading',
        SET_FAILURES: { actions: assign({ failNext: ({ event }) => event.count }) },
      },
    },
    loading: {
      tags: ['busy'],
      invoke: {
        src: 'fakeRequest',
        input: ({ context }) => ({ fail: context.retries < context.failNext }),
        onDone: { target: 'success', actions: assign({ result: ({ event }) => event.output }) },
        onError: [
          { guard: 'canRetry', target: 'backoff', actions: assign({ retries: ({ context }) => context.retries + 1 }) },
          { target: 'failure', actions: assign({ result: 'gave up' }) },
        ],
      },
    },
    backoff: { tags: ['busy'], after: { 800: 'loading' } },
    success: {},
    failure: {},  // not final: root final would stop the actor and block RESET
  },
})

const retryStages = ['idle', 'loading', 'backoff', 'success', 'failure'] as const

const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? id

function SeenIn({ paths }: { paths?: string[] }) {
  if (!paths?.length) return <span className="muted">brak przykładu w projekcie — do zbudowania</span>
  return (
    <span className="muted">
      w projekcie:{' '}
      {paths.map((p, i) => (
        <span key={p}>
          {i > 0 && ', '}
          <NavLink to={p}>{pageLabels[p] ?? p}</NavLink>
        </span>
      ))}
    </span>
  )
}

export default function BlocksPage() {
  const [snap, send] = useMachine(retryMachine)
  const byKind = (kind: BlockKind) => blocks.filter((b) => b.kind === kind)

  return (
    <>
      <Example
        wide
        title={`Bloki xstate v5 (${blocks.length})`}
        description="Wszystkie klocki z dokumentacji (docs/xstate-api.md), pogrupowane. Każdy ma minimalny snippet i link do strony, która go używa."
        state={null}
      >
        {blockKinds.map(({ kind, label }) => (
          <section key={kind} className="api-group">
            <h3 className="api-group-title">
              {label} <span className="muted">{byKind(kind).length}</span>
            </h3>
            <div className="api-list">
              {byKind(kind).map((b) => (
                <div key={b.id} id={`block-${b.id}`} className="api-card">
                  <div className="api-card-head">
                    <strong>{b.name}</strong>
                  </div>
                  <span className="muted">{b.what}</span>
                  <code>{b.snippet}</code>
                  <SeenIn paths={b.seenIn} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </Example>

      <Example
        wide
        title={`Sekwencje — przepisy (${recipes.length})`}
        description="Typowe kombinacje bloków. Chipy = kolejność użycia bloków, strzałki = przebieg procesu."
        state={null}
      >
        <div className="api-list">
          {recipes.map((r) => (
            <div key={r.id} className="api-card">
              <div className="api-card-head">
                <strong>{r.title}</strong>
              </div>
              <span className="muted">{r.useCase}</span>
              <div className="quick">
                {r.steps.map((id, i) => (
                  <a key={id} className="chip" href={`#block-${id}`}>
                    {i + 1}. {blockName(id)}
                  </a>
                ))}
              </div>
              <ol className="muted recipe-flow">
                {r.flow.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ol>
              <pre>{r.snippet}</pre>
              <SeenIn paths={r.seenIn} />
            </div>
          ))}
        </div>
      </Example>

      <Example
        title="Przepis na żywo: retry + backoff"
        description={`invoke(fromPromise) → onError z guardem canRetry (max ${MAX_RETRIES}) → after 800ms → ponowny loading. Ustaw ile pierwszych prób ma paść.`}
        state={{ value: snap.value, busy: snap.hasTag('busy'), status: snap.status, context: snap.context }}
      >
        <div className="quick">
          {retryStages.map((s) => (
            <span key={s} className={snap.matches(s) ? 'chip selected' : 'chip'} aria-current={snap.matches(s) ? 'step' : undefined}>
              {s}
            </span>
          ))}
        </div>
        <label className="muted">
          porażki:{' '}
          <select
            value={snap.context.failNext}
            disabled={!snap.matches('idle')}
            onChange={(e) => send({ type: 'SET_FAILURES', count: Number(e.target.value) })}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!snap.can({ type: 'FETCH' })} onClick={() => send({ type: 'FETCH' })}>
          FETCH
        </button>
        <button onClick={() => send({ type: 'RESET' })}>RESET</button>
      </Example>
    </>
  )
}
