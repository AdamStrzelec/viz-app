import { createBrowserInspector } from '@statelyai/inspect'
import { assign, fromPromise, setup } from 'xstate'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'

// autoStart: false — browsers block popups not triggered by a click
const inspector = createBrowserInspector({ autoStart: false })

const checkoutMachine = setup({
  types: {
    context: {} as { items: number; address: string; orderId: string | null },
    events: {} as
      | { type: 'ADD_ITEM' }
      | { type: 'CHECKOUT' }
      | { type: 'SET_ADDRESS'; value: string }
      | { type: 'NEXT' }
      | { type: 'BACK' }
      | { type: 'RESTART' },
  },
  guards: {
    hasItems: ({ context }) => context.items > 0,
    hasAddress: ({ context }) => context.address.trim().length > 0,
  },
  actors: {
    placeOrder: fromPromise(async () => {
      await new Promise((r) => setTimeout(r, 1200))
      return `ORD-${Math.floor(Math.random() * 10000)}`
    }),
  },
}).createMachine({
  id: 'checkout',
  context: { items: 0, address: '', orderId: null },
  initial: 'cart',
  states: {
    cart: {
      on: {
        ADD_ITEM: { actions: assign({ items: ({ context }) => context.items + 1 }) },
        CHECKOUT: { guard: 'hasItems', target: 'shipping' },
      },
    },
    shipping: {
      on: {
        SET_ADDRESS: { actions: assign({ address: ({ event }) => event.value }) },
        NEXT: { guard: 'hasAddress', target: 'payment' },
        BACK: 'cart',
      },
    },
    payment: {
      invoke: {
        src: 'placeOrder',
        onDone: { target: 'confirmed', actions: assign({ orderId: ({ event }) => event.output }) },
      },
    },
    confirmed: {
      on: { RESTART: { target: 'cart', actions: assign({ items: 0, address: '', orderId: null }) } },
    },
  },
})

export default function InspectorPage() {
  const [state, send] = useMachine(checkoutMachine, { inspect: inspector.inspect })

  return (
    <>
      <Example title="Stately Inspector" description="Opens a live diagram of the checkout machine in a new window (allow popups)." state={null}>
        <button onClick={() => inspector.start()}>Open inspector</button>
        <button onClick={() => inspector.stop()}>Stop</button>
      </Example>

      <Example title="Checkout machine" description="Click through and watch the diagram update." state={{ value: state.value, ...state.context }}>
        {state.matches('cart') && (
          <>
            <button onClick={() => send({ type: 'ADD_ITEM' })}>Add item</button>
            <button disabled={!state.can({ type: 'CHECKOUT' })} onClick={() => send({ type: 'CHECKOUT' })}>Checkout</button>
          </>
        )}
        {state.matches('shipping') && (
          <>
            <input placeholder="Address" value={state.context.address} onChange={(e) => send({ type: 'SET_ADDRESS', value: e.target.value })} />
            <button onClick={() => send({ type: 'BACK' })}>Back</button>
            <button disabled={!state.can({ type: 'NEXT' })} onClick={() => send({ type: 'NEXT' })}>Pay</button>
          </>
        )}
        {state.matches('payment') && <span>Placing order…</span>}
        {state.matches('confirmed') && <button onClick={() => send({ type: 'RESTART' })}>New order</button>}
      </Example>
    </>
  )
}
