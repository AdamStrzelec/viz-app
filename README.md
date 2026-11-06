# viz-app

Learning playground that turns logic flows into interactive visualizations. Each page models a process (SSH forced command, git workflow, release model, logic gates…) as a state machine and renders it so the user can step through the flow and watch state, context and transitions change.

## How it works

- **[xstate v5](https://stately.ai/docs/xstate)** models the logic. Machines live in `src/machines/` and `src/game/` and follow the `setup({ types, actions, guards, actors }).createMachine(...)` pattern. React pages (`src/pages/*Page.tsx`) drive them with `useMachine` from `@xstate/react`, and each demo is wrapped in `src/components/Example.tsx`, which also shows the live snapshot. `@statelyai/inspect` powers the Inspector page.
- **[@reviewjs/annotate](https://www.npmjs.com/package/@reviewjs/annotate)** adds a visual review layer on top of the running app (dev only). You can highlight blocks, draw rectangles/circles, sketch or drop pins directly on a visualization and describe what should look or behave differently. The annotations are saved to `feedback/latest.json`, which serves as precise, located feedback for the next iteration of the visualization.

## Running

```bash
npm install   # all dependencies (the feedback receiver has none of its own)
npm run dev   # frontend + feedback receiver on http://localhost:5173
```

## Feedback flow

1. Run `npm run dev` (the receiver is mounted inside the Vite dev server).
2. Open a page, click **Review** (bottom-right) and annotate the visualization.
3. Comments auto-sync to `feedback/latest.json` about a second after each change (the **Send feedback** button sends them manually). `POST /feedback` is handled by `scripts/feedback-server.mjs`, plugged into Vite in `vite.config.ts`.
4. Use the JSON (page, comment text, CSS selector and geometry of each annotation) to apply the requested changes.

Comments are also kept in the browser's `localStorage`. Each sync overwrites the file with the current page's comments only.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR + feedback receiver at `/feedback` |
| `npm run build` | Type-check (`tsc -b`) and production build |
| `npm run lint` | Oxlint |
| `npm run feedback` | Optional standalone receiver on port 8787 (not needed with `npm run dev`) |

---

## Template notes (React + TypeScript + Vite)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
