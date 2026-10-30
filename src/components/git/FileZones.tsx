import type { SnapshotFrom } from 'xstate'
import { fileCommands, type fileMachine } from '../../machines/git.machine'

type Snapshot = SnapshotFrom<typeof fileMachine>
type FileEvent = 'STAGE' | 'UNSTAGE' | 'COMMIT' | 'EDIT' | 'RESTORE' | 'RM_CACHED'

const ZONES = [
  { key: 'wt', title: 'Working tree', hint: 'pliki na dysku' },
  { key: 'index', title: 'Index', hint: 'staging area' },
  { key: 'repo', title: 'Repository', hint: 'historia commitów' },
] as const

// Zone index and badge of the main tile per machine state
const TILE: Record<string, { zone: number; badge: string; className: string }> = {
  untracked: { zone: 0, badge: '?', className: 'untracked' },
  unmodified: { zone: 2, badge: '✓', className: 'clean' },
  modified: { zone: 0, badge: 'M', className: 'dirty' },
  staged: { zone: 1, badge: 'A', className: 'staged' },
  stagedAndModified: { zone: 1, badge: 'A', className: 'staged' },
}

const BETWEEN: FileEvent[] = ['STAGE', 'UNSTAGE', 'COMMIT']
const WITHIN: FileEvent[] = ['EDIT', 'RESTORE', 'RM_CACHED']

const BLOCKED_REASON: Record<FileEvent, string> = {
  STAGE: 'plik musi być untracked albo zmodyfikowany',
  UNSTAGE: 'w Index nie ma tego pliku',
  COMMIT: 'w Index nie ma zmian do commita',
  EDIT: 'plik nie jest śledzony',
  RESTORE: 'w working tree nie ma zmian do porzucenia',
  RM_CACHED: 'plik nie jest śledzony i czysty',
}

export function FileZones({ snapshot, send }: { snapshot: Snapshot; send: (event: { type: FileEvent }) => void }) {
  const state = snapshot.value as string
  const tile = TILE[state]
  const names = Object.keys(snapshot.machine.root.states)

  const command = (type: FileEvent) => {
    const allowed = snapshot.can({ type })
    return (
      <button
        key={type}
        className={allowed ? 'file-cmd' : 'file-cmd blocked'}
        aria-disabled={!allowed}
        title={allowed ? fileCommands[type].hint : `Niedostępne: ${BLOCKED_REASON[type]}`}
        onClick={() => allowed && send({ type })}
      >
        {fileCommands[type].cmd}
      </button>
    )
  }

  return (
    <>
      <div className="file-zones" role="group" aria-label="Strefy Git">
        {ZONES.map((zone) => (
          <div key={zone.key} className={`file-zone ${zone.key}`}>
            <strong>{zone.title}</strong>
            <span className="muted">{zone.hint}</span>
          </div>
        ))}
        {state === 'stagedAndModified' && (
          <div className="file-tile dirty ghost" style={{ left: 'calc(0 * 100% / 3 + 8px)' }}>
            <code>app.ts</code> <span className="file-badge">M</span>
          </div>
        )}
        <div className={`file-tile ${tile.className}`} style={{ left: `calc(${tile.zone} * 100% / 3 + 8px)` }}>
          <code>app.ts</code> <span className="file-badge">{tile.badge}</span>
        </div>
      </div>

      <div className="file-states" aria-hidden="true">
        {names.map((name) => (
          <span key={name} className={name === state ? 'merge-node active' : 'merge-node'}>{name}</span>
        ))}
      </div>
      <p className="muted" aria-live="polite">
        {snapshot.machine.root.states[state]?.description}
      </p>

      <div className="file-cmds">
        <span className="muted">Między strefami:</span>
        {BETWEEN.map(command)}
      </div>
      <div className="file-cmds">
        <span className="muted">W strefie:</span>
        {WITHIN.map(command)}
      </div>
    </>
  )
}
