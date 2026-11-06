# viz-app

Learning playground for **xstate v5** visualized in React.

- Stack: Vite 8, React 19, TypeScript 6, react-router-dom 7, xstate 5.33, @xstate/react 6, @statelyai/inspect.
- Commands: `npm run dev`, `npm run build` (tsc -b + vite), `npm run lint` (oxlint).
- Pages: `src/pages/*Page.tsx`, registered in `src/App.tsx` `pages` array; each demo wrapped in `src/components/Example.tsx`.
- Machines: `src/machines/`, `src/game/`. Pattern: `setup({ types, actions, guards, actors }).createMachine(...)`.

## xstate rules
- This is **v5, not v4**. API reference: `docs/xstate-api.md` — read before using unfamiliar API.
- Verify signatures in `node_modules/xstate/dist/declarations/src/*.d.ts` or context7 when unsure.
- Run `npm run build` after changes to catch type errors.
- Scope: work only inside this directory.

## Process illustrations (`@lucasmarkes/hairline`)
Illustrations visualize xstate workflows. XState is the single source of truth for behavior.

- Illustration = pure view of the snapshot. No second state machine, no extra actor just for visuals.
- User actions send typed events to the existing actor (`actorRef.send`).
- Derive visual stage status from the snapshot (`snapshot.matches`, `snapshot.context`, tags), never from a numeric stage index — workflows branch, retry, loop, run in parallel.
- Show `active`, `completed`, `failed`, `inactive` stages distinctly.
- Timers and SVG animations interpolate presentation only. Animation completion never advances business logic (no `onAnimationEnd` → `send`).
- Keep labels, event names and a readable snapshot (state value + context) visible next to the figure.
- Support light/dark (hairline `theme="auto"`) and `prefers-reduced-motion`.
- Ship as React/TypeScript components (`@lucasmarkes/hairline/react`), not standalone HTML pages or iframes.
- `hairline-create` skill outputs one HTML file: use it for visual exploration only, then port the figure to a controlled React component (props in: snapshot-derived state; callbacks out: typed events).
