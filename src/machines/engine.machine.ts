import { assign, setup } from 'xstate'

/* Model of `lekcja bramka` from the fajdka lesson engine (bin/lekcja cmd_bramka + pipeline/lekcja_gate.py) */

export type Mode = 'html' | 'md'
export type StepId = 'wejscie' | 'sync' | 'g3' | 'g4' | 'g5' | 'zakres' | 'audyt' | 'publikacja'
export type Severity = 'blokuje' | 'ostrzezenie' | 'awaria'

export type Fault = { id: string; step: StepId; code: string; severity: Severity; where: string; fix: string }

// Subset of the scenario → code table (section 5 of the doc)
export const FAULTS: Fault[] = [
  { id: 'poza-wip', step: 'wejscie', code: 'bramkę wolno uruchomić tylko w katalogu lekcji', severity: 'blokuje', where: 'bin/lekcja:cmd_bramka (:277-280)', fix: 'Podać katalog pod lekcje/_wip/.' },
  { id: 'sync', step: 'sync', code: 'sync_claims.py exit 2', severity: 'awaria', where: 'lekcje/_silnik/sync_claims.py', fix: 'Awaria narzędzia, nie Twój błąd.' },
  { id: 'unknown-src', step: 'g3', code: 'UNKNOWN_SRC', severity: 'blokuje', where: 'med_cite_check.py:rozstrzygnij (:293)', fix: 'Użyć src_id z _katalog.yaml.' },
  { id: 'orphan-cid', step: 'g3', code: 'ORPHAN_CID', severity: 'blokuje', where: 'med_cite_check.py:verify_claims (:901-902)', fix: 'Dopisać wpis w lekcja.claims.json.' },
  { id: 'pagemap-stale', step: 'g3', code: 'PAGEMAP_STALE', severity: 'blokuje', where: 'med_cite_check.py:_stale (:397)', fix: 'Odświeżyć korpus/mapę.' },
  { id: 'pagemap-weak', step: 'g3', code: 'PAGEMAP_WEAK', severity: 'ostrzezenie', where: 'med_cite_check.py:degraduj (:409)', fix: 'Zweryfikować stronę w PDF.' },
  { id: 'num-undeclared', step: 'g3', code: 'NUM_NIEZADEKLAROWANA', severity: 'ostrzezenie', where: 'med_cite_check.py (:926-932)', fix: 'Dopisać liczbę do nums.' },
  { id: 'num-span', step: 'g4', code: 'NUM_NOT_IN_SPAN', severity: 'blokuje', where: 'med_num_check.py:check_num_keys (:352)', fix: 'Poprawić liczbę lub źródło.' },
  { id: 'distractor', step: 'g4', code: 'DISTRACTOR_OUT_OF_CORPUS', severity: 'ostrzezenie', where: 'med_num_check.py:check_distractors (:438)', fix: 'Sprawdzić dystraktor.' },
  { id: 'js-syntax', step: 'g5', code: 'JS_SYNTAX', severity: 'blokuje', where: 'lekcja_gate.py:g5_skladnia (:353)', fix: 'Poprawić wskazaną linię.' },
  { id: 'quote', step: 'g5', code: 'CUDZYSLOW_PROSTY', severity: 'ostrzezenie', where: 'lekcja_gate.py:lint_cudzyslowy (:300)', fix: 'Używać „ ”.' },
  { id: 'zakres-gap', step: 'zakres', code: 'ZAKRES_NIEPOKRYTY', severity: 'blokuje', where: 'lekcja_gate.py:sprawdz_zakres (:609)', fix: 'Dopisać twierdzenie albo pominiete z powod.' },
  { id: 'zakres-missing', step: 'zakres', code: 'BRAK_ZAKRESU', severity: 'ostrzezenie', where: 'lekcja_gate.py:wczytaj_zakres (:447)', fix: 'Dodać lekcja.zakres.json.' },
  { id: 'zakres-broken', step: 'zakres', code: 'ValueError: uszkodzony lekcja.zakres.json', severity: 'awaria', where: 'wczytaj_zakres (:457-465)', fix: 'Poprawić JSON.' },
  { id: 'niezgodne', step: 'audyt', code: 'NIEZGODNE', severity: 'blokuje', where: 'bin/lekcja:audyt_sensu (:788-795)', fix: 'Poprawić zdanie albo adres.' },
  { id: 'brak-odp', step: 'audyt', code: 'BRAK_ODPOWIEDZI', severity: 'blokuje', where: 'audyt_sensu (:796-809)', fix: 'Uruchomić bramkę ponownie.' },
]

export const STEPS: { id: StepId; label: string; sub: string; htmlOnly?: boolean }[] = [
  { id: 'wejscie', label: 'Wejście', sub: 'katalog pod WIP_DIR, lekcja.md czy index.html' },
  { id: 'sync', label: 'sync_claims', sub: 'claims → <script id="claims">', htmlOnly: true },
  { id: 'g3', label: 'G3 adresy', sub: 'med_cite_check: ### pN, ORPHAN_*' },
  { id: 'g4', label: 'G4 liczby', sub: 'med_num_check: znak po znaku' },
  { id: 'g5', label: 'G5 składnia JS', sub: 'node --check + lint „”', htmlOnly: true },
  { id: 'zakres', label: 'ZAKRES', sub: 'sprawdz_zakres: pokrycie stron' },
  { id: 'audyt', label: 'Audyt sensu', sub: 'agent: ZGODNE / NIEZGODNE / NIE_DO_OCENY' },
  { id: 'publikacja', label: 'Wynik', sub: 'HTML: publikuj · md: lekcja.gate.json' },
]

export type Perspective = { user: string; code: { file: string; fn: string }[]; data: { name: string; what: string }[] }

// Three views of each step, sourced from jak-dziala-silnik-lekcji.md (file:line refs from the kontener-agy worktree)
export const PERSPECTIVES: Record<StepId, Perspective> = {
  wejscie: {
    user: 'Wpisujesz `lekcja bramka` w katalogu lekcji. Poza lekcje/_wip/ dostajesz: „bramkę wolno uruchomić tylko w katalogu lekcji”.',
    code: [{ file: 'bin/lekcja', fn: 'cmd_bramka (:262), sprawdzenie WIP_DIR (:277-280)' }],
    data: [{ name: 'lekcje/_wip/<slug>/', what: 'czy jest lekcja.md (tryb md) czy index.html (tryb HTML)' }],
  },
  sync: {
    user: 'Nic nie robisz — adresy z sidecara kopiują się do lekcji. Przy awarii: „awaria narzędzia, nie Twój błąd”.',
    code: [{ file: 'lekcje/_silnik/sync_claims.py', fn: 'main (:1-80), exit 2 = awaria' }],
    data: [{ name: 'lekcja.claims.json', what: 'kopiowany do <script id="claims"> w index.html' }],
  },
  g3: {
    user: 'Bramka sprawdza, czy każdy adres #pN wskazuje istniejącą stronę książki. Czerwone linie ✗ z kodem, np. ORPHAN_CID.',
    code: [
      { file: 'pipeline/lekcja_gate.py', fn: 'g3_g4 (:636) z main (:1299) / main_md (:1520)' },
      { file: 'pipeline/med_cite_check.py', fn: 'verify_claims (:901-983), rozstrzygnij (:293-349), degraduj (:409)' },
      { file: 'pipeline/tresc_tekst.py', fn: 'cidy (:44)' },
    ],
    data: [
      { name: 'corpus/med/_katalog.yaml', what: 'czy src_id istnieje' },
      { name: 'podreczniki/<src_id>/rNN-*.md', what: 'frontmatter strony_druku + nagłówek ### pN' },
      { name: 'corpus/med/_pagemap/<src_id>.json', what: 'pagemap_sha (STALE) i zrodlo (słaba mapa)' },
      { name: 'lekcja.tresc.json', what: 'zbiór cid z lekcji vs cid z claims' },
    ],
  },
  g4: {
    user: 'Każda liczba z twierdzenia (nums) musi stać na cytowanej stronie, znak po znaku.',
    code: [{ file: 'pipeline/med_num_check.py', fn: 'check_num_keys (:352), _werdykt (:371), check_distractors (:438)' }],
    data: [
      { name: 'lekcja.claims.json → nums[]', what: 'liczby i jednostki z twierdzeń' },
      { name: 'tekst strony ### pN', what: 'span, w którym liczba musi wystąpić' },
    ],
  },
  g5: {
    user: 'Tylko HTML: sprawdza, czy JS lekcji się parsuje. Surowy " w polskim tekście to ostrzeżenie, póki nie zepsuje składni.',
    code: [{ file: 'pipeline/lekcja_gate.py', fn: 'g5_skladnia (:353), lint_cudzyslowy (:300)' }, { file: 'node', fn: 'node --check na każdym <script>' }],
    data: [{ name: 'index.html', what: 'bloki <script> z mod({...})' }],
  },
  zakres: {
    user: 'Sprawdza, czy lekcja pokryła wszystkie niepuste strony z zadeklarowanego wycinka książki.',
    code: [{ file: 'pipeline/lekcja_gate.py', fn: 'wczytaj_zakres (:447), sprawdz_zakres (:501-609)' }],
    data: [
      { name: 'lekcja.zakres.json', what: 'zakres + pominiete[{strona, powod}]' },
      { name: 'pokrycie_ksiazki.wczytaj_strony', what: 'strony korpusu (pusta = brak liczb i <200 znaków)' },
    ],
  },
  audyt: {
    user: 'Agent czyta każde twierdzenie i stronę. Jedno NIEZGODNE: „te twierdzenia nie zgadzają się ze stroną książki”. Powtórka idzie szybciej dzięki cache.',
    code: [{ file: 'bin/lekcja', fn: 'audyt_sensu: klucz_cache (:703), zapytaj (:631), zapis cache (:756), werdykt (:788-815)' }],
    data: [
      { name: '.audyt-cache.json', what: 'sha256(agent, model, instrukcja, twierdzenie, strona) → ZGODNE' },
      { name: 'tekst strony', what: 'ucięty do 30 000 znaków, partie po 40' },
      { name: 'claude -p / copilot -s', what: 'odpowiedź cid|WERDYKT|zdanie, timeout 900 s' },
    ],
  },
  publikacja: {
    user: 'HTML: „gotowe — lekcja jest w lekcje/<d>/<slug>/”. Tryb md: werdykt tylko w lekcja.gate.json.',
    code: [
      { file: 'pipeline/lekcja_gate.py', fn: 'publikuj (:1138-1199), aktualizuj_plany (:616), main_md --publikuj → exit 2 (:1503)' },
      { file: 'pipeline/lekcja_srs_export.py', fn: 'zbierz' },
    ],
    data: [
      { name: 'lekcje/_manifest.json', what: 'wpis slug + sha256 plików' },
      { name: 'lekcje/_plan/<src_id>.yaml', what: 'status: zweryfikowana, lekcja: <ścieżka>' },
    ],
  },
}

export const stepsFor = (mode: Mode) => STEPS.filter((s) => mode === 'html' || !s.htmlOnly)

// Files each step writes (shown in the files panel)
const FILES_OF: Partial<Record<StepId, (mode: Mode) => string[]>> = {
  g3: () => ['lekcja.tresc.json'],
  zakres: () => ['audyt.md', 'lekcja.gate.json'],
  audyt: () => ['audyt-sensu.md', '.audyt-cache.json'],
  publikacja: (mode) => (mode === 'html' ? ['lekcje/<dziedzina>/<slug>/', 'lekcje/_manifest.json', 'lekcje/_plan/<src_id>.yaml (status: zweryfikowana)'] : []),
}

export type PlanStatus = 'TODO' | 'w_toku' | 'zweryfikowana'
export type StepResult = { step: StepId; status: 'ok' | 'warn' | 'blocked' | 'error'; codes: string[] }

export type EngineContext = {
  mode: Mode
  faults: string[]
  planStatus: PlanStatus
  cache: number // number of cached ZGODNE verdicts
  claims: number
  results: StepResult[]
  files: string[]
  exitCode: number | null
  log: string[]
}

export type EngineEvent =
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'TOGGLE_FAULT'; id: string }
  | { type: 'CLEAR_FAULTS' }
  | { type: 'PREPARE' }
  | { type: 'RUN' }
  | { type: 'EDIT_CLAIM' }
  | { type: 'RESET' }

const push = (ctx: EngineContext, line: string) => [...ctx.log, line].slice(-14)
const activeFaults = (ctx: EngineContext, step: StepId) => FAULTS.filter((f) => f.step === step && ctx.faults.includes(f.id))

function evaluate(ctx: EngineContext, step: StepId): StepResult {
  const hit = activeFaults(ctx, step)
  const codes = hit.map((f) => f.code)
  if (hit.some((f) => f.severity === 'awaria')) return { step, status: 'error', codes }
  if (hit.some((f) => f.severity === 'blokuje')) return { step, status: 'blocked', codes }
  return { step, status: hit.length ? 'warn' : 'ok', codes }
}

const DELAY = 650

export const engineMachine = setup({
  types: { context: {} as EngineContext, events: {} as EngineEvent },
  guards: {
    isHtml: ({ context }) => context.mode === 'html',
    stepError: ({ context }, params: { step: StepId }) => evaluate(context, params.step).status === 'error',
    stepBlocked: ({ context }, params: { step: StepId }) => evaluate(context, params.step).status === 'blocked',
    hasLesson: ({ context }) => context.planStatus !== 'TODO',
  },
  actions: {
    record: assign(({ context }, params: { step: StepId }) => {
      const result = evaluate(context, params.step)
      // The gate writes its reports even on a red verdict; only a tool error skips them
      const files = result.status === 'error' ? [] : FILES_OF[params.step]?.(context.mode) ?? []
      const mark = { ok: '✓', warn: '⚠', blocked: '✗', error: '‼' }[result.status]
      return {
        results: [...context.results, result],
        files: [...new Set([...context.files, ...files])],
        log: push(context, `${mark} ${params.step}${result.codes.length ? `: ${result.codes.join(', ')}` : ''}`),
      }
    }),
    finishBlocked: assign(({ context }) => ({ exitCode: 1, log: push(context, 'exit 1 — werdykt blokujący, popraw i uruchom ponownie') })),
    finishError: assign(({ context }) => ({ exitCode: 2, log: push(context, 'exit 2 — awaria narzędzia, nie Twój błąd') })),
    audit: assign(({ context }) => {
      const fromCache = Math.min(context.cache, context.claims)
      return { log: push(context, `audyt: z cache ${fromCache}, do agenta ${context.claims - fromCache} (partie po 40)`) }
    }),
    warmCache: assign(({ context }) => ({ cache: context.claims })),
    publish: assign(({ context }) =>
      context.mode === 'html'
        ? { exitCode: 0, planStatus: 'zweryfikowana' as const, log: push(context, 'gotowe — lekcja jest w lekcje/<dziedzina>/<slug>/') }
        : { exitCode: 0, log: push(context, 'tryb md: werdykt tylko w lekcja.gate.json, awans robi commit') },
    ),
  },
}).createMachine({
  id: 'bramka',
  context: { mode: 'html', faults: [], planStatus: 'TODO', cache: 0, claims: 120, results: [], files: [], exitCode: null, log: [] },
  initial: 'idle',
  on: {
    TOGGLE_FAULT: { actions: assign({ faults: ({ context, event }) => (context.faults.includes(event.id) ? context.faults.filter((f) => f !== event.id) : [...context.faults, event.id]) }) },
    CLEAR_FAULTS: { actions: assign({ faults: [] }) },
    EDIT_CLAIM: { actions: assign({ cache: ({ context }) => Math.max(0, context.cache - 15), log: ({ context }) => push(context, 'zmiana 15 twierdzeń — ich klucze sha256 w cache unieważnione') }) },
    RESET: { target: '.idle', actions: assign({ planStatus: 'TODO', cache: 0, results: [], files: [], exitCode: null, log: [] }) },
  },
  states: {
    idle: {
      on: {
        SET_MODE: { actions: assign({ mode: ({ event }) => event.mode, results: [], exitCode: null }) },
        // `lekcja` → menu → przygotuj_katalog
        PREPARE: {
          actions: assign(({ context }) => ({
            planStatus: 'w_toku' as const,
            files: ['ZADANIE.md', 'lekcja.zakres.json', 'lekcja.claims.json', ...(context.mode === 'html' ? ['index.html (z szablon.html)'] : ['lekcja.md'])],
            log: push(context, 'przygotuj_katalog: lekcje/_wip/<slug>/, plan → w_toku, sesja agenta w bwrap'),
          })),
        },
        RUN: { guard: 'hasLesson', target: 'wejscie', actions: assign(({ context }) => ({ results: [], exitCode: null, log: push(context, `$ lekcja bramka  (tryb ${context.mode})`) })) },
      },
    },
    wejscie: {
      after: {
        [DELAY]: [
          { guard: { type: 'stepBlocked', params: { step: 'wejscie' } }, target: 'blocked', actions: [{ type: 'record', params: { step: 'wejscie' } }, 'finishBlocked'] },
          { guard: 'isHtml', target: 'sync', actions: { type: 'record', params: { step: 'wejscie' } } },
          { target: 'g3', actions: { type: 'record', params: { step: 'wejscie' } } },
        ],
      },
    },
    sync: {
      after: {
        [DELAY]: [
          { guard: { type: 'stepError', params: { step: 'sync' } }, target: 'toolError', actions: [{ type: 'record', params: { step: 'sync' } }, 'finishError'] },
          { target: 'g3', actions: { type: 'record', params: { step: 'sync' } } },
        ],
      },
    },
    g3: {
      after: {
        [DELAY]: [
          { guard: { type: 'stepBlocked', params: { step: 'g3' } }, target: 'blocked', actions: [{ type: 'record', params: { step: 'g3' } }, 'finishBlocked'] },
          { target: 'g4', actions: { type: 'record', params: { step: 'g3' } } },
        ],
      },
    },
    g4: {
      after: {
        [DELAY]: [
          { guard: { type: 'stepBlocked', params: { step: 'g4' } }, target: 'blocked', actions: [{ type: 'record', params: { step: 'g4' } }, 'finishBlocked'] },
          { guard: 'isHtml', target: 'g5', actions: { type: 'record', params: { step: 'g4' } } },
          { target: 'zakres', actions: { type: 'record', params: { step: 'g4' } } },
        ],
      },
    },
    g5: {
      after: {
        [DELAY]: [
          { guard: { type: 'stepBlocked', params: { step: 'g5' } }, target: 'blocked', actions: [{ type: 'record', params: { step: 'g5' } }, 'finishBlocked'] },
          { target: 'zakres', actions: { type: 'record', params: { step: 'g5' } } },
        ],
      },
    },
    zakres: {
      after: {
        [DELAY]: [
          { guard: { type: 'stepError', params: { step: 'zakres' } }, target: 'toolError', actions: [{ type: 'record', params: { step: 'zakres' } }, 'finishError'] },
          { guard: { type: 'stepBlocked', params: { step: 'zakres' } }, target: 'blocked', actions: [{ type: 'record', params: { step: 'zakres' } }, 'finishBlocked'] },
          { target: 'audyt', actions: [{ type: 'record', params: { step: 'zakres' } }, 'audit'] },
        ],
      },
    },
    // Semantic audit runs only after all deterministic steps pass; NIEZGODNE is never cached
    audyt: {
      after: {
        [DELAY * 2]: [
          { guard: { type: 'stepBlocked', params: { step: 'audyt' } }, target: 'blocked', actions: [{ type: 'record', params: { step: 'audyt' } }, 'finishBlocked'] },
          { target: 'publikacja', actions: [{ type: 'record', params: { step: 'audyt' } }, 'warmCache'] },
        ],
      },
    },
    publikacja: { after: { [DELAY]: { target: 'done', actions: [{ type: 'record', params: { step: 'publikacja' } }, 'publish'] } } },
    done: { on: { RUN: { target: 'wejscie', actions: assign(({ context }) => ({ results: [], exitCode: null, log: push(context, '$ lekcja bramka (ponownie)') })) } } },
    blocked: { on: { RUN: { target: 'wejscie', actions: assign(({ context }) => ({ results: [], exitCode: null, log: push(context, '$ lekcja bramka (po naprawie)') })) } } },
    toolError: { on: { RUN: { target: 'wejscie', actions: assign(({ context }) => ({ results: [], exitCode: null, log: push(context, '$ lekcja bramka (ponownie)') })) } } },
  },
})

/* ---------- G3 address check on a tiny example corpus ---------- */

// Example data only: page ranges are illustrative, not taken from the real corpus
export const EXAMPLE_CORPUS: Record<string, { strony: [number, number]; brak: number[]; pominiete: number[]; slabe: number[] }> = {
  'robbins-2026': { strony: [85, 94], brak: [90], pominiete: [91], slabe: [93] },
  'mutschler-2016': { strony: [130, 140], brak: [], pominiete: [], slabe: [] },
}

export type AddressVerdict = { code: string; severity: 'ok' | Severity; detail: string }

// Mirrors parse_anchor + rozstrzygnij + degraduj, simplified
export function checkAddress(address: string): AddressVerdict {
  const m = /^([a-z0-9][a-z0-9-]{1,39})#p(\d+)(?:-(\d+))?$/.exec(address.trim())
  if (!m) return { code: 'NO_EVIDENCE_ANCHOR', severity: 'blokuje', detail: 'adres nie pasuje do {src_id}#pN — kotwica odrzucona (np. #p?149), brak kotwic dowodowych' }
  const [, src, a, b] = m
  const book = EXAMPLE_CORPUS[src]
  if (!book) return { code: 'UNKNOWN_SRC', severity: 'blokuje', detail: `${src} — brak w _katalog.yaml` }
  const pages = Array.from({ length: (b ? Number(b) : Number(a)) - Number(a) + 1 }, (_, i) => Number(a) + i)
  for (const p of pages) {
    if (p < book.strony[0] || p > book.strony[1]) return { code: 'PAGE_OUT_OF_RANGE', severity: 'blokuje', detail: `p${p} poza strony_druku [${book.strony.join(', ')}]` }
    if (book.slabe.includes(p) && (book.brak.includes(p) || book.pominiete.includes(p))) return { code: 'PAGEMAP_WEAK', severity: 'ostrzezenie', detail: `błąd adresowy na słabej mapie schodzi do ostrzeżenia` }
    if (book.pominiete.includes(p)) return { code: 'MISSING_PAGE_SKIPPED', severity: 'ostrzezenie', detail: `p${p} jest w strony_pominiete` }
    if (book.brak.includes(p)) return { code: 'MISSING_PAGE', severity: 'blokuje', detail: `brak nagłówka ### p${p} w pliku rozdziału` }
  }
  if (pages.some((p) => book.slabe.includes(p))) return { code: 'PAGEMAP_WEAK', severity: 'ostrzezenie', detail: 'strona znaleziona, ale nadruk niepewny (### p?N) — liczby nadal blokują' }
  return { code: 'OK', severity: 'ok', detail: `znaleziono ${pages.map((p) => `### p${p}`).join(', ')}` }
}
