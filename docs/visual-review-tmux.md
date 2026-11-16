# Przegląd wizualny: Agentation + tmux

Narzędzie lokalne, tylko `npm run dev`. Port z medycznelekcje.pl#151 (Next API routes → middleware Vite w `vite.visual-review.ts`).

## Start

1. `cp .env.example .env.local`, ustaw `VITE_VISUAL_REVIEW=1`.
2. W tmuxie: uruchom `claude`, w tym panelu `echo $TMUX_PANE` → wpisz do `AGENTATION_TMUX_PANE` w `.env.local`.
3. `npm run dev` startuje Vite i agentation-mcp (port z `VITE_AGENTATION_ENDPOINT`, CORS = faktyczny port Vite; zamyka się razem z Vite).
   Jeśli coś już odpowiada na tym porcie (np. `npm run agentation` osobno), zostaje użyte. Toolbar Agentation (prawy dół) + panel „Claude” (lewy dół) na każdej stronie
   (`VITE_VISUAL_REVIEW_PATH` ogranicza do jednej ścieżki).

## Jak działa

- Toolbar zapisuje adnotacje w agentation-mcp. Panel pokazuje wątki/statusy (poll co 3 s).
- „Sprawdź adnotacje” / „Wyślij” → `POST /api/dev/visual-review/notify` → `tmux set-buffer` + `paste-buffer -p` + `send-keys Enter`
  do panelu z Claude. Wiadomość z pola dostaje podpowiedź `curl` do `POST /api/dev/visual-review/chat` (odpowiedź w panelu).
- Hook `UserPromptSubmit` (`.claude/hooks/agentation-pending.sh`) dokleja `GET z `VITE_AGENTATION_ENDPOINT`/pending`. Claude: `agentation_acknowledge`,
  zmiana, `agentation_reply` (`PYTANIE:` = pytanie). `resolved` ustawia człowiek („Zaakceptuj”).
- Obrazy z panelu → `POST /api/dev/visual-review/upload` → `$TMPDIR/visual-review/*.png`, ścieżka idzie w wiadomości.

## Bezpieczeństwo

- Endpointy istnieją tylko w `vite` dev z `VITE_VISUAL_REVIEW=1`; build produkcyjny nie zawiera panelu.
- `execFile` bez powłoki, tekst jako argument, znaki sterujące usuwane, limit 2000 znaków; pane walidowany `^%\d{1,6}$`.
- Wymagany lokalny `Origin` + `Sec-Fetch-Site: same-origin` (chat POST przyjmuje też brak Origin — curl z Claude).
- Ryzyko resztkowe: treść adnotacji to instrukcja dla Claude, a serwer z `VITE_AGENTATION_ENDPOINT` nie ma uwierzytelnienia. Nie używaj trybu
  „akceptuj wszystko” w tej sesji. Zły `AGENTATION_TMUX_PANE` (np. zwykły shell) wpisze tam tekst z Enterem.
