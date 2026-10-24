// xstate 5.33.3 public API, based on https://www.jsdocs.io/package/xstate
// Signatures simplified; source of truth: node_modules/xstate/dist/declarations/src/*.d.ts

export type ApiCategory = 'create' | 'actions' | 'guards' | 'actor logic' | 'pure' | 'utils' | 'classes' | 'types'

export type ApiEntry = {
  name: string
  category: ApiCategory
  signature: string
  description: string
  replacement?: string // set when deprecated
}

export const categories: ApiCategory[] = ['create', 'actions', 'guards', 'actor logic', 'pure', 'utils', 'classes', 'types']

export const apiEntries: ApiEntry[] = [
  // create
  { name: 'setup', category: 'create', signature: 'setup({ types, actions, guards, actors, delays })', description: 'Declares typed implementations; call .createMachine(config) on the result.' },
  { name: 'createMachine', category: 'create', signature: 'createMachine(config, implementations?)', description: 'Creates state machine logic (prefer setup().createMachine for types).' },
  { name: 'createActor', category: 'create', signature: 'createActor(logic, { input?, snapshot?, inspect?, id?, systemId? })', description: 'Creates a running actor from any logic. Call .start().' },
  { name: 'createEmptyActor', category: 'create', signature: 'createEmptyActor()', description: 'Actor with no logic — useful as a placeholder ref.' },
  { name: 'interpret', category: 'create', signature: 'interpret(logic, options?)', description: 'Old v4 name for creating an actor.', replacement: 'createActor' },

  // actions
  { name: 'assign', category: 'actions', signature: 'assign({ key: ({ context, event }) => value }) | assign(({ context }) => partial)', description: 'Updates machine context.' },
  { name: 'raise', category: 'actions', signature: 'raise(eventOrExpr, { id?, delay? })', description: 'Sends event to the machine itself (internal queue).' },
  { name: 'sendTo', category: 'actions', signature: 'sendTo(actorRefOrId, eventOrExpr, { id?, delay? })', description: 'Sends event to another actor.' },
  { name: 'sendParent', category: 'actions', signature: 'sendParent(eventOrExpr, options?)', description: 'Sends event to the parent actor.' },
  { name: 'forwardTo', category: 'actions', signature: 'forwardTo(target, options?)', description: 'Forwards the current event to a target actor.' },
  { name: 'emit', category: 'actions', signature: 'emit(eventOrExpr)', description: 'Emits event to external actor.on(type, handler) listeners.' },
  { name: 'enqueueActions', category: 'actions', signature: 'enqueueActions(({ context, event, enqueue, check }) => void)', description: 'Imperatively queue actions with conditions (replaces v4 choose/pure).' },
  { name: 'log', category: 'actions', signature: 'log(valueOrExpr?, label?)', description: 'Logs value to console.' },
  { name: 'cancel', category: 'actions', signature: 'cancel(sendId)', description: 'Cancels a delayed raise/sendTo by its id.' },
  { name: 'spawnChild', category: 'actions', signature: 'spawnChild(src, { id?, systemId?, input?, syncSnapshot? })', description: 'Spawns a child actor as an action.' },
  { name: 'stopChild', category: 'actions', signature: 'stopChild(actorRefOrId)', description: 'Stops a child actor.' },
  { name: 'stop', category: 'actions', signature: 'stop(actorRef)', description: 'Old name for stopping a child.', replacement: 'stopChild' },

  // guards
  { name: 'and', category: 'guards', signature: "and([guardA, 'guardB'])", description: 'True if all guards are true.' },
  { name: 'or', category: 'guards', signature: 'or([guardA, guardB])', description: 'True if any guard is true.' },
  { name: 'not', category: 'guards', signature: 'not(guard)', description: 'Negates a guard.' },
  { name: 'stateIn', category: 'guards', signature: "stateIn('#id.state' | stateValue)", description: 'True if machine is in given state (parallel states).' },
  { name: 'assertEvent', category: 'guards', signature: "assertEvent(event, 'TYPE' | ['A', 'B'])", description: 'Throws if event type differs; narrows TS type.' },

  // actor logic
  { name: 'fromPromise', category: 'actor logic', signature: 'fromPromise(async ({ input, signal, self }) => output)', description: 'Logic from async function; done event carries output.' },
  { name: 'fromCallback', category: 'actor logic', signature: 'fromCallback(({ sendBack, receive, input }) => cleanup)', description: 'Long-running listener; can send and receive events.' },
  { name: 'fromObservable', category: 'actor logic', signature: 'fromObservable(({ input }) => observable)', description: 'Snapshot = latest emitted value.' },
  { name: 'fromEventObservable', category: 'actor logic', signature: 'fromEventObservable(({ input }) => observableOfEvents)', description: 'Emitted values are sent as events to the parent.' },
  { name: 'fromTransition', category: 'actor logic', signature: 'fromTransition((state, event) => next, initialState)', description: 'Reducer-style logic.' },

  // pure
  { name: 'transition', category: 'pure', signature: 'transition(logic, snapshot, event) => [nextSnapshot, actions]', description: 'Pure next state; actions are returned, not executed.' },
  { name: 'initialTransition', category: 'pure', signature: 'initialTransition(logic, input?) => [snapshot, actions]', description: 'Pure initial state.' },
  { name: 'getMicrosteps', category: 'pure', signature: 'getMicrosteps(machine, snapshot, event) => [snapshot, actions][]', description: 'All microsteps (incl. eventless) for an event.' },
  { name: 'getInitialMicrosteps', category: 'pure', signature: 'getInitialMicrosteps(machine, input?)', description: 'Microsteps of the initial transition.' },
  { name: 'getNextTransitions', category: 'pure', signature: 'getNextTransitions(snapshot) => TransitionDefinition[]', description: 'All possible transitions from current state.' },
  { name: 'getNextSnapshot', category: 'pure', signature: 'getNextSnapshot(logic, snapshot, event)', description: 'Old pure transition.', replacement: 'transition' },
  { name: 'getInitialSnapshot', category: 'pure', signature: 'getInitialSnapshot(logic, input?)', description: 'Old pure initial state.', replacement: 'initialTransition' },

  // utils
  { name: 'waitFor', category: 'utils', signature: 'waitFor(actor, snapshot => boolean, { timeout? })', description: 'Promise resolving with first matching snapshot.' },
  { name: 'toPromise', category: 'utils', signature: 'toPromise(actor)', description: 'Promise resolving with actor output when done.' },
  { name: 'matchesState', category: 'utils', signature: 'matchesState(parentValue, childValue) => boolean', description: 'Compares state values (snapshot.matches does the same).' },
  { name: 'pathToStateValue', category: 'utils', signature: "pathToStateValue(['a', 'b']) => { a: 'b' }", description: 'Path array to state value.' },
  { name: 'mapState', category: 'utils', signature: 'mapState(snapshot, mapper)', description: 'Maps active state nodes to results.' },
  { name: 'isMachineSnapshot', category: 'utils', signature: 'isMachineSnapshot(value)', description: 'Type guard for machine snapshots.' },
  { name: 'getStateNodes', category: 'utils', signature: 'getStateNodes(stateNode, stateValue)', description: 'State nodes for a state value.' },
  { name: 'toObserver', category: 'utils', signature: 'toObserver(next?, error?, complete?)', description: 'Builds an observer object.' },

  // classes
  { name: 'Actor', category: 'classes', signature: 'start() stop() send(e) subscribe(obs) on(type, fn) select(fn) getSnapshot() getPersistedSnapshot()', description: 'Running actor instance (returned by createActor).' },
  { name: 'StateMachine', category: 'classes', signature: 'provide(impl) getInitialSnapshot() transition() resolveState() getStateNodeById()', description: 'Machine logic (returned by createMachine).' },
  { name: 'StateNode', category: 'classes', signature: 'config states on after always entry exit invoke type path parent', description: 'Node of the statechart tree.' },
  { name: 'SimulatedClock', category: 'classes', signature: 'new SimulatedClock(); clock.increment(ms)', description: 'Fake clock for testing delays: createActor(m, { clock }).' },
  { name: 'SpecialTargets', category: 'classes', signature: 'SpecialTargets.Parent | SpecialTargets.Internal', description: 'Enum of special send targets.' },

  // types
  { name: 'SnapshotFrom', category: 'types', signature: 'SnapshotFrom<typeof machine>', description: 'Snapshot type of logic.' },
  { name: 'EventFrom', category: 'types', signature: 'EventFrom<typeof machine>', description: 'Event union of logic.' },
  { name: 'ActorRefFrom', category: 'types', signature: 'ActorRefFrom<typeof machine>', description: 'Actor ref type (for props, spawned children).' },
  { name: 'ContextFrom', category: 'types', signature: 'ContextFrom<typeof machine>', description: 'Context type.' },
  { name: 'InputFrom / OutputFrom', category: 'types', signature: 'InputFrom<typeof logic>, OutputFrom<typeof logic>', description: 'Input and output types.' },
  { name: 'StateValueFrom', category: 'types', signature: 'StateValueFrom<typeof machine>', description: 'Union of possible state values.' },
]
