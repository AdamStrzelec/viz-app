# xstate API reference (for agents)

Version: **xstate 5.33.3**, **@xstate/react 6.1.0**. This is **v5 — NOT v4**.
Source: https://www.jsdocs.io/package/xstate
Source of truth for signatures: `node_modules/xstate/dist/declarations/src/*.d.ts`
Interactive version: `/api-reference` page (`src/pages/ApiReferencePage.tsx`, data in `src/pages/apiReference.data.ts`).

## Workflow
1. Unknown/unsure API: check this file, then the `.d.ts` files, then context7 (stately.ai docs).
2. Never write v4 syntax (see table below).
3. After changes: `npm run build` (tsc catches most v5 type mistakes), `npm run lint`.

## v4 to v5 cheat sheet
| v4 | v5 |
|----|----|
| `interpret(m)` | `createActor(m).start()` |
| `services: {}` / `src: 'x'` invoke | `actors: {}` in `setup` |
| `cond: 'g'` | `guard: 'g'` |
| `stop(ref)` | `stopChild(ref)` |
| `choose`, `pure` | `enqueueActions` |
| `send(e, { to })` | `sendTo(to, e)` |
| `getNextSnapshot` / `machine.transition(state, e)` | `transition(logic, snapshot, e)` |
| `getInitialSnapshot` | `initialTransition(logic, input?)` |
| `state.nextEvents` | `getNextTransitions(snapshot)` |
| `schema` / `tsTypes` | `setup({ types: {...} })` |
| `useMachine` returns `[state, send, service]` | `[snapshot, send, actorRef]` |

## Create
```ts
const machine = setup({
  types: { context: {} as Ctx, events: {} as Ev, input: {} as In, emitted: {} as Em },
  actions: { notify: ({ context, event }, params) => {} },
  guards: { isReady: ({ context }) => context.ready },
  actors: { fetchUser: fromPromise(async ({ input }) => api(input)) },
  delays: { short: 500 },
}).createMachine({ id: 'x', initial: 'idle', context: ({ input }) => ({...}), states: {...} })

const actor = createActor(machine, { input, snapshot?, inspect? }).start()
actor.send({ type: 'GO' }); actor.subscribe(s => {}); actor.on('emitted', e => {}); actor.getSnapshot()
```
- `createMachine(config, impl?)` — untyped-ish variant.
- `createEmptyActor()` — placeholder ref.
- `machine.provide({ actions, guards, actors, delays })` — override implementations.

## Actions
| Fn | Signature |
|----|-----------|
| `assign` | `assign({ k: ({ context, event }) => v })` or `assign(({ context }) => partial)` |
| `raise` | `raise(eventOrExpr, { id?, delay? })` — to self |
| `sendTo` | `sendTo(refOrId, eventOrExpr, { id?, delay? })` |
| `sendParent` | `sendParent(eventOrExpr)` |
| `forwardTo` | `forwardTo(target)` |
| `emit` | `emit(eventOrExpr)` — to `actor.on()` listeners |
| `enqueueActions` | `enqueueActions(({ context, event, enqueue, check }) => { enqueue.assign(...); if (check('g')) enqueue('a') })` |
| `log` | `log(expr?, label?)` |
| `cancel` | `cancel(sendId)` |
| `spawnChild` | `spawnChild(src, { id?, systemId?, input?, syncSnapshot? })` |
| `stopChild` | `stopChild(refOrId)` |

Parameterized: `actions: [{ type: 'notify', params: { msg: 'hi' } }]`; inside `assign` you can also `spawn(src, opts)`.

## Guards
`and([...])`, `or([...])`, `not(g)`, `stateIn('#id.path')`, `assertEvent(event, 'TYPE' | [...])` (throws + narrows).
Transition: `{ guard: 'isReady', target: 'next' }`, eventless: `always: [{ guard, target }]`.

## Actor logic
| Fn | Signature |
|----|-----------|
| `fromPromise` | `fromPromise(async ({ input, signal, self }) => output)` — `onDone` `event.output`, `onError` `event.error` |
| `fromCallback` | `fromCallback(({ sendBack, receive, input }) => cleanup)` |
| `fromObservable` | `fromObservable(({ input }) => obs)` |
| `fromEventObservable` | `fromEventObservable(({ input }) => obsOfEvents)` |
| `fromTransition` | `fromTransition((state, event, { self }) => next, initial)` |

Invoke: `invoke: { id, src: 'fetchUser', input: ({ context }) => ..., onDone, onError }`.

## Pure functions (no side effects)
- `transition(logic, snapshot, event) => [nextSnapshot, actions]`
- `initialTransition(logic, input?) => [snapshot, actions]`
- `getMicrosteps(machine, snapshot, event) => [snapshot, actions][]`
- `getInitialMicrosteps(machine, input?)`
- `getNextTransitions(snapshot) => TransitionDefinition[]` (`.eventType`, `.target`)

## Utils
- `waitFor(actor, s => s.matches('done'), { timeout? })` → Promise<snapshot>
- `toPromise(actor)` → Promise<output>
- `matchesState(parentValue, childValue)`; on snapshot: `s.matches('a.b')`, `s.hasTag('t')`, `s.can(event)`, `s.status`, `s.output`
- `pathToStateValue(['a','b'])` → `{ a: 'b' }`
- `mapState(snapshot, mapper)`, `isMachineSnapshot(v)`, `getStateNodes(node, value)`, `toObserver(next?, err?, done?)`

## Classes / enums
- `Actor`: `start stop send subscribe on select getSnapshot getPersistedSnapshot`, props `id logic system sessionId`
- `StateMachine`: `provide getInitialSnapshot transition microstep resolveState restoreSnapshot getStateNodeById`
- `StateNode`: `config states on after always entry exit invoke type path parent`
- `SimulatedClock`: tests with delays — `createActor(m, { clock })`, `clock.increment(ms)`
- `SpecialTargets.Parent | Internal`

## Key types
`SnapshotFrom<T>`, `EventFrom<T>`, `ActorRefFrom<T>`, `ContextFrom<T>`, `InputFrom<T>`, `OutputFrom<T>`, `StateValueFrom<T>`, `EmittedFrom<T>`, `AnyActorRef`, `AnyStateMachine`.

## @xstate/react 6
- `useMachine(machine, opts?)` → `[snapshot, send, actorRef]`
- `useActor(logic, opts?)` → `[snapshot, send, actorRef]`
- `useActorRef(logic, opts?)` → stable ref (no re-render); pair with `useSelector(ref, s => s.context.x, compare?)`
- `createActorContext(logic)` → `{ Provider, useSelector, useActorRef }`

## Deprecated (do not use)
`interpret` → `createActor`, `stop` → `stopChild`, `getNextSnapshot` → `transition`, `getInitialSnapshot` → `initialTransition`.
