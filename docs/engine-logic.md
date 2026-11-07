# Logika silnika — podsumowanie prac

Strona `/engine-logic` („Logika silnika”, grupa Projects) wizualizuje przepływ silnika lekcji z repo
`silnik-fajdka/wspolne_projekty/fajdi_silnik_lekcje/.claude/worktrees/kontener-agy` (repo tylko czytane, nie modyfikowane).

Cel: krok po kroku zbudować intuicyjny obraz silnika dla osoby, która go nie zna, z kilku perspektyw:
- **użytkownika** — co wpisuje, co widzi, co dalej,
- **kodu** — który plik / funkcja się wykonuje,
- **danych zewnętrznych** — jakie dane walidacyjne są sprawdzane,
- kolejne perspektywy do dodania.

## Pliki

| Plik | Zawartość |
|------|-----------|
| `src/pages/EngineLogicPage.tsx` | sekcje: LearnerFlow, Architecture, GateSimulator (+ PerspectivePanel), AddressChecker, ScenarioTable |
| `src/machines/learner.machine.ts` | `STAGES` + `learnerMachine` — flow ucznia (perspektywa użytkownika) |
| `src/machines/engine.machine.ts` | `FAULTS`, `STEPS`, `PERSPECTIVES`, `engineMachine` — symulacja bramki, `checkAddress()` |
| `src/index.css` | style `.eng-*`, `.lf-*`, `.lf-src` |

## Sekcje strony

1. **Flow ucznia: jak powstaje lekcja** (z pinu w review) — 9 etapów:
   Start → Wybór jednostki → Wywiad i plan → Szukanie w książce → Składnia lekcja.md → Bramka → Audyt sensu → Poprawki → Publikacja.
   Każdy etap: „Co musisz podać”, klikalne komendy z przykładami, odpowiedź terminala + kod wyjścia, „Co z tego wynika”, przejście do kolejnego etapu, historia.
   Oznaczenie źródła: **[U]** = uruchomione naprawdę na kopii lekcji 2.2, **[K]** = wniosek z czytania kodu.
2. **Architektura** — warstwy silnika.
3. **Symulator bramki** — kroki wejście → sync → G3 → G4 → G5 → ZAKRES → audyt → publikacja; włączanie usterek (16 scenariuszy), kody wyjścia 0/1/2, status planu TODO → w_toku → zweryfikowana. Panel perspektyw 👤 / ⚙️ / 🗂 dla bieżącego kroku.
4. **Sprawdzanie adresu** — format `robbins-2026#p40`, `#p?N` (słaba mapa stron).
5. **Tabela scenariuszy** — kod błędu, krok, waga, gdzie, jak naprawić.

## Źródła danych

- `jak-dziala-silnik-lekcji.md` (dokumentacja silnika) — pierwsza wersja strony.
- `bin/lekcja`, `bin/lekcja-limit` — dosłowne komunikaty (menu, limit 25 wiadomości, bramka, błędy wyboru).
- Raport z eksperymentów agenta na kopiach lekcji 2.2 — scenariusze a–i bramki, wywiad, składnia, audyt, publikacja.
  Na macOS nie działa bwrap, więc sesji pisania i audytu sensu nie uruchomiono (tylko [K]).

## Kluczowe fakty o silniku (perspektywa użytkownika)

- `lekcja stan` — 🟢/🔴; każde 🔴 blokuje start.
- Menu: wybór **numerem z listy**, nie numerem rozdziału; Enter = 1, 0 = dokończ, w = wszystkie, q = wyjdź. Każdy błąd kończy komendę.
- Wywiad: 3 pytania (cel, priorytet, formy). Brak błędu parsera — braki uzupełniane domyślnymi (d, a, a+b+e), sprzeczności dopytywane.
- `lekcja szukaj` — dosłowne dopasowanie, korpus po angielsku.
- Bramka, scenariusze: zgodna (kod 0, ostrzeżenia `?` nie blokują), `NUM_NOT_IN_SPAN`, `NO_EVIDENCE_ANCHOR`, `PAGE_OUT_OF_RANGE` + `ZAKRES_CYTAT_POZA`, `BRAK_ZAKRESU` (tylko ostrzeżenie), `ZAKRES_NIEPOKRYTY`, `#p?` łagodzi błędy adresowe (liczby blokują nadal), `G5 JS_SYNTAX` (stary HTML).
- Kody wyjścia: 0 = dalej, 1 = „bramka czerwona — popraw”, ≥2 = awaria narzędzia.
- Audyt sensu: model czyta twierdzenie + stronę, raport w `audyt.md`, cache w `.audyt-cache.json`.
- Publikacja: `lekcja.md` — wynik commitowany, do CMS przez `bramka_hosta.py` (niezweryfikowane); stary HTML — `lekcje/<dziedzina>/<slug>/`.

## Przykładowe (niezweryfikowane) elementy

Dialog wywiadu, tytuły rozdziałów, numery linii w błędach składni (`lekcja.md:42`), część slugów/cid, kilka uciętych komunikatów uzupełnionych `…`.

## Otwarte pomysły

- Zweryfikować numery linii w perspektywie „Kod” względem repo.
- Pokazać przykładowe fragmenty danych w perspektywie „Dane”.
- Dodać perspektywę „Dlaczego” (uzasadnienie każdej reguły).
- Commit zmian (na razie niecommitowane).
