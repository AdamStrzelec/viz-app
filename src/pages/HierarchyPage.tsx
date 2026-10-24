import { createMachine } from 'xstate'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'

// Nested (hierarchical) states
const playerMachine = createMachine({
  id: 'player',
  initial: 'stopped',
  states: {
    stopped: { on: { PLAY: 'active' } },
    active: {
      initial: 'playing',
      on: { STOP: 'stopped' },
      states: {
        playing: { on: { PAUSE: 'paused' } },
        paused: { on: { PLAY: 'playing' } },
      },
    },
  },
})

// Parallel regions
const editorMachine = createMachine({
  id: 'editor',
  type: 'parallel',
  states: {
    bold: { initial: 'off', states: { off: { on: { TOGGLE_BOLD: 'on' } }, on: { on: { TOGGLE_BOLD: 'off' } } } },
    italic: { initial: 'off', states: { off: { on: { TOGGLE_ITALIC: 'on' } }, on: { on: { TOGGLE_ITALIC: 'off' } } } },
    align: {
      initial: 'left',
      states: { left: {}, center: {}, right: {} },
      on: { ALIGN_LEFT: '.left', ALIGN_CENTER: '.center', ALIGN_RIGHT: '.right' },
    },
  },
})

// History state remembers the last child
const settingsMachine = createMachine({
  id: 'settings',
  initial: 'closed',
  states: {
    closed: { on: { OPEN: 'open.hist' } },
    open: {
      initial: 'general',
      on: { CLOSE: 'closed' },
      states: {
        general: { on: { NEXT_TAB: 'privacy' } },
        privacy: { on: { NEXT_TAB: 'account' } },
        account: { on: { NEXT_TAB: 'general' } },
        hist: { type: 'history' },
      },
    },
  },
})

// state.matches() on nested values
const authMachine = createMachine({
  id: 'auth',
  initial: 'loggedOut',
  states: {
    loggedOut: { on: { LOGIN: 'loggedIn' } },
    loggedIn: {
      initial: 'user',
      on: { LOGOUT: 'loggedOut' },
      states: { user: { on: { ELEVATE: 'admin' } }, admin: { on: { DROP: 'user' } } },
    },
  },
})

export default function HierarchyPage() {
  const [player, sendPlayer] = useMachine(playerMachine)
  const [editor, sendEditor] = useMachine(editorMachine)
  const [settings, sendSettings] = useMachine(settingsMachine)
  const [auth, sendAuth] = useMachine(authMachine)

  const v = editor.value as { bold: string; italic: string; align: string }

  return (
    <>
      <Example title="Nested states" description="active has its own child states." state={player.value}>
        <button onClick={() => sendPlayer({ type: 'PLAY' })}>Play</button>
        <button onClick={() => sendPlayer({ type: 'PAUSE' })}>Pause</button>
        <button onClick={() => sendPlayer({ type: 'STOP' })}>Stop</button>
      </Example>

      <Example title="Parallel states" description="Independent regions active at once." state={editor.value}>
        <button onClick={() => sendEditor({ type: 'TOGGLE_BOLD' })}>B</button>
        <button onClick={() => sendEditor({ type: 'TOGGLE_ITALIC' })}>I</button>
        <button onClick={() => sendEditor({ type: 'ALIGN_LEFT' })}>Left</button>
        <button onClick={() => sendEditor({ type: 'ALIGN_CENTER' })}>Center</button>
        <button onClick={() => sendEditor({ type: 'ALIGN_RIGHT' })}>Right</button>
        <p style={{ width: '100%', textAlign: v.align as 'left', fontWeight: v.bold === 'on' ? 700 : 400, fontStyle: v.italic === 'on' ? 'italic' : 'normal' }}>
          Sample text
        </p>
      </Example>

      <Example title="History state" description="Reopening returns to the last tab." state={settings.value}>
        <button onClick={() => sendSettings({ type: 'OPEN' })}>Open</button>
        <button onClick={() => sendSettings({ type: 'NEXT_TAB' })}>Next tab</button>
        <button onClick={() => sendSettings({ type: 'CLOSE' })}>Close</button>
      </Example>

      <Example title="state.matches()" description="Check nested state values." state={{ value: auth.value, isAdmin: auth.matches({ loggedIn: 'admin' }) }}>
        <button onClick={() => sendAuth({ type: 'LOGIN' })}>Login</button>
        <button onClick={() => sendAuth({ type: 'ELEVATE' })}>Elevate</button>
        <button onClick={() => sendAuth({ type: 'DROP' })}>Drop</button>
        <button onClick={() => sendAuth({ type: 'LOGOUT' })}>Logout</button>
      </Example>
    </>
  )
}
