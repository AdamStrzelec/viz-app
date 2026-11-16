import type { RuntimeEvent } from './lessonRuntime.machine'

export type ScenarioStep = { event: RuntimeEvent; note: string }
export type RuntimeScenario = { id: string; label: string; summary: string; steps: ScenarioStep[] }

const ans = (cid: string, ok: boolean, note = ''): ScenarioStep => ({ event: { type: 'ANSWER', cid, ok }, note: note || `${cid} ${ok ? '✓' : '✗'}` })
const ev = (event: RuntimeEvent, note: string): ScenarioStep => ({ event, note })

const load = ev({ type: 'LOAD' }, 'parsowanie claims → odczyt med_srs_v1 i med_ui_kardio-demo → rejestracja 5 pozycji (box 0, due 0)')
const studyAll: ScenarioStep[] = [
  ev({ type: 'OPEN_MODULE', mod: 'm1' }, 'menu → pierwszy moduł'),
  ev({ type: 'STEP', mod: 'm1', i: 1 }, 'krok lekcji odsłonięty → akt krok:m1:1'),
  ev({ type: 'STEP', mod: 'm1', i: 2 }, 'akt krok:m1:2'),
  ans('c1', true, 'fiszka c1 ✓ → box 1, due +1 dzień'),
  ans('c2', true),
  ans('q1', true),
  ev({ type: 'BACK' }, 'powrót do menu'),
  ev({ type: 'OPEN_MODULE', mod: 'm2' }, 'moduł 2'),
  ev({ type: 'STEP', mod: 'm2', i: 1 }, 'akt krok:m2:1'),
  ans('c3', true),
  ans('q2', true),
  ev({ type: 'BACK' }, 'menu'),
]

export const RUNTIME_SCENARIOS: RuntimeScenario[] = [
  {
    id: 'flawless',
    label: 'Uczeń bezbłędny',
    summary: 'Wszystko trafione w dniu 0, następnego dnia bieg „dziś” — każda pozycja ma ok = 2 → (proponowany) stan ukończenia.',
    steps: [
      load,
      ...studyAll,
      ev({ type: 'ADVANCE', days: 1 }, 'zegar +1 dzień — pudełko 1 staje się „na dziś”'),
      ev({ type: 'START_BIEG', mode: 'dzis' }, 'bieg „dziś”: 5 pozycji w kolejce'),
      ans('c1', true, 'c1 ✓ → box 2, due +3 dni (bieg: brak akt!)'),
      ans('c2', true),
      ans('q1', true),
      ans('c3', true),
      ans('q2', true, 'ostatnia pozycja osiąga ok = 2 → completed (PROPOZYCJA)'),
    ],
  },
  {
    id: 'errors',
    label: 'Błędy i powrót do pudełka 0',
    summary: 'Pomyłki zerują box i serię ok. W React due = teraz (od razu w „dziś”), w v2 due = teraz + 10 min.',
    steps: [
      load,
      ev({ type: 'OPEN_MODULE', mod: 'm1' }, 'moduł 1'),
      ev({ type: 'STEP', mod: 'm1', i: 1 }, 'akt krok:m1:1'),
      ans('c1', false, 'c1 ✗ → box 0, ok 0, zle 1'),
      ans('c2', true),
      ans('q1', false, 'q1 ✗'),
      ev({ type: 'BACK' }, 'menu'),
      ev({ type: 'START_BIEG', mode: 'dzis' }, 'bieg „dziś”: w React c1/q1 już wiszą; w v2 dopiero za 10 min'),
      ans('c1', true, 'c1 ✓ → box 1'),
      ans('q1', false, 'q1 ✗ drugi raz → zle 2'),
      ev({ type: 'BACK' }, 'menu'),
      ev({ type: 'START_BIEG', mode: 'bledy' }, 'bieg „błędy”: wszystko, co kiedykolwiek miało zle > 0'),
      ans('c1', true, 'c1 ✓ → box 2, ok 2 = opanowane'),
      ans('q1', true, 'q1 ✓ → box 1'),
      ev({ type: 'BACK' }, 'menu — pasek „Przerobione” nie drgnął od biegów'),
    ],
  },
  {
    id: 'week',
    label: 'Powtórka po tygodniu',
    summary: 'Dzień 0 wszystko ✓ (box 1). Po 7 dniach wszystko zaległe; jedna pomyłka cofa pozycję do pudełka 0.',
    steps: [
      load,
      ...studyAll,
      ev({ type: 'ADVANCE', days: 7 }, 'zegar +7 dni'),
      ev({ type: 'START_BIEG', mode: 'dzis' }, 'bieg „dziś”: 5 zaległych'),
      ans('c1', true, 'c1 ✓ → box 2 (+3 dni)'),
      ans('c2', true),
      ans('q1', false, 'q1 ✗ → box 0'),
      ans('c3', true),
      ans('q2', true),
      ev({ type: 'BACK' }, 'menu'),
      ev({ type: 'ADVANCE', days: 3 }, 'zegar +3 dni → box 2 i q1 znowu na dziś'),
    ],
  },
  {
    id: 'exam',
    label: 'Kolokwium',
    summary: 'Kolokwium ocenia przez ocen(): zmienia kartotekę I dokłada akty (inaczej niż bieg).',
    steps: [
      load,
      ev({ type: 'OPEN_MODULE', mod: 'm1' }, 'moduł 1'),
      ev({ type: 'STEP', mod: 'm1', i: 1 }, 'akt krok:m1:1'),
      ev({ type: 'BACK' }, 'menu'),
      ev({ type: 'START_KOLOKWIUM' }, 'kolokwium: format egzaminu, na czas'),
      ans('c1', true),
      ans('c2', true),
      ans('q1', false, 'q1 ✗ w kolokwium → box 0, liczy się do kartoteki'),
      ans('c3', true),
      ans('q2', true),
      ev({ type: 'BACK' }, 'koniec kolokwium → menu'),
    ],
  },
]
