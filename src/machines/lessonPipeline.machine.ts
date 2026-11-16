import { assign, setup } from 'xstate'

// Production pipeline of a fajdi lesson: bin/lekcja session → sync_claims → lekcja_gate.py
// (G3 → G4 → G5 → ZAKRES, one verdict) → audyt sensu → lekcja_gate.py --publikuj.
// Source: CLAUDE.md, bin/lekcja (cmd_bramka), pipeline/lekcja_gate.py (docstring, publikuj()).

export type PipelineScenario = 'ok' | 'g4' | 'zakres' | 'crash'

export const PIPELINE_SCENARIOS: { id: PipelineScenario; label: string; hint: string }[] = [
  { id: 'ok', label: 'Sukces publikacji', hint: 'Wszystkie bramki zielone, audyt sensu ZGODNE → --publikuj, exit 0.' },
  { id: 'g4', label: 'Odrzucenie przez G4', hint: 'Liczba w twierdzeniu z lekcja.claims.json nie zgadza się ze stroną książki → needs_attention, exit 1.' },
  { id: 'zakres', label: 'ZAKRES_NIEPOKRYTY', hint: 'Strona z lekcja.zakres.json nie ma ani jednego twierdzenia → exit 1.' },
  { id: 'crash', label: 'Uszkodzony zakres (exit 2)', hint: '`zakres` nie jest listą → ValueError → exit 2: awaria narzędzia, nie błąd lekcji.' },
]

export type StageId = 'writing' | 'sync' | 'g3' | 'g4' | 'g5' | 'zakres' | 'verdict' | 'audyt' | 'publish'

export const PIPELINE_STAGES: { id: StageId; label: string; who: string }[] = [
  { id: 'writing', label: 'Sesja pisania', who: 'bin/lekcja (agent w bwrap)' },
  { id: 'sync', label: '1/4 sync_claims', who: 'lekcje/_silnik/sync_claims.py' },
  { id: 'g3', label: 'G3 cytowania', who: 'med_cite_check --claims' },
  { id: 'g4', label: 'G4 liczby', who: 'med_num_check' },
  { id: 'g5', label: 'G5 składnia JS', who: 'node --check per <script>' },
  { id: 'zakres', label: 'ZAKRES', who: 'lekcja.zakres.json' },
  { id: 'verdict', label: '2/4 werdykt bramki', who: 'lekcja_gate.py → exit 0/1/2' },
  { id: 'audyt', label: '3/4 audyt sensu', who: 'agent: claude -p / copilot' },
  { id: 'publish', label: '4/4 publikacja', who: 'lekcja_gate.py --publikuj' },
]

export type Artifact = { path: string; note: string; stage: StageId }
export type Issue = { stage: StageId; code: string; detail: string }

type Ctx = {
  scenario: PipelineScenario
  done: StageId[]
  failed: StageId[]
  issues: Issue[]
  artifacts: Artifact[]
  exitCode: number | null
  log: string[]
}

type Ev = { type: 'SELECT'; scenario: PipelineScenario } | { type: 'NEXT' } | { type: 'RESET' }

const initial = (scenario: PipelineScenario): Ctx => ({ scenario, done: [], failed: [], issues: [], artifacts: [], exitCode: null, log: [] })

const W = 'lekcje/_wip/kardio-demo'
const P = 'lekcje/kardiologia/kardio-demo'

// Artifacts a stage leaves behind (path is relative to the fajdi repo root)
type Patch = (args: { context: Ctx }) => Partial<Ctx>

const produce = (stage: StageId, files: [string, string][]): Patch => ({ context }) => ({
  artifacts: [...context.artifacts, ...files.map(([path, note]) => ({ path, note, stage }))],
})

const pass = (stage: StageId, line: string): Patch => ({ context }) => ({ done: [...context.done, stage], log: [...context.log, `✓ ${line}`] })

const fail = (stage: StageId, code: string, detail: string): Patch => ({ context }) => ({
  failed: [...context.failed, stage],
  issues: [...context.issues, { stage, code, detail }],
  log: [...context.log, `✗ ${code}: ${detail}`],
})

export const lessonPipelineMachine = setup({
  types: { context: {} as Ctx, events: {} as Ev },
  guards: {
    is: ({ context }, s: PipelineScenario) => context.scenario === s,
    gateRed: ({ context }) => context.issues.length > 0,
  },
}).createMachine({
  id: 'lessonPipeline',
  initial: 'idle',
  context: initial('ok'),
  on: { RESET: { target: '.idle', actions: assign(({ context }) => initial(context.scenario)) } },
  states: {
    idle: {
      on: {
        SELECT: { actions: assign(({ event }) => initial(event.scenario)) },
        NEXT: 'writing',
      },
    },
    writing: {
      entry: assign(produce('writing', [
        [`${W}/index.html`, 'lekcja: mod({id,title,lesson,cheat,cards,quiz,tf})'],
        [`${W}/lekcja.claims.json`, 'twierdzenia z adresem robbins-2026#pNN'],
        [`${W}/lekcja.zakres.json`, 'deklarowany wycinek książki (sidecar)'],
      ])),
      on: { NEXT: { target: 'sync', actions: assign(pass('writing', 'sesja: wywiad → plan → pisanie')) } },
    },
    sync: {
      entry: assign(produce('sync', [[`${W}/index.html`, '+ blok #wyjasnienia-statyczne (adresy osadzone)']])),
      on: { NEXT: { target: 'g3', actions: assign(pass('sync', 'sync_claims: adresy odświeżone')) } },
    },
    g3: { on: { NEXT: { target: 'g4', actions: assign(pass('g3', 'G3: każde twierdzenie ma stronę w korpusie')) } } },
    g4: {
      on: {
        NEXT: [
          { guard: { type: 'is', params: 'g4' }, target: 'g5', actions: assign(fail('g4', 'LICZBA_NIEZGODNA', 'c7: „75%” — na stronie p412 jest 57%')) },
          { target: 'g5', actions: assign(pass('g4', 'G4: liczby zgodne ze stroną')) },
        ],
      },
    },
    g5: { on: { NEXT: { target: 'zakres', actions: assign(pass('g5', 'G5: node --check OK')) } } },
    zakres: {
      on: {
        NEXT: [
          {
            guard: { type: 'is', params: 'crash' },
            target: 'crashed',
            actions: [assign(fail('zakres', 'ValueError', 'lekcja.zakres.json: `zakres` musi być niepustą listą kotwic')), assign({ exitCode: 2 })],
          },
          { guard: { type: 'is', params: 'zakres' }, target: 'verdict', actions: assign(fail('zakres', 'ZAKRES_NIEPOKRYTY', 'robbins-2026#p414 bez twierdzenia')) },
          { target: 'verdict', actions: assign(pass('zakres', 'ZAKRES: każda strona wycinka pokryta')) },
        ],
      },
    },
    verdict: {
      entry: assign(produce('verdict', [
        [`${W}/audyt.md`, 'raport bramki (✗ = do poprawy)'],
        [`${W}/lekcja.gate.json`, 'werdykt: zweryfikowana | needs_attention'],
      ])),
      on: {
        NEXT: [
          { guard: 'gateRed', target: 'rejected', actions: [assign({ exitCode: 1, failed: ({ context }) => [...context.failed, 'verdict'] })] },
          { target: 'audyt', actions: assign(pass('verdict', 'werdykt: zweryfikowana (exit 0)')) },
        ],
      },
    },
    audyt: {
      entry: assign(produce('audyt', [
        [`${W}/audyt-sensu.md`, 'werdykt agenta per twierdzenie'],
        [`${W}/.audyt-cache.json`, 'zapamiętane werdykty ZGODNE'],
      ])),
      on: { NEXT: { target: 'publish', actions: assign(pass('audyt', 'audyt sensu: 0 × NIEZGODNE')) } },
    },
    publish: {
      entry: assign(produce('publish', [
        [`${P}/index.html`, 'kopia lekcji + claims, audyt.md, zakres, gate, audyt-sensu'],
        [`${P}/lekcja.srs.json`, 'pozycje powtórek (liczone PRZED kopiowaniem)'],
        ['lekcje/_manifest.json', 'wpis: slug, sha256_index, claimow, liczb, pozycji_srs'],
      ])),
      on: { NEXT: { target: 'published', actions: [assign(pass('publish', 'opublikowano')), assign({ exitCode: 0 })] } },
    },
    // Terminal outcomes stay non-final so RESET keeps working on the same actor
    published: {},
    rejected: {},
    crashed: {},
  },
})
