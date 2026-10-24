import { useState } from 'react'
import { useMachine } from '@xstate/react'
import { gameMachine, startInputs, unlockedCount } from '../game/game.machine'
import { Circuit, GateShape } from '../game/Circuit'
import { BlockView } from '../game/BlockView'
import { fromBits } from '../game/blocks'
import { GATE_FN, GATE_INFO, LEVELS, answerLabels, expectedAnswer, isCircuit, runSequence, type GameLevel, type GateType } from '../game/gates'
import { Example } from '../components/Example'

const GATE_TYPES = Object.keys(GATE_FN) as GateType[]

type BoardProps = { level: GameLevel; inputs: boolean[]; memory?: Record<string, boolean>; reveal: boolean; onToggle?: (i: number) => void }

function Board({ level, inputs, memory, reveal, onToggle }: BoardProps) {
  if (!isCircuit(level)) return <BlockView spec={level.block} reveal={reveal} />
  const results = level.mode === 'sequence' ? runSequence(level) : []
  return (
    <>
      <Circuit level={level} inputs={inputs} memory={memory} reveal={reveal && level.mode !== 'sequence'} onToggle={onToggle} />
      {level.mode === 'sequence' && (
        <table className="truth steps">
          <thead>
            <tr>
              <th>krok</th>
              {level.inputs.map((n) => <th key={n}>{n}</th>)}
              <th>Q</th>
            </tr>
          </thead>
          <tbody>
            {level.steps.map((step, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {step.map((v, j) => <td key={j}>{Number(v)}</td>)}
                <td className={reveal && results[i] ? 'on' : ''}>{reveal ? Number(results[i]) : '?'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function AnswerBits({ level, answer, disabled, onToggle }: { level: GameLevel; answer: boolean[]; disabled: boolean; onToggle: (i: number) => void }) {
  const labels = answerLabels(level)
  const isNumber = level.mode === 'block' && level.block.kind !== 'adder'
  return (
    <div className="answer">
      {labels.map((label, i) => (
        <button key={label} className={answer[i] ? 'answer-bit on' : 'answer-bit'} disabled={disabled} onClick={() => onToggle(i)}>
          <small>{label}</small>
          <strong>{Number(answer[i])}</strong>
        </button>
      ))}
      {isNumber && <span className="muted">= {fromBits(answer)}₁₀</span>}
    </div>
  )
}

const QUESTION: Record<string, string> = {
  predict: 'Ustaw przewidywane wyjścia i sprawdź.',
  sequence: 'Ustaw Q po każdym kroku i sprawdź.',
  block: 'Ustaw bity wyniku i sprawdź.',
}

function TruthTable({ type }: { type: GateType }) {
  const rows = type === 'NOT' ? [[false], [true]] : [[false, false], [false, true], [true, false], [true, true]]
  return (
    <table className="truth">
      <thead>
        <tr>
          {rows[0].map((_, i) => <th key={i}>{'AB'[i]}</th>)}
          <th>Q</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => <td key={j}>{Number(v)}</td>)}
            <td className={GATE_FN[type](row) ? 'on' : ''}>{Number(GATE_FN[type](row))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function GatesGamePage() {
  const [state, send] = useMachine(gameMachine)
  // Locked level shown read-only; null = show the playable level
  const [preview, setPreview] = useState<number | null>(null)
  const { level: index, inputs, memory, answer, mistakes, wrong, stars } = state.context
  const unlocked = unlockedCount(stars)
  const previewLevel = preview !== null && preview >= unlocked ? LEVELS[preview] : null
  const level = previewLevel ?? LEVELS[index]
  const success = state.matches('success')
  const finished = state.matches('finished')
  const totalStars = stars.reduce((a, b) => a + (b ?? 0), 0)
  const usedTypes = isCircuit(level) ? [...new Set(level.gates.map((g) => g.type))] : []

  return (
    <>
      <Example wide title="Bramki logiczne — gra" description={`Poziomy od najłatwiejszych do najtrudniejszych. Gwiazdki: ${totalStars} / ${LEVELS.length * 3}`} state={null}>
        <div className="levels">
          {LEVELS.map((l, i) => (
            <button
              key={i}
              className={['level-chip', (previewLevel ? i === preview : i === index) && 'current', i >= unlocked && 'locked']
                .filter(Boolean)
                .join(' ')}
              title={i >= unlocked ? `${l.title} (podgląd)` : l.title}
              onClick={() => {
                if (i >= unlocked) return setPreview(i)
                setPreview(null)
                send({ type: 'SELECT', level: i })
              }}
            >
              <span>{i + 1}</span>
              <small>{'★'.repeat(stars[i] ?? 0) || (i >= unlocked ? '🔒' : '·')}</small>
            </button>
          ))}
        </div>
      </Example>

      {previewLevel && preview !== null ? (
        <Example wide title={`🔒 Poziom ${preview + 1}: ${previewLevel.title}`} description={previewLevel.lesson} state={null}>
          <div className="game-board locked-preview">
            <Board level={previewLevel} inputs={startInputs(previewLevel)} reveal={false} />
          </div>
          <code className="expression">{previewLevel.expression}</code>
          <span className="badge no">Podgląd — ukończ poziom {unlocked}, żeby odblokować kolejny.</span>
          <button onClick={() => setPreview(null)}>← Wróć do gry</button>
        </Example>
      ) : finished ? (
        <Example wide title="🏆 Ukończone!" description={`Zdobyte gwiazdki: ${totalStars} / ${LEVELS.length * 3}. Wybierz poziom, żeby poprawić wynik.`} state={null}>
          <button onClick={() => send({ type: 'RESET_PROGRESS' })}>Zacznij od nowa</button>
        </Example>
      ) : (
        <Example wide title={`Poziom ${index + 1}: ${level.title}`} description={level.lesson} state={null}>
          <div className="game-board">
            <Board
              level={level}
              inputs={inputs}
              memory={memory}
              reveal={level.mode === 'solve' || success}
              onToggle={level.mode === 'solve' && !success ? (i) => send({ type: 'TOGGLE', index: i }) : undefined}
            />
          </div>
          <code className="expression">{level.expression}</code>

          {level.mode === 'solve' ? (
            <>
              <span className="muted">
                Klikaj wejścia u góry. Cel:{' '}
                <strong>
                  {(Array.isArray(level.target) ? level.target : [level.target])
                    .map((t, i) => `${level.outputLabels?.[i] ?? 'Q'} = ${Number(t)}`)
                    .join(', ')}
                  {level.requireInputs && ` przy ${level.inputs.map((n, i) => `${n} = ${Number(level.requireInputs![i])}`).join(', ')}`}
                </strong>
              </span>
              {!success && <button onClick={() => send({ type: 'CHECK' })}>Sprawdź</button>}
            </>
          ) : (
            <>
              <span className="muted">{QUESTION[level.mode]}</span>
              <AnswerBits level={level} answer={success ? expectedAnswer(level) : answer} disabled={success} onToggle={(i) => send({ type: 'TOGGLE_ANSWER', index: i })} />
              {!success && <button onClick={() => send({ type: 'CHECK' })}>Sprawdź</button>}
            </>
          )}

          {level.mode === 'solve' && level.outputs?.includes('qn') && inputs[0] && inputs[1] && (
            <span className="badge no">⚠️ S = R = 1 to stan zakazany — Q i Q̄ przestają być swoimi negacjami.</span>
          )}
          {wrong && <span className="badge no">Jeszcze nie — spróbuj ponownie (błędy: {mistakes})</span>}
          {success && (
            <>
              <span className="badge ok">Brawo! {'★'.repeat(mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1)}</span>
              <button onClick={() => send({ type: 'NEXT' })}>{index === LEVELS.length - 1 ? 'Zakończ' : 'Następny poziom →'}</button>
            </>
          )}
        </Example>
      )}

      {GATE_TYPES.filter((t) => usedTypes.includes(t) || finished).map((type) => (
        <Example key={type} title={type} description={GATE_INFO[type]} state={null}>
          <svg viewBox="-10 -4 90 48" className="gate-icon">
            <g className="gate">
              <GateShape type={type} />
            </g>
          </svg>
          <TruthTable type={type} />
        </Example>
      ))}
    </>
  )
}
