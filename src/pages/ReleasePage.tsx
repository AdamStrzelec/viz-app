import { useMemo, useState } from 'react'
import { createBrowserInspector } from '@statelyai/inspect'
import { type AnyStateNode, type StateValue } from 'xstate'
import { useActorRef, useSelector } from '@xstate/react'
import { releaseMachine, type ReleaseContext, type ReleaseEvent } from '../machines/release.machine'
import { Example } from '../components/Example'

const inspector = createBrowserInspector({ autoStart: false })

const randomHex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('')

// Flatten a state value like { production: 'migrate' } into ['production', 'production.migrate']
function activePaths(value: StateValue, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix + value]
  return Object.entries(value).flatMap(([key, child]) => [prefix + key, ...(child ? activePaths(child, `${prefix}${key}.`) : [])])
}

// Events declared on the active nodes (leaf + ancestors)
function availableEvents(paths: string[]): string[] {
  const events = new Set<string>()
  for (const path of paths) {
    const node = releaseMachine.getStateNodeById(`pulsoRelease.${path}`)
    Object.keys(node.config.on ?? {}).forEach((e) => events.add(e))
  }
  return [...events]
}

// Payload that satisfies the guard ("happy path") for a given event
function happyPayload(type: string, context: ReleaseContext, leaf: string): ReleaseEvent {
  const sha = context.sha ?? undefined
  switch (type) {
    case 'SELECT_CANDIDATE':
      return { type, sha: randomHex(40), requestId: `run-${Math.floor(Math.random() * 9000) + 1000}` }
    case 'STEP_OK':
      return { type, sha, deploymentId: `dpl_${randomHex(8)}`, recoveryVerified: true }
    case 'STEP_FAILED':
      return { type, sha, error: 'Timeout podczas operacji', step: leaf }
    case 'ACCEPT_STAGING':
      return { type, sha, confirmed: true, deploymentId: `dpl_${randomHex(8)}` }
    case 'APPROVE_PRODUCTION':
      return { type, sha, confirmSha: sha, stagingDeploymentId: context.stagingDeploymentId ?? undefined, confirmed: true }
    case 'CONFIRM_RELEASED':
      return {
        type,
        sha,
        activeDeploymentId: context.productionDeploymentId ?? undefined,
        domainsVerified: true,
        smokePassed: true,
        releaseRecorded: true,
        tagVerified: true,
      }
    case 'CONFIRM_NOT_PUBLISHED':
      return { type, sha, verified: true }
    case 'APPROVE_ROLLBACK':
      return { type, sha, confirmed: true, rollbackDeploymentId: `dpl_${randomHex(8)}` }
    default:
      return { type, sha }
  }
}

function StateTree({ node, active }: { node: AnyStateNode; active: Set<string> }) {
  const children = Object.values(node.states) as AnyStateNode[]
  return (
    <ol className="release-tree">
      {children.map((child) => {
        const path = child.path.join('.')
        const failed = /Failed|Rejected|reconciliation/.test(child.key)
        const className = ['release-node', active.has(path) && 'active', failed && 'danger', child.type === 'final' && 'final']
          .filter(Boolean)
          .join(' ')
        return (
          <li key={path}>
            <div className={className}>
              <strong>{child.key}</strong>
              {child.description && <span>{child.description}</span>}
            </div>
            {Object.keys(child.states).length > 0 && <StateTree node={child} active={active} />}
          </li>
        )
      })}
    </ol>
  )
}

function ReleaseSimulator({ onRestart }: { onRestart: () => void }) {
  const ref = useActorRef(releaseMachine, { inspect: inspector.inspect })
  const snapshot = useSelector(ref, (s) => s)
  const [history, setHistory] = useState<{ event: string; from: string; to: string; accepted: boolean }[]>([])
  const [editor, setEditor] = useState({ key: '', selected: '', payload: '' })

  const paths = useMemo(() => activePaths(snapshot.value), [snapshot.value])
  const active = useMemo(() => new Set(paths), [paths])
  const events = useMemo(() => (snapshot.status === 'done' ? [] : availableEvents(paths)), [paths, snapshot.status])
  const leaf = paths[paths.length - 1]

  // Reset the payload editor after every sent event (adjusting state during render)
  const editorKey = `${leaf}:${history.length}`
  if (editor.key !== editorKey) {
    const first = events[0] ?? ''
    setEditor({ key: editorKey, selected: first, payload: first ? JSON.stringify(happyPayload(first, snapshot.context, leaf), null, 2) : '' })
  }
  const { selected, payload } = editor
  const setPayload = (value: string) => setEditor((e) => ({ ...e, payload: value }))

  let parsed: ReleaseEvent | null = null
  try {
    parsed = payload ? (JSON.parse(payload) as ReleaseEvent) : null
  } catch {
    parsed = null
  }
  const allowed = parsed ? snapshot.can(parsed) : false

  function send(event: ReleaseEvent) {
    const from = leaf
    const accepted = snapshot.can(event)
    ref.send(event)
    const to = activePaths(ref.getSnapshot().value).at(-1) ?? ''
    setHistory((h) => [{ event: event.type, from, to, accepted }, ...h].slice(0, 30))
  }

  function choose(type: string) {
    setEditor((e) => ({ ...e, selected: type, payload: JSON.stringify(happyPayload(type, snapshot.context, leaf), null, 2) }))
  }

  return (
    <>
      <Example
        wide
        title="Pulso release — model procesu"
        description="Symulacja modelu XState z PR. Nic nie jest wykonywane naprawdę — zdarzenia udają wyniki adaptera/CI."
        state={null}
      >
        <button onClick={() => inspector.start()}>Open inspector</button>
        <button onClick={onRestart}>Nowa instancja</button>
        <span className="muted">
          Stan: <strong>{leaf}</strong> {snapshot.status === 'done' && '(final)'}
        </span>
        <StateTree node={releaseMachine.root} active={active} />
      </Example>

      <Example title="Wyślij zdarzenie" description="Payload wypełniony tak, by przeszedł guard. Zmień go, żeby zobaczyć odrzucenie." state={null}>
        {events.length === 0 && <span className="muted">Stan końcowy — utwórz nową instancję.</span>}
        <div className="event-picker">
          {events.map((type) => (
            <button key={type} className={type === selected ? 'chip selected' : 'chip'} onClick={() => choose(type)}>
              {type}
            </button>
          ))}
        </div>
        {selected && (
          <>
            <textarea className="payload" value={payload} spellCheck={false} onChange={(e) => setPayload(e.target.value)} rows={9} />
            <button disabled={!parsed} onClick={() => parsed && send(parsed)}>Wyślij {selected}</button>
            <span className={allowed ? 'badge ok' : 'badge no'}>{parsed ? (allowed ? 'guard: przejdzie' : 'guard: odrzuci') : 'niepoprawny JSON'}</span>
          </>
        )}
        <div className="quick">
          {events.includes('STEP_OK') && (
            <button onClick={() => send(happyPayload('STEP_OK', snapshot.context, leaf))}>✓ STEP_OK</button>
          )}
          {events.includes('STEP_FAILED') && (
            <button className="danger" onClick={() => send(happyPayload('STEP_FAILED', snapshot.context, leaf))}>✗ STEP_FAILED</button>
          )}
        </div>
      </Example>

      <Example title="Context" description="Dane instancji release'u." state={snapshot.context}>
        {snapshot.context.lastError && (
          <span className="badge no">
            {snapshot.context.failureAt}: {snapshot.context.lastError}
          </span>
        )}
      </Example>

      <Example title="Historia zdarzeń" description="Odrzucone zdarzenia nie zmieniają stanu." state={null}>
        <ol className="history">
          {history.map((h, i) => (
            <li key={i} className={h.accepted ? '' : 'rejected'}>
              <code>{h.event}</code> {h.from} → {h.to} {!h.accepted && '(odrzucone)'}
            </li>
          ))}
        </ol>
      </Example>
    </>
  )
}

export default function ReleasePage() {
  const [instance, setInstance] = useState(0)
  return <ReleaseSimulator key={instance} onRestart={() => setInstance((n) => n + 1)} />
}
