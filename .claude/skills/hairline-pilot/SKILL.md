---
name: hairline-pilot
description: Pilot integration of Hairline (@lucasmarkes/hairline) as an optional visualization layer for XState-driven processes — adds /hairline page with library figures and a custom isometric SVG scene for a demo machine. Use when the user asks to add/build the Hairline page, Hairline pilot, or Hairline illustrations for XState processes.
disable-model-invocation: false
---

Pracujesz w repozytorium viz-app.

## CEL
Dodaj pilotażową integrację Hairline jako opcjonalną warstwę wizualizacji procesów sterowanych przez XState.

Ta aplikacja służy do interaktywnego wyjaśniania logiki różnych aplikacji. Ilustracje mają pomagać zrozumieć rzeczywisty przebieg procesu, a nie być wyłącznie dekoracyjną animacją.

## NAJPIERW INSPEKCJA I PLAN
1. Przeczytaj CLAUDE.md i package.json.
2. Przejrzyj:
   - src/App.tsx
   - src/components/Example.tsx
   - src/useTheme.ts
   - src/index.css
   - istniejące strony i maszyny związane z procesami.
3. Przeczytaj dokumentację: https://hairline.lucasmarkes.com/llms.txt
4. Ustal aktualny sposób tworzenia aktorów i obsługi motywu.
5. Przedstaw krótki plan oraz pliki, które zamierzasz zmienić.
6. Poczekaj na akceptację użytkownika przed implementacją.

## ZALEŻNOŚCI I SKILLS
- Biblioteka: @lucasmarkes/hairline.
- Repo skilla: https://github.com/lucasmarkes/hairline.
- Instalacja biblioteki: `npm install @lucasmarkes/hairline`.
- Instalacja skills: `npx skills add lucasmarkes/hairline`.
- Sprawdź istniejącą konfigurację przed instalacją.
- Preferuj skill lokalny dla projektu.
- Nie nadpisuj istniejących settings ani uprawnień.
- Nie dodawaj MCP, nowych sekretów ani dodatkowego serwera.

## ZAKRES PILOTAŻU
Dodaj stronę /hairline zgodnie z aktualnym wzorcem rejestracji stron w src/App.tsx.

Sekcja 1:
- Pokaż 2–3 gotowe komponenty biblioteki, np. Relay, Hub, Rebuild.
- Sprawdź faktyczne eksporty i ich typy.
- Wyraźnie opisz, że to ilustracje demonstracyjne, a nie automatyczne wizualizatory XState.
- Dopasuj je do istniejącego motywu.

Sekcja 2:
- Przygotuj małą maszynę demonstracyjną XState v5: idle, validating, processing, success, error.
- Zapewnij możliwość przejścia ścieżką sukcesu, zasymulowania błędu, ponowienia i resetu.
- Nie wykonuj rzeczywistych requestów ani operacji zewnętrznych.
- Zbuduj dla niej własną izometryczną ilustrację SVG w stylistyce Hairline.

## UŻYCIE SKILLA
- Użyj hairline-create do zaproponowania koncepcji wizualnej.
- Jeżeli jego standardowym wynikiem jest HTML, zaadaptuj wynik do komponentu React/TypeScript.
- Nie osadzaj HTML w iframe.
- Nie zakładaj, że gotowe komponenty biblioteki przyjmują graf maszyny albo dowolny kontrolowany postęp animacji.
- Nie używaj nieudokumentowanego API.

## ARCHITEKTURA
- Jedna instancja aktora dla danego przykładu.
- XState jest jedynym źródłem prawdy o procesie.
- Oddziel maszynę, mapowanie snapshotu na model prezentacji i komponent SVG.
- Ilustracja otrzymuje dane prezentacyjne i callbacki.
- Akcje użytkownika wysyłają typowane zdarzenia do aktora.
- Nie duplikuj logiki przejść w useState, useEffect ani timerach.
- Animacje nie mogą samodzielnie zmieniać etapu procesu.
- Nie wyznaczaj ukończenia etapów wyłącznie ich kolejnością.
- Nie buduj jeszcze uniwersalnego silnika renderowania dowolnych maszyn ani automatycznego layoutu grafów.

## UI
- Użyj istniejącego komponentu Example.
- Zachowaj czytelny snapshot i przyciski sterowania.
- Pokaż tekstowe nazwy etapów oraz znaczenie wyróżnień.
- Obsłuż light/dark, klawiaturę i prefers-reduced-motion.
- Brak animacji nie może odbierać informacji o stanie.
- Nie zmieniaj zachowania istniejących przykładów.

## KONFIGURACJA CLAUDE
Po akceptacji planu zaktualizuj w CLAUDE.md sekcję "Process illustrations" (już istnieje — uzupełnij, nie duplikuj) o zwięzłe zasady tworzenia kolejnych ilustracji zgodne z powyższą architekturą.
Nie dodawaj hooks ani szerokich uprawnień bez konkretnej potrzeby.
Nie zmieniaj settings.json tylko po to, aby użyć skilla.

## WERYFIKACJA
- `npm run build`
- `npm run lint`
- Sprawdź stronę w przeglądarce, jeżeli masz dostępne narzędzie.
- Jeżeli go nie masz, powiedz wprost; nie deklaruj testu wizualnego.
- Sprawdź sukces, błąd, retry, reset i zmianę motywu.
- Nie twórz commita ani pusha bez polecenia użytkownika.

## NA KONIEC
Opisz:
- zmienione pliki;
- sposób uruchomienia;
- różnicę między gotowymi figurami a własną sceną;
- jak dodać kolejną ilustrację do innej maszyny;
- ograniczenia pilotażu.
