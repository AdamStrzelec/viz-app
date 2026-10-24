import { ALU_OPS, bitString, formatInstruction, fromBits, rippleAdd, runAlu, runCounter, runCpu, toBits, type BlockSpec } from './blocks'

const Bit = ({ on, hidden }: { on?: boolean; hidden?: boolean }) => (
  <span className={hidden ? 'bit unknown' : on ? 'bit on' : 'bit'}>{hidden ? '?' : Number(on)}</span>
)

const Bits = ({ value, hidden }: { value: string; hidden?: boolean }) => (
  <span className="bits">
    {[...value].map((c, i) => (
      <Bit key={i} on={c === '1'} hidden={hidden} />
    ))}
  </span>
)

function AdderView({ a, b, reveal }: { a: string; b: string; reveal: boolean }) {
  const { stages, carry } = rippleAdd(a, b)
  // Draw MSB on the left, like written addition; carry ripples right → left
  const columns = [...stages].reverse()
  return (
    <div className="adder">
      <div className="adder-cout">
        <small>Cout</small>
        <Bit on={carry} hidden={!reveal} />
      </div>
      {columns.map((stage, i) => {
        const bit = columns.length - 1 - i
        return (
          <div key={bit} className="fa" style={{ animationDelay: `${(3 - i) * 0.5}s` }}>
            <div className="fa-inputs">
              <span>A{bit} <Bit on={stage.a} /></span>
              <span>B{bit} <Bit on={stage.b} /></span>
            </div>
            <div className={reveal ? 'fa-box revealed' : 'fa-box'} style={{ animationDelay: `${(3 - i) * 0.5}s` }}>
              FA{bit}
            </div>
            <div className="fa-carry">
              <span>← C {reveal ? Number(stage.cout) : '?'}</span>
              <span className="muted">Cin {bit === 0 ? 0 : reveal ? Number(stage.cin) : '?'}</span>
            </div>
            <div className="fa-sum">
              S{bit} <Bit on={stage.sum} hidden={!reveal} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CounterView({ start, enable, reveal }: { start: string; enable: boolean[]; reveal: boolean }) {
  const trace = runCounter({ kind: 'counter', start, enable })
  return (
    <div className="counter">
      <div className="register">
        <small>start</small>
        <Bits value={start} />
        <small>= {fromBits([...start].map((c) => c === '1'))}</small>
      </div>
      <div className="ticks">
        {enable.map((en, i) => (
          <div key={i} className={en ? 'tick' : 'tick disabled'}>
            <strong>TICK {i + 1}</strong>
            <span>EN = {Number(en)}</span>
            {reveal && <code>{bitString(toBits(trace[i + 1]))}</code>}
          </div>
        ))}
      </div>
    </div>
  )
}

function AluView({ a, b, op, reveal }: { a: string; b: string; op: string; reveal: boolean }) {
  const A = fromBits([...a].map((c) => c === '1'))
  const B = fromBits([...b].map((c) => c === '1'))
  return (
    <div className="alu">
      <div className="alu-inputs">
        <span>A <Bits value={a} /></span>
        <span>B <Bits value={b} /></span>
      </div>
      <div className="alu-units">
        {Object.entries(ALU_OPS).sort(([a], [b]) => a.localeCompare(b)).map(([code, { label, fn }]) => (
          <div key={code} className={reveal && code === op ? 'alu-unit selected' : 'alu-unit'}>
            <small>{code}</small>
            <strong>{label}</strong>
            <code>{reveal ? bitString(toBits(fn(A, B))) : '????'}</code>
          </div>
        ))}
      </div>
      <div className="alu-mux">
        MUX ← OP = <Bits value={op} />
      </div>
      <div className="alu-out">
        Wynik <Bits value={bitString(toBits(runAlu({ kind: 'alu', a, b, op })))} hidden={!reveal} />
      </div>
    </div>
  )
}

function CpuView({ spec, reveal }: { spec: Extract<BlockSpec, { kind: 'cpu' }>; reveal: boolean }) {
  const { trace } = runCpu(spec)
  return (
    <div className="cpu">
      <ol className="program">
        {spec.program.map((ins, i) => (
          <li key={i}>
            <code>{formatInstruction(ins)}</code>
          </li>
        ))}
      </ol>
      <div className="cpu-parts">
        <div className="cpu-part">Rejestr A <code>{reveal ? bitString(toBits(trace[trace.length - 1].A)) : '????'}</code></div>
        <div className="cpu-part">Rejestr B <code>{reveal ? bitString(toBits(trace[trace.length - 1].B)) : '????'}</code></div>
        <div className="cpu-part">ALU (4-bit, mod 16)</div>
      </div>
      {reveal && (
        <table className="truth">
          <thead>
            <tr>
              <th>#</th>
              <th>instrukcja</th>
              <th>A</th>
              <th>B</th>
              <th>OUT</th>
            </tr>
          </thead>
          <tbody>
            {trace.map((row, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{formatInstruction(row.ins)}</td>
                <td>{row.A}</td>
                <td>{row.B}</td>
                <td className={row.ins.op === 'OUT' ? 'on' : ''}>{row.ins.op === 'OUT' ? row.out : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function BlockView({ spec, reveal }: { spec: BlockSpec; reveal: boolean }) {
  switch (spec.kind) {
    case 'adder':
      return <AdderView a={spec.a} b={spec.b} reveal={reveal} />
    case 'counter':
      return <CounterView start={spec.start} enable={spec.enable} reveal={reveal} />
    case 'alu':
      return <AluView a={spec.a} b={spec.b} op={spec.op} reveal={reveal} />
    case 'cpu':
      return <CpuView spec={spec} reveal={reveal} />
  }
}
