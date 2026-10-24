import { assign, createMachine, setup } from 'xstate'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'

// Plain finite states with event-driven transitions
const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: {
    off: { on: { TOGGLE: 'on' } },
    on: { on: { TOGGLE: 'off' } },
  },
})

// Delayed transitions with `after`
const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'green',
  states: {
    green: { after: { 3000: 'yellow' } },
    yellow: { after: { 1000: 'red' } },
    red: { after: { 2000: 'green' } },
  },
})

// Entry/exit actions declared in setup()
const logMachine = setup({
  types: { context: {} as { log: string[] } },
  actions: {
    record: assign({ log: ({ context }, params: { msg: string }) => [...context.log, params.msg].slice(-5) }),
  },
}).createMachine({
  id: 'door',
  initial: 'closed',
  context: { log: [] },
  states: {
    closed: {
      entry: { type: 'record', params: { msg: 'entered closed' } },
      exit: { type: 'record', params: { msg: 'left closed' } },
      on: { OPEN: 'opened' },
    },
    opened: {
      entry: { type: 'record', params: { msg: 'entered opened' } },
      on: { CLOSE: 'closed' },
    },
  },
})

// Final state
const wizardMachine = createMachine({
  id: 'wizard',
  initial: 'step1',
  states: {
    step1: { on: { NEXT: 'step2' } },
    step2: { on: { NEXT: 'done', BACK: 'step1' } },
    done: { type: 'final' },
  },
})

export default function BasicsPage() {
  const [toggle, sendToggle] = useMachine(toggleMachine)
  const [light] = useMachine(trafficLightMachine)
  const [door, sendDoor] = useMachine(logMachine)
  const [wizard, sendWizard] = useMachine(wizardMachine)

  return (
    <>
      <Example title="States & transitions" description="Two states, one event." state={toggle.value}>
        <button onClick={() => sendToggle({ type: 'TOGGLE' })}>Toggle</button>
      </Example>

      <Example title="Delayed transitions (after)" description="Changes on its own every few seconds." state={light.value}>
        <span>🚦 {String(light.value)}</span>
      </Example>

      <Example title="Entry / exit actions" description="Actions run when entering and leaving states." state={door.context.log}>
        <button disabled={!door.can({ type: 'OPEN' })} onClick={() => sendDoor({ type: 'OPEN' })}>Open</button>
        <button disabled={!door.can({ type: 'CLOSE' })} onClick={() => sendDoor({ type: 'CLOSE' })}>Close</button>
      </Example>

      <Example title="Final state & state.can()" description="Wizard ends in a final state; buttons use can()." state={{ value: wizard.value, status: wizard.status }}>
        <button disabled={!wizard.can({ type: 'BACK' })} onClick={() => sendWizard({ type: 'BACK' })}>Back</button>
        <button disabled={!wizard.can({ type: 'NEXT' })} onClick={() => sendWizard({ type: 'NEXT' })}>Next</button>
      </Example>
    </>
  )
}
