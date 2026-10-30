import type { SnapshotFrom } from 'xstate'
import type { mergeMachine } from '../../machines/git.machine'

type Snapshot = SnapshotFrom<typeof mergeMachine>
type Send = (event: { type: 'MERGE_CLEAN' | 'MERGE_CONFLICT' | 'COMMIT' | 'ABORT' | 'RESET' } | { type: 'RESOLVE'; file: string }) => void

const STATES = ['clean', 'conflicted', 'merged'] as const

export function MergeDiagram({ snapshot, send }: { snapshot: Snapshot; send: Send }) {
  const state = snapshot.value as (typeof STATES)[number]
  const { conflicts, resolved } = snapshot.context
  const pending = conflicts.filter((f) => !resolved.includes(f))
  const canCommit = snapshot.can({ type: 'COMMIT' })

  return (
    <>
      <div className="merge-flow" role="group" aria-label="Stan merge">
        {STATES.map((name, i) => (
          <span key={name} style={{ display: 'contents' }}>
            {i > 0 && (
              <span className={name === 'merged' ? (canCommit ? 'merge-arrow open' : 'merge-arrow locked') : 'merge-arrow'} aria-hidden="true">
                {name === 'merged' ? (canCommit ? '🔓 ──▶' : '🔒 ╌╌▶') : '──▶'}
              </span>
            )}
            <span className={['merge-node', name, state === name && 'active'].filter(Boolean).join(' ')} aria-current={state === name ? 'step' : undefined}>
              {name}
            </span>
          </span>
        ))}
      </div>

      <p className="muted" aria-live="polite">{snapshot.machine.root.states[state]?.description}</p>

      {state === 'clean' && (
        <>
          <button onClick={() => send({ type: 'MERGE_CLEAN' })}>git merge (bez konfliktów)</button>
          <button onClick={() => send({ type: 'MERGE_CONFLICT' })}>git merge (konflikt)</button>
        </>
      )}

      {state === 'conflicted' && (
        <>
          <div className="merge-flow">
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={conflicts.length} aria-valuenow={resolved.length}>
              <div style={{ width: `${(resolved.length / conflicts.length) * 100}%` }} />
            </div>
            <span className="muted">{resolved.length} / {conflicts.length} rozwiązane</span>
          </div>
          <ul className="conflict-list">
            {conflicts.map((file) => {
              const done = resolved.includes(file)
              return (
                <li key={file} className={done ? 'conflict-item resolved' : 'conflict-item'}>
                  <span aria-hidden="true">{done ? '✓' : '⚠'}</span>
                  <code>{file}</code>
                  <button disabled={done} onClick={() => send({ type: 'RESOLVE', file })}>
                    {done ? 'rozwiązany' : 'rozwiąż + git add'}
                  </button>
                </li>
              )
            })}
          </ul>
          <button aria-disabled={!canCommit} aria-describedby="merge-reason" onClick={() => canCommit && send({ type: 'COMMIT' })}>
            {canCommit ? '🔓' : '🔒'} git commit
          </button>
          <button className="danger" onClick={() => send({ type: 'ABORT' })}>git merge --abort</button>
          <span id="merge-reason" className="merge-reason muted">
            {canCommit ? 'Wszystkie konflikty rozwiązane — można commitować.' : `Commit zablokowany. Nierozwiązane: ${pending.join(', ')}`}
          </span>
        </>
      )}

      {state === 'merged' && <button onClick={() => send({ type: 'RESET' })}>Od nowa</button>}
    </>
  )
}
