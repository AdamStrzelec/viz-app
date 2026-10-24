import { assign, setup } from 'xstate'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'

// Context updated with assign()
const counterMachine = setup({
  types: { context: {} as { count: number }, events: {} as { type: 'INC' } | { type: 'DEC' } | { type: 'RESET' } },
}).createMachine({
  context: { count: 0 },
  on: {
    INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    DEC: { actions: assign({ count: ({ context }) => context.count - 1 }) },
    RESET: { actions: assign({ count: 0 }) },
  },
})

// Guarded transitions
const atmMachine = setup({
  types: { context: {} as { balance: number }, events: {} as { type: 'WITHDRAW'; amount: number } },
  guards: {
    hasFunds: ({ context }, params: { amount: number }) => context.balance >= params.amount,
  },
}).createMachine({
  context: { balance: 100 },
  initial: 'idle',
  states: {
    idle: {
      on: {
        WITHDRAW: [
          {
            guard: { type: 'hasFunds', params: ({ event }) => ({ amount: event.amount }) },
            actions: assign({ balance: ({ context, event }) => context.balance - event.amount }),
            target: 'idle',
          },
          { target: 'rejected' },
        ],
      },
    },
    rejected: { after: { 1500: 'idle' } },
  },
})

// Eventless transitions (always) reacting to context
const tempMachine = setup({
  types: { context: {} as { temp: number }, events: {} as { type: 'UP' } | { type: 'DOWN' } },
  guards: { isHot: ({ context }) => context.temp >= 30, isCold: ({ context }) => context.temp <= 10 },
}).createMachine({
  context: { temp: 20 },
  initial: 'normal',
  on: {
    UP: { actions: assign({ temp: ({ context }) => context.temp + 5 }) },
    DOWN: { actions: assign({ temp: ({ context }) => context.temp - 5 }) },
  },
  states: {
    normal: { always: [{ guard: 'isHot', target: 'hot' }, { guard: 'isCold', target: 'cold' }] },
    hot: { always: { guard: ({ context }) => context.temp < 30, target: 'normal' } },
    cold: { always: { guard: ({ context }) => context.temp > 10, target: 'normal' } },
  },
})

// Input passed when creating the actor
const formMachine = setup({
  types: {
    input: {} as { minLength: number },
    context: {} as { value: string; minLength: number },
    events: {} as { type: 'CHANGE'; value: string } | { type: 'SUBMIT' },
  },
  guards: { isValid: ({ context }) => context.value.length >= context.minLength },
}).createMachine({
  context: ({ input }) => ({ value: '', minLength: input.minLength }),
  initial: 'editing',
  states: {
    editing: {
      on: {
        CHANGE: { actions: assign({ value: ({ event }) => event.value }) },
        SUBMIT: { guard: 'isValid', target: 'submitted' },
      },
    },
    submitted: { type: 'final' },
  },
})

export default function ContextGuardsPage() {
  const [counter, sendCounter] = useMachine(counterMachine)
  const [atm, sendAtm] = useMachine(atmMachine)
  const [temp, sendTemp] = useMachine(tempMachine)
  const [form, sendForm] = useMachine(formMachine, { input: { minLength: 3 } })

  return (
    <>
      <Example title="Context + assign" description="Extended state stored in context." state={counter.context}>
        <button onClick={() => sendCounter({ type: 'DEC' })}>−</button>
        <button onClick={() => sendCounter({ type: 'INC' })}>+</button>
        <button onClick={() => sendCounter({ type: 'RESET' })}>Reset</button>
      </Example>

      <Example title="Guards with params" description="Withdraw only when balance allows it." state={{ value: atm.value, ...atm.context }}>
        {[20, 50, 200].map((amount) => (
          <button key={amount} onClick={() => sendAtm({ type: 'WITHDRAW', amount })}>−{amount}</button>
        ))}
      </Example>

      <Example title="Eventless transitions (always)" description="State follows context automatically." state={{ value: temp.value, ...temp.context }}>
        <button onClick={() => sendTemp({ type: 'DOWN' })}>Cooler</button>
        <button onClick={() => sendTemp({ type: 'UP' })}>Warmer</button>
      </Example>

      <Example title="Actor input" description="minLength comes from input; submit is guarded." state={{ state: form.value, ...form.context }}>
        <input value={form.context.value} disabled={form.status === 'done'} onChange={(e) => sendForm({ type: 'CHANGE', value: e.target.value })} />
        <button disabled={!form.can({ type: 'SUBMIT' })} onClick={() => sendForm({ type: 'SUBMIT' })}>Submit</button>
      </Example>
    </>
  )
}
