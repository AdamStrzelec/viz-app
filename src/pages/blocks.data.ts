// Catalog of xstate v5 building blocks and recipes (sequences of blocks).
// Based on docs/xstate-api.md; "seenIn" points to pages of this app that use the block.

export type BlockKind = 'states' | 'transitions' | 'actions' | 'guards' | 'actors' | 'communication' | 'runtime' | 'react'

export type Block = {
  id: string
  name: string
  kind: BlockKind
  what: string
  snippet: string
  seenIn?: string[] // route paths
}

export type Recipe = {
  id: string
  title: string
  useCase: string
  steps: string[] // Block ids, in order of execution
  flow: string[] // human-readable sequence
  snippet: string
  seenIn?: string[]
}

export const blockKinds: { kind: BlockKind; label: string }[] = [
  { kind: 'states', label: 'Stany' },
  { kind: 'transitions', label: 'Przejścia' },
  { kind: 'actions', label: 'Akcje' },
  { kind: 'guards', label: 'Guardy' },
  { kind: 'actors', label: 'Aktorzy (logika)' },
  { kind: 'communication', label: 'Komunikacja' },
  { kind: 'runtime', label: 'Runtime i narzędzia' },
  { kind: 'react', label: 'React' },
]

export const pageLabels: Record<string, string> = {
  '/basics': 'Basics',
  '/context-guards': 'Context & guards',
  '/hierarchy': 'Nested & parallel',
  '/async-actors': 'Async & actors',
  '/inspector': 'Inspector',
  '/more-api': 'More API',
  '/release': 'Release model',
  '/git-workflow': 'Git workflow',
  '/ssh-gate': 'SSH forced command',
  '/engine-logic': 'Logika silnika',
  '/api-reference': 'API reference',
}

export const blocks: Block[] = [
  // states
  { id: 'atomic', name: 'Stan atomowy', kind: 'states', what: 'Liść drzewa stanów, bez dzieci.', snippet: "idle: { on: { START: 'running' } }", seenIn: ['/basics'] },
  { id: 'compound', name: 'Stan złożony (nested)', kind: 'states', what: 'Stan z dziećmi i własnym initial; dziecko dziedziczy przejścia rodzica.', snippet: "editing: { initial: 'draft', states: { draft: {}, review: {} } }", seenIn: ['/hierarchy'] },
  { id: 'parallel', name: 'Stan równoległy', kind: 'states', what: 'Kilka regionów aktywnych jednocześnie (np. audio + video).', snippet: "player: { type: 'parallel', states: { audio: {...}, video: {...} } }", seenIn: ['/hierarchy'] },
  { id: 'final', name: 'Stan końcowy', kind: 'states', what: 'Kończy rodzica (onDone) albo całego aktora (status: done, output).', snippet: "done: { type: 'final' }", seenIn: ['/basics', '/context-guards', '/release'] },
  { id: 'history', name: 'Stan historii', kind: 'states', what: 'Powrót do ostatnio aktywnego dziecka (shallow / deep).', snippet: "hist: { type: 'history', history: 'deep' }", seenIn: ['/hierarchy'] },
  { id: 'context', name: 'Context', kind: 'states', what: 'Dane rozszerzone maszyny (liczniki, formularze, wyniki).', snippet: 'context: ({ input }) => ({ retries: 0, user: input.user })', seenIn: ['/context-guards'] },
  { id: 'tags', name: 'Tagi', kind: 'states', what: 'Etykiety stanów, sprawdzane przez snapshot.hasTag — grupują stany dla UI.', snippet: "loading: { tags: ['busy'] }  // snapshot.hasTag('busy')" },
  { id: 'output', name: 'Output', kind: 'states', what: 'Wynik zakończonego aktora, dostępny w onDone rodzica.', snippet: 'output: ({ context }) => context.result', seenIn: ['/ssh-gate', '/engine-logic'] },

  // transitions
  { id: 'event', name: 'Przejście na event', kind: 'transitions', what: 'Podstawowa reakcja na zdarzenie.', snippet: "on: { SUBMIT: { target: 'sending', actions: 'track' } }", seenIn: ['/basics'] },
  { id: 'guarded', name: 'Przejście z guardem', kind: 'transitions', what: 'Tablica kandydatów — wygrywa pierwszy z prawdziwym guardem.', snippet: "on: { NEXT: [{ guard: 'isValid', target: 'ok' }, { target: 'error' }] }", seenIn: ['/context-guards'] },
  { id: 'always', name: 'Eventless (always)', kind: 'transitions', what: 'Przejście sprawdzane od razu po wejściu / zmianie contextu.', snippet: "always: [{ guard: 'isEmpty', target: 'empty' }]", seenIn: ['/context-guards', '/ssh-gate'] },
  { id: 'after', name: 'Opóźnione (after)', kind: 'transitions', what: 'Timeout — przejście po czasie; anulowane przy wyjściu ze stanu.', snippet: "after: { 3000: 'timeout' }  // or named delay: { short: ... }", seenIn: ['/basics', '/context-guards', '/ssh-gate'] },
  { id: 'targetless', name: 'Bez targetu', kind: 'transitions', what: 'Tylko akcje, stan się nie zmienia (brak exit/entry).', snippet: "on: { TYPE: { actions: 'updateText' } }", seenIn: ['/api-reference'] },
  { id: 'reenter', name: 'reenter: true', kind: 'transitions', what: 'Wymusza exit + entry tego samego stanu (restart timerów, invoke).', snippet: "on: { RESTART: { target: 'running', reenter: true } }", seenIn: ['/more-api'] },
  { id: 'entry-exit', name: 'entry / exit', kind: 'transitions', what: 'Akcje przy wejściu i wyjściu ze stanu.', snippet: "loading: { entry: 'showSpinner', exit: 'hideSpinner' }", seenIn: ['/basics'] },

  // actions
  { id: 'assign', name: 'assign', kind: 'actions', what: 'Aktualizacja contextu.', snippet: 'assign({ count: ({ context }) => context.count + 1 })', seenIn: ['/basics', '/context-guards'] },
  { id: 'raise', name: 'raise', kind: 'actions', what: 'Event do samej siebie (opcjonalnie z delay i id).', snippet: "raise({ type: 'TICK' }, { id: 'tick', delay: 1000 })", seenIn: ['/more-api'] },
  { id: 'cancel', name: 'cancel', kind: 'actions', what: 'Anuluje opóźniony raise/sendTo po id.', snippet: "cancel('tick')", seenIn: ['/more-api'] },
  { id: 'enqueue', name: 'enqueueActions', kind: 'actions', what: 'Warunkowe kolejkowanie wielu akcji w jednym miejscu.', snippet: "enqueueActions(({ enqueue, check }) => { if (check('g')) enqueue('a') })", seenIn: ['/more-api'] },
  { id: 'params', name: 'Akcje parametryzowane', kind: 'actions', what: 'Jedna implementacja, różne parametry z configu.', snippet: "entry: { type: 'notify', params: { msg: 'hi' } }", seenIn: ['/basics', '/context-guards', '/engine-logic'] },
  { id: 'log', name: 'log', kind: 'actions', what: 'Debug w konsoli.', snippet: "log(({ context }) => context, 'ctx')", seenIn: ['/more-api'] },

  // guards
  { id: 'guard', name: 'Guard nazwany', kind: 'guards', what: 'Czysta funkcja decydująca o przejściu.', snippet: 'guards: { isValid: ({ context }) => context.email.includes("@") }', seenIn: ['/context-guards'] },
  { id: 'combinators', name: 'and / or / not', kind: 'guards', what: 'Składanie guardów bez nowych funkcji.', snippet: "guard: and(['isValid', not('isLocked')])", seenIn: ['/more-api'] },
  { id: 'statein', name: 'stateIn', kind: 'guards', what: 'Guard zależny od innego regionu stanu równoległego.', snippet: "guard: stateIn('#app.online')", seenIn: ['/more-api'] },

  // actors
  { id: 'promise', name: 'fromPromise', kind: 'actors', what: 'Jednorazowa operacja async: onDone / onError.', snippet: 'fromPromise(async ({ input, signal }) => fetchUser(input.id))', seenIn: ['/async-actors', '/inspector'] },
  { id: 'callback', name: 'fromCallback', kind: 'actors', what: 'Długotrwały nasłuch: interwały, websockety, DOM events.', snippet: 'fromCallback(({ sendBack, receive }) => { ...; return cleanup })', seenIn: ['/async-actors', '/api-reference'] },
  { id: 'observable', name: 'fromObservable', kind: 'actors', what: 'Strumień wartości (np. RxJS) jako snapshot aktora.', snippet: 'fromObservable(() => interval(1000))' },
  { id: 'reducer', name: 'fromTransition', kind: 'actors', what: 'Logika w stylu reducera, bez stanów skończonych.', snippet: 'fromTransition((s, e) => e.type === "inc" ? s + 1 : s, 0)', seenIn: ['/more-api'] },
  { id: 'machine-child', name: 'Maszyna jako dziecko', kind: 'actors', what: 'Pod-proces z własnymi stanami; kończy się output.', snippet: "invoke: { src: 'checkout', input: ..., onDone: 'paid' }", seenIn: ['/engine-logic'] },

  // communication
  { id: 'invoke', name: 'invoke', kind: 'communication', what: 'Aktor żyje tylko w danym stanie; automatycznie zatrzymany przy wyjściu.', snippet: "invoke: { id: 'load', src: 'fetchUser', onDone: 'ready', onError: 'failed' }", seenIn: ['/async-actors', '/inspector'] },
  { id: 'spawn', name: 'spawnChild / spawn', kind: 'communication', what: 'Dynamiczne dzieci (lista todo, gracze) — żyją aż do stopChild.', snippet: "spawnChild('todo', { id: 'todo-1', input })", seenIn: ['/async-actors', '/more-api'] },
  { id: 'sendto', name: 'sendTo', kind: 'communication', what: 'Event od rodzica do dziecka (lub dowolnego ref).', snippet: "sendTo('ticker', { type: 'PAUSE' })", seenIn: ['/async-actors', '/api-reference'] },
  { id: 'sendparent', name: 'sendParent', kind: 'communication', what: 'Event od dziecka do rodzica.', snippet: "sendParent({ type: 'CHILD_DONE' })", seenIn: ['/more-api'] },
  { id: 'emit', name: 'emit + actor.on', kind: 'communication', what: 'Powiadomienia na zewnątrz (toast, analytics) bez zmiany stanu.', snippet: "emit({ type: 'notify', message: 'Saved' })  // actor.on('notify', fn)", seenIn: ['/more-api'] },
  { id: 'systemid', name: 'systemId', kind: 'communication', what: 'Globalny adres aktora w systemie: system.get(id).', snippet: "spawnChild('logger', { systemId: 'logger' })" },

  // runtime
  { id: 'inspect', name: 'inspect / Stately Inspector', kind: 'runtime', what: 'Podgląd eventów i snapshotów na żywo.', snippet: 'createActor(machine, { inspect: inspector.inspect })', seenIn: ['/inspector', '/release'] },
  { id: 'pure', name: 'transition / initialTransition', kind: 'runtime', what: 'Symulacja bez uruchamiania efektów — testy, podgląd „co się stanie”.', snippet: 'const [next, actions] = transition(machine, snapshot, event)', seenIn: ['/api-reference'] },
  { id: 'next', name: 'getNextTransitions / can', kind: 'runtime', what: 'Jakie eventy są teraz możliwe — do disable przycisków.', snippet: "snapshot.can({ type: 'SUBMIT' })", seenIn: ['/api-reference'] },
  { id: 'persist', name: 'Persystencja', kind: 'runtime', what: 'Zapis i odtworzenie stanu (np. localStorage).', snippet: 'createActor(m, { snapshot: JSON.parse(saved) })  // actor.getPersistedSnapshot()' },
  { id: 'waitfor', name: 'waitFor / toPromise', kind: 'runtime', what: 'Czekanie na stan lub output w kodzie async / testach.', snippet: "await waitFor(actor, (s) => s.matches('done'))", seenIn: ['/more-api'] },
  { id: 'provide', name: 'machine.provide', kind: 'runtime', what: 'Podmiana implementacji (mocki w testach, różne środowiska).', snippet: 'machine.provide({ actors: { fetchUser: fromPromise(async () => mock) } })' },

  // react
  { id: 'usemachine', name: 'useMachine', kind: 'react', what: 'Aktor w komponencie, rerender na każdą zmianę.', snippet: 'const [snapshot, send] = useMachine(machine)', seenIn: ['/basics'] },
  { id: 'selector', name: 'useActorRef + useSelector', kind: 'react', what: 'Stabilny ref + rerender tylko przy zmianie wybranego fragmentu.', snippet: 'const count = useSelector(ref, (s) => s.context.count)', seenIn: ['/async-actors', '/release', '/more-api'] },
  { id: 'context-provider', name: 'createActorContext', kind: 'react', what: 'Jeden aktor współdzielony przez drzewo komponentów.', snippet: 'const App = createActorContext(machine)  // <App.Provider>' },
]

export const recipes: Recipe[] = [
  {
    id: 'fetch-retry',
    title: 'Request z retry i timeoutem',
    useCase: 'Pobieranie danych, wysyłka formularza, deploy.',
    steps: ['invoke', 'promise', 'guarded', 'assign', 'after', 'final'],
    flow: ['idle', 'FETCH → loading (invoke)', 'onDone → success', 'onError + retries < 3 → backoff', 'after 1s → loading', 'onError + limit → failure'],
    snippet: `loading: {
  invoke: { src: 'fetchData', onDone: 'success', onError: [
    { guard: 'canRetry', target: 'backoff', actions: 'incRetries' },
    { target: 'failure' },
  ] },
},
backoff: { after: { 1000: 'loading' } },`,
    seenIn: ['/async-actors', '/inspector'],
  },
  {
    id: 'wizard',
    title: 'Kreator wielokrokowy (wizard)',
    useCase: 'Onboarding, checkout, formularz w krokach.',
    steps: ['compound', 'context', 'guarded', 'history', 'final'],
    flow: ['step1 → NEXT (guard isStepValid)', 'step2 → BACK / NEXT', 'step3 → SUBMIT', 'wyjście do pomocy i powrót przez history', 'done (final) → onDone'],
    snippet: `form: { initial: 'step1', states: {
  step1: { on: { NEXT: { guard: 'step1Valid', target: 'step2' } } },
  step2: { on: { BACK: 'step1', NEXT: 'step3' } },
  step3: { on: { SUBMIT: '#wizard.done' } },
  hist: { type: 'history' },
} },`,
    seenIn: ['/hierarchy', '/context-guards'],
  },
  {
    id: 'debounce',
    title: 'Debounce / autosave',
    useCase: 'Wyszukiwarka, autozapis edytora.',
    steps: ['targetless', 'assign', 'raise', 'cancel', 'invoke'],
    flow: ['TYPE → assign(text), cancel("save"), raise(SAVE, delay 500)', 'kolejne TYPE resetuje timer', 'SAVE → saving (invoke)', 'onDone → idle'],
    snippet: `on: { TYPE: { actions: [
  assign({ text: ({ event }) => event.text }),
  cancel('save'),
  raise({ type: 'SAVE' }, { id: 'save', delay: 500 }),
] } },`,
    seenIn: ['/more-api'],
  },
  {
    id: 'parallel-ui',
    title: 'Niezależne regiony UI',
    useCase: 'Player (audio + video), panel z trybem online/offline i edycją.',
    steps: ['parallel', 'compound', 'statein', 'combinators'],
    flow: ['network: online ⇄ offline', 'editor: viewing ⇄ editing', 'SAVE dozwolone tylko gdy stateIn(online) i edycja'],
    snippet: `type: 'parallel', states: {
  network: { initial: 'online', states: { online: {}, offline: {} } },
  editor: { initial: 'viewing', states: { viewing: {}, editing: {
    on: { SAVE: { guard: stateIn('#app.network.online'), target: 'viewing' } },
  } } },
},`,
    seenIn: ['/hierarchy', '/more-api'],
  },
  {
    id: 'countdown',
    title: 'Odliczanie / sesja z wygaśnięciem',
    useCase: 'Rakieta, OTP, wylogowanie po bezczynności.',
    steps: ['raise', 'guarded', 'always', 'cancel', 'emit'],
    flow: ['START → counting, raise(TICK, 1s)', 'TICK → count-1, ponowny raise', 'count = 0 → always → done', 'ABORT → cancel(TICK)', 'emit(notify) dla UI'],
    snippet: `counting: {
  entry: raise({ type: 'TICK' }, { id: 'tick', delay: 1000 }),
  on: { TICK: [{ guard: 'lastTick', target: 'launched' }, { target: 'counting', reenter: true, actions: 'dec' }],
        ABORT: { target: 'ground', actions: cancel('tick') } },
},`,
    seenIn: ['/more-api', '/basics'],
  },
  {
    id: 'parent-child',
    title: 'Rodzic + dynamiczne dzieci',
    useCase: 'Lista todo, kolejka zadań, wielu graczy.',
    steps: ['spawn', 'sendto', 'sendparent', 'selector'],
    flow: ['ADD → spawnChild(todo, id)', 'dziecko: TOGGLE lokalnie', 'dziecko → sendParent(DONE)', 'rodzic → stopChild / sendTo', 'UI czyta dziecko przez useSelector'],
    snippet: `ADD: { actions: assign({ todos: ({ context, spawn }) =>
  [...context.todos, spawn('todo', { id: \`todo-\${context.todos.length}\` })] }) },`,
    seenIn: ['/async-actors', '/more-api'],
  },
  {
    id: 'subprocess',
    title: 'Pod-proces z output',
    useCase: 'Silnik lekcji, weryfikacja SSH, checkout jako osobna maszyna.',
    steps: ['invoke', 'machine-child', 'output', 'final', 'guarded'],
    flow: ['parent: running → invoke(child, input)', 'child kończy w final z output', 'parent onDone: guard na event.output', 'success | rejected'],
    snippet: `verifying: { invoke: { src: 'checkerMachine', input: ({ context }) => context.request,
  onDone: [{ guard: ({ event }) => event.output.ok, target: 'granted' }, { target: 'denied' }] } },`,
    seenIn: ['/ssh-gate', '/engine-logic'],
  },
  {
    id: 'test-sim',
    title: 'Symulacja i testy bez efektów',
    useCase: 'Podgląd „co się stanie po evencie”, testy jednostkowe.',
    steps: ['pure', 'next', 'provide', 'waitfor'],
    flow: ['initialTransition(machine)', 'transition(machine, s, event) → [next, actions]', 'getNextTransitions → dostępne przyciski', 'provide(mock) + waitFor w teście'],
    snippet: `const [s0] = initialTransition(machine)
const [s1, actions] = transition(machine, s0, { type: 'OPEN' })
expect(s1.value).toBe('opened')`,
    seenIn: ['/api-reference', '/more-api'],
  },
]
