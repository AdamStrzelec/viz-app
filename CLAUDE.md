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
