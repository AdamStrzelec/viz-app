import { assign, setup } from 'xstate'

/* The lesson engine seen only by the learner: what they type, what they get back, what happens next.
   Messages from bin/lekcja + experiment report on lesson 2.2 (kontener-agy). */

export type StageId = 'start' | 'menu' | 'sesja' | 'pisanie' | 'skladnia' | 'bramka' | 'audyt' | 'naprawa' | 'gotowe'

/* src: 'U' = run for real on copies of lesson 2.2, 'K' = inferred from reading the code only */
export type Command = {
  input: string
  scenario: string
  output: string
  tone: 'ok' | 'bad' | 'info'
  consequence: string
  next: StageId
  src: 'U' | 'K'
  exit?: number
}

export type Stage = { id: StageId; label: string; where: string; needs: string[]; commands: Command[] }

const RED = '✗ bramka czerwona — popraw to, co wyżej ze znakiem ✗'

export const STAGES: Stage[] = [
  {
    id: 'start',
    label: 'Start',
    where: 'terminal, dowolny katalog',
    needs: ['nic — wystarczy konto pulso'],
    commands: [
      { input: 'lekcja stan', scenario: 'wszystko gotowe', src: 'U', exit: 0, tone: 'ok', next: 'start',
        output: '🟢 Python projektu i biblioteki\n🟢 izolacja sesji pisania (bwrap)\n🟢 agent claude\n🟢 node (sprawdzanie skryptów lekcji)\n🟢 tekst książki robbins-2026\n🟢 bramka sprawdzająca (test na wzorcu)',
        consequence: 'Nic się nie zmienia. Wiesz, że możesz zaczynać.' },
      { input: 'lekcja stan', scenario: 'brak izolacji (np. macOS)', src: 'U', tone: 'bad', next: 'start',
        output: '🔴 izolacja sesji (bwrap) nie działa\n   → napisz do Przemka: …',
        consequence: 'Każde 🔴 blokuje start lekcji. Komunikat mówi, komu to zgłosić.' },
      { input: 'lekcja', scenario: 'zaczynam nową lekcję', src: 'K', tone: 'info', next: 'menu',
        output: 'Co robimy? Książka: robbins-2026\n  1) 2.1 Inflammation … \n     strony 30-39\n  2) 2.2 …\n  3) 2.3 …\nKtóra? [1-N, Enter = 1, w = wszystkie tematy, q = wyjdź]:',
        consequence: 'Przed menu cichy test (jak lekcja stan). Lista jednostek pochodzi z planu książki.' },
      { input: 'lekcja foo', scenario: 'literówka w komendzie', src: 'U', exit: 1, tone: 'bad', next: 'start',
        output: '✗ nie znam komendy „foo”\n(pomoc: lista komend)',
        consequence: 'Nic się nie dzieje, dostajesz pomoc.' },
    ],
  },
  {
    id: 'menu',
    label: 'Wybór jednostki',
    where: 'menu po komendzie lekcja',
    needs: ['numer z listy (nie numer rozdziału!)', 'Enter = pierwsza, 0 = dokończ, w = wszystkie, q = wyjdź'],
    commands: [
      { input: '3', scenario: 'wybieram jednostkę z listy', src: 'K', tone: 'ok', next: 'sesja',
        output: '(otwiera się sesja z agentem piszącym)',
        consequence: 'Powstaje lekcje/_wip/<slug>/ z zadaniem i zakresem stron. Jednostka w planie: TODO → w toku.' },
      { input: '(Enter)', scenario: 'domyślnie pierwsza', src: 'K', tone: 'ok', next: 'sesja',
        output: '(otwiera się sesja z agentem piszącym)', consequence: 'Jak wybór 1.' },
      { input: 'q', scenario: 'rezygnuję', src: 'K', tone: 'info', next: 'start',
        output: 'Do zobaczenia', consequence: 'Nic nie powstaje.' },
      { input: '2.2', scenario: 'wpisuję numer rozdziału', src: 'K', tone: 'bad', next: 'start',
        output: '✗ nie rozumiem „2.2” — wpisz numer z listy',
        consequence: 'Komenda się kończy — trzeba odpalić lekcja jeszcze raz.' },
      { input: '99', scenario: 'numer spoza listy', src: 'K', tone: 'bad', next: 'start',
        output: '✗ nie ma takiego numeru', consequence: 'Komenda się kończy — lekcja jeszcze raz.' },
      { input: '3  (drugie okno)', scenario: 'lekcja otwarta w innym oknie', src: 'K', tone: 'bad', next: 'start',
        output: '✗ ta lekcja jest już otwarta w innym oknie',
        consequence: 'Jedna lekcja = jedno okno. Wracasz do tamtego.' },
    ],
  },
  {
    id: 'sesja',
    label: 'Wywiad i plan',
    where: 'czat z agentem w piaskownicy',
    needs: ['1) cel: a) kolokwium, b) egzamin, … + termin', '2) priorytet: mechanizmy / różnicowanie / liczby / morfologia / przypadki', '3) formy ćwiczeń i co pominąć', 'zatwierdzenie planu modułów'],
    commands: [
      { input: '1c, 2 a b, 3 a b f', scenario: 'pełna odpowiedź na 3 pytania', src: 'K', tone: 'info', next: 'sesja',
        output: 'Agent: plan modułów\n  moduł | strony | tematy | formy\n  …\nZatwierdzasz?',
        consequence: 'Odpowiedzi trafiają do WYWIAD.md — przy „dokończ” nie przepadną.' },
      { input: '2 a', scenario: 'niepełna odpowiedź', src: 'K', tone: 'info', next: 'sesja',
        output: 'Agent: brakujące uzupełniam domyślnymi (d, a, a+b+e). Plan modułów: …',
        consequence: 'Nie ma błędu parsera — braki dostają wartości domyślne.' },
      { input: '1a 1b', scenario: 'sprzeczna odpowiedź', src: 'K', tone: 'info', next: 'sesja',
        output: 'Agent: kolokwium czy egzamin?',
        consequence: 'Przy sprzeczności agent dopytuje.' },
      { input: 'zatwierdzam', scenario: 'akceptuję plan', src: 'K', tone: 'ok', next: 'pisanie',
        output: 'Agent pisze lekcja.md i lekcja.claims.json…',
        consequence: 'Każde twierdzenie dostaje adres strony, np. robbins-2026#p14.' },
      { input: '(26. wiadomość)', scenario: 'za długa rozmowa', src: 'K', tone: 'bad', next: 'start',
        output: 'Ta rozmowa doszła do limitu (25 wiadomości). Zrób tak:\n  1. jeśli lekcja jest gotowa, napisz tylko: bramka (sprawdzę i opublikuję),\n  2. wpisz /exit,\n  3. wpisz lekcja i wybierz „⏩ dokończ” — nowa rozmowa zacznie od tego, co już jest.',
        consequence: 'Praca zostaje w _wip, wracasz przez „dokończ”.' },
    ],
  },
  {
    id: 'pisanie',
    label: 'Szukanie w książce',
    where: 'wewnątrz sesji',
    needs: ['fraza po angielsku (korpus jest EN, dopasowanie dosłowne)'],
    commands: [
      { input: 'lekcja szukaj "apoptosis"', scenario: 'fraza jest w książce', src: 'U', exit: 0, tone: 'ok', next: 'pisanie',
        output: 'robbins-2026#p14  r11-…md:382: …mitochondria play a fundamental role in regulating apoptosis…',
        consequence: 'Masz adres strony do wpisania przy twierdzeniu.' },
      { input: 'lekcja szukaj "zapalenie ostre"', scenario: 'fraza po polsku', src: 'U', tone: 'bad', next: 'pisanie',
        output: 'nie ma w źródle: „zapalenie ostre”',
        consequence: 'To nie błąd — korpus jest po angielsku. Użyj angielskiego terminu.' },
      { input: 'lekcja szukaj', scenario: 'bez frazy', src: 'K', tone: 'bad', next: 'pisanie',
        output: '✗ napisz, czego szukać', consequence: 'Nic się nie dzieje.' },
      { input: 'lekcja szukaj "…"  →  #p?132', scenario: 'adres z pytajnikiem', src: 'K', tone: 'info', next: 'pisanie',
        output: 'robbins-2026#p?132  …',
        consequence: 'Słaba mapa stron w tym miejscu książki — bramka złagodzi błędy adresowe (scenariusz h).' },
      { input: 'lekcja.md gotowa', scenario: 'przechodzę do pliku lekcji', src: 'K', tone: 'info', next: 'skladnia',
        output: '(lekcja.md + lekcja.claims.json zapisane)', consequence: 'Czas sprawdzić składnię i bramkę.' },
    ],
  },
  {
    id: 'skladnia',
    label: 'Składnia lekcja.md',
    where: 'plik lekcja.md',
    needs: ['poprawne dyrektywy :::X z wymaganymi atrybutami', 'pola @X bez powtórzeń, jednolite listy'],
    commands: [
      { input: 'lekcja bramka', scenario: 'składnia poprawna', src: 'K', tone: 'info', next: 'bramka',
        output: '(bramka czyta lekcja.md i twierdzenia…)', consequence: 'Plik się parsuje — idą reguły G3/G4/ZAKRES.' },
      { input: 'lekcja bramka', scenario: 'nieznana dyrektywa :::X', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ … (lekcja.md:42)\n' + RED, consequence: 'Bramka wskazuje miejsce w pliku. Popraw i odpal ponownie.' },
      { input: 'lekcja bramka', scenario: 'brak atrybutu / pole @X powtórzone', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ … (lekcja.md:17)\n' + RED, consequence: 'To samo: miejsce w pliku, poprawka, bramka jeszcze raz.' },
      { input: 'lekcja bramka', scenario: 'lista miesza - i 1. / @wyjasnienie przed @op / zła warstwa= lub wariant=', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ … (lekcja.md:88)\n' + RED, consequence: 'Każdy z tych błędów blokuje.' },
    ],
  },
  {
    id: 'bramka',
    label: 'Bramka',
    where: 'lekcja bramka w lekcje/_wip/<slug>/',
    needs: ['nic — bramka czyta pliki lekcji i tekst książki'],
    commands: [
      { input: '(a) zgodna z podręcznikiem', scenario: 'wszystko się zgadza', src: 'U', exit: 0, tone: 'ok', next: 'audyt',
        output: 'STATUS: zweryfikowana — 0 ✗\nZAKRES: 10/10 stron (100%)\n? NUM_NIEZADEKLAROWANA  „1-2 dni”',
        consequence: 'Kod 0 — idzie do audytu sensu. Ostrzeżenia ? nie blokują (tu: liczby „1-2 dni” nikt nie sprawdza).' },
      { input: '(b) 1972 → 1973', scenario: 'liczba niezgodna z książką', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ G3/G4 NUM_NOT_IN_SPAN  l1\n' + RED,
        consequence: 'Popraw liczbę, sprawdź stronę (lekcja szukaj "1972") albo usuń liczbę z twierdzenia.' },
      { input: '(c) robbins#40', scenario: 'zły format adresu', src: 'U', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ NO_EVIDENCE_ANCHOR … brak kotwic\n' + RED,
        consequence: 'Poprawny format: robbins-2026#p40.' },
      { input: '(d) #p9999', scenario: 'strona, której nie ma', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ PAGE_OUT_OF_RANGE  strona 9999\n✗ ZAKRES_CYTAT_POZA\n' + RED,
        consequence: 'Dwa błędy naraz z jednej pomyłki.' },
      { input: '(e) cytat p55 przy zakresie p30-39', scenario: 'treść spoza jednostki', src: 'U', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ ZAKRES_CYTAT_POZA …\n' + RED,
        consequence: 'Lekcja może cytować tylko strony swojej jednostki.' },
      { input: '(f) brak lekcja.zakres.json', scenario: 'brak pliku zakresu', src: 'U', exit: 0, tone: 'info', next: 'audyt',
        output: '? BRAK_ZAKRESU',
        consequence: 'Tylko ostrzeżenie — przechodzi, ale nikt nie sprawdza, czy czegoś nie pominięto.' },
      { input: '(g) pominięta strona', scenario: 'strona z zakresu bez twierdzenia', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ ZAKRES_NIEPOKRYTY\n' + RED,
        consequence: 'Dopisz twierdzenie albo oznacz stronę jako pominiętą z powodem. Bez powodu też blokuje.' },
      { input: '(h) #p?149', scenario: 'słaba mapa stron', src: 'K', exit: 0, tone: 'info', next: 'audyt',
        output: '? … (adres niepewny)',
        consequence: 'Błędy adresowe stają się ostrzeżeniami. Niezgodne liczby blokują nadal.' },
      { input: '(i) zepsuty JS (stary HTML)', scenario: 'błąd w kodzie lekcji', src: 'U', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ G5 JS_SYNTAX … SyntaxError\n' + RED,
        consequence: 'Dotyczy tylko starego formatu HTML.' },
      { input: 'lekcja bramka --x', scenario: 'nieznana opcja', src: 'K', tone: 'bad', next: 'pisanie',
        output: '✗ nieznana opcja: --x', consequence: 'Błąd wywołania — bramka nic nie sprawdziła.' },
      { input: 'lekcja bramka  (poza _wip)', scenario: 'zły katalog', src: 'K', tone: 'bad', next: 'pisanie',
        output: '✗ bramka działa tylko w katalogu lekcji…', consequence: 'Przejdź do lekcje/_wip/<slug>/.' },
      { input: 'lekcja bramka  (pusty katalog)', scenario: 'brak plików lekcji', src: 'K', tone: 'bad', next: 'pisanie',
        output: '✗ w … nie ma ani lekcja.md, ani index.html', consequence: 'Najpierw lekcja musi powstać.' },
      { input: '(awaria)', scenario: 'narzędzie się wysypało', src: 'K', exit: 2, tone: 'bad', next: 'start',
        output: '✗ bramka się przewróciła — to awaria narzędzia, nie Twój błąd',
        consequence: 'Kod ≥2. Nie poprawiasz lekcji — zgłaszasz.' },
    ],
  },
  {
    id: 'audyt',
    label: 'Audyt sensu',
    where: 'model AI czyta twierdzenie + stronę',
    needs: ['nic — model dostaje każde twierdzenie z tekstem cytowanej strony'],
    commands: [
      { input: '(wynik) wszystko wynika ze stron', scenario: 'sens zgodny', src: 'K', exit: 0, tone: 'ok', next: 'gotowe',
        output: '── 3/4 czytam każde twierdzenie razem ze stroną książki (audyt sensu)\n── 4/4 publikuję lekcję',
        consequence: 'Raport w audyt.md. Lekcja idzie do publikacji.' },
      { input: '(wynik) zdanie mówi co innego', scenario: 'niezgodny sens', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ te twierdzenia nie zgadzają się ze stroną książki: l4\n' + RED,
        consequence: 'Przeczytaj zastrzeżenia w audyt.md, popraw treść albo adres.' },
      { input: '(wynik) brak strony w korpusie', scenario: 'nie da się sprawdzić', src: 'K', exit: 1, tone: 'bad', next: 'naprawa',
        output: '✗ tych twierdzeń nie da się sprawdzić: l7\n' + RED,
        consequence: 'Brakuje strony albo książki w korpusie — zmień adres.' },
    ],
  },
  {
    id: 'naprawa',
    label: 'Poprawki',
    where: 'ta sama sesja albo lekcja → „dokończ”',
    needs: ['poprawka według linii ze ✗ (miejsce, kod błędu)'],
    commands: [
      { input: 'popraw l1 na 1972 i puść bramkę', scenario: 'poprawiam i sprawdzam ponownie', src: 'K', tone: 'info', next: 'bramka',
        output: '(bramka od nowa)\n   z poprzednich sprawdzeń (bez zmian): …',
        consequence: 'Niezmienione twierdzenia audyt bierze z .audyt-cache.json — szybciej.' },
      { input: 'lekcja szukaj "1972"', scenario: 'szukam właściwej strony', src: 'K', tone: 'info', next: 'pisanie',
        output: 'robbins-2026#p…  …1972…', consequence: 'Masz poprawny adres do wpisania.' },
      { input: 'lekcja → 0', scenario: 'wracam później', src: 'K', tone: 'info', next: 'sesja',
        output: '  0) ⏩ dokończ: …\nKtóra? [0-N, Enter = 0 (dokończ), …]:',
        consequence: 'Lekcja czeka w _wip, wywiad zapisany.' },
    ],
  },
  {
    id: 'gotowe',
    label: 'Publikacja',
    where: 'lekcja.md: commit · HTML: lekcje/<dziedzina>/<slug>/',
    needs: [],
    commands: [
      { input: '(lekcja.md)', scenario: 'nowy format', src: 'K', exit: 0, tone: 'ok', next: 'gotowe',
        output: '(wynik bramki zapisany i commitowany)',
        consequence: 'Do CMS wysyła później bramka_hosta.py — tego kroku nie zweryfikowano.' },
      { input: '(stary HTML)', scenario: 'stary format', src: 'U', exit: 0, tone: 'ok', next: 'gotowe',
        output: 'gotowe — lekcja jest w lekcje/<dziedzina>/<slug>/',
        consequence: 'Jednostka w planie: zweryfikowana.' },
      { input: 'lekcja', scenario: 'następny temat', src: 'K', tone: 'info', next: 'menu',
        output: 'Co robimy? …', consequence: 'Menu proponuje kolejne jednostki.' },
    ],
  },
]

export const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!

type Entry = { stage: StageId; command: Command }
export type LearnerContext = { history: Entry[] }
export type LearnerEvent = { type: 'TYPE'; command: Command } | { type: 'RESET' }

// One state per stage; every command is an event whose target is its `next` stage
export const learnerMachine = setup({
  types: { context: {} as LearnerContext, events: {} as LearnerEvent },
  actions: {
    remember: assign(({ context, event }, params: { stage: StageId }) => (event.type === 'TYPE' ? { history: [...context.history, { stage: params.stage, command: event.command }].slice(-20) } : {})),
  },
}).createMachine({
  id: 'uczen',
  context: { history: [] },
  initial: 'start',
  on: { RESET: { target: '.start', actions: assign({ history: [] }) } },
  states: Object.fromEntries(
    STAGES.map((s) => [
      s.id,
      {
        on: {
          TYPE: STAGES.map((t) => ({
            guard: ({ event }: { event: LearnerEvent }) => event.type === 'TYPE' && event.command.next === t.id,
            target: t.id,
            actions: { type: 'remember' as const, params: { stage: s.id } },
          })),
        },
      },
    ]),
  ),
})
