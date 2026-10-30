import { useState } from 'react'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'
import { BranchGraph } from '../components/git/BranchGraph'
import { FileZones } from '../components/git/FileZones'
import { MergeDiagram } from '../components/git/MergeDiagram'
import {
  ancestors,
  branchesMachine,
  fileMachine,
  headCommitId,
  mergeKind,
  rebaseKind,
  type BranchesEvent,
  type MergeKind,
  type RebaseKind,
  mergeMachine,
} from '../machines/git.machine'

function FileLifecycle() {
  const [snapshot, send] = useMachine(fileMachine)
  return (
    <Example
      title="Cykl życia pliku"
      description="Plik wędruje między working tree, index i repository. Niedostępne komendy są wyszarzone (snapshot.can)."
      state={{ value: snapshot.value }}
    >
      <FileZones snapshot={snapshot} send={send} />
    </Example>
  )
}

function MergeConflict() {
  const [snapshot, send] = useMachine(mergeMachine)
  return (
    <Example
      title="Merge z konfliktem"
      description="COMMIT jest zablokowany guardem, dopóki każdy plik z konfliktem nie zostanie rozwiązany."
      state={{ value: snapshot.value, context: snapshot.context }}
    >
      <MergeDiagram snapshot={snapshot} send={send} />
    </Example>
  )
}

const MERGE_PREVIEW: Record<MergeKind, { badge: string; reason: string; result: string }> = {
  'fast-forward': { badge: 'FF', reason: '', result: 'fast-forward: tylko przesunięto wskaźnik brancha, bez nowego commita.' },
  'merge-commit': { badge: 'merge commit', reason: '', result: 'merge commit: nowy commit z 2 rodzicami.' },
  'up-to-date': { badge: 'up to date', reason: 'Already up to date — cel jest już w historii HEAD.', result: '' },
  detached: { badge: 'detached', reason: 'Nie można zmergować w detached HEAD.', result: '' },
  unknown: { badge: '?', reason: 'Nieznany branch.', result: '' },
}

const REBASE_PREVIEW: Record<RebaseKind, { badge: string; reason: string; result: string }> = {
  'fast-forward': { badge: 'FF', reason: '', result: 'rebase = fast-forward: cel zawiera całą historię HEAD, więc branch tylko przesunięto.' },
  rebase: { badge: 'replay', reason: '', result: 'rebase: commity tylko z tego brancha skopiowano na czubek celu (nowe id, nowi rodzice). Oryginały zostały w grafie, ale są nieosiągalne.' },
  'up-to-date': { badge: 'up to date', reason: 'Current branch is up to date — cel jest już w historii HEAD.', result: '' },
  detached: { badge: 'detached', reason: 'Nie można zrobić rebase w detached HEAD.', result: '' },
  unknown: { badge: '?', reason: 'Nieznany branch.', result: '' },
}

function Branches({ onReset }: { onReset: () => void }) {
  const [snapshot, machineSend] = useMachine(branchesMachine)
  const [note, setNote] = useState('')
  const send = (event: BranchesEvent) => {
    setNote(
      event.type === 'MERGE'
        ? MERGE_PREVIEW[mergeKind(snapshot.context, event.name)].result
        : event.type === 'REBASE'
          ? REBASE_PREVIEW[rebaseKind(snapshot.context, event.name)].result
          : '',
    )
    machineSend(event)
  }
  const { commits, branches, head } = snapshot.context
  const headId = headCommitId(snapshot.context)
  const reachable = ancestors(commits, headId)
  const names = Object.keys(branches)
  const labels = (id: string) => [
    ...names.filter((n) => branches[n] === id).map((n) => (head.kind === 'branch' && head.name === n ? `HEAD → ${n}` : n)),
    ...(head.kind === 'detached' && head.id === id ? ['HEAD (detached)'] : []),
  ]
  return (
    <Example
      wide
      actions={
        <div className="git-history" role="group" aria-label="Historia kroków">
          <button disabled={!snapshot.can({ type: 'UNDO' })} onClick={() => send({ type: 'UNDO' })}>↶ Cofnij</button>
          <button disabled={!snapshot.can({ type: 'REDO' })} onClick={() => send({ type: 'REDO' })}>↷ Ponów</button>
          <span className="git-steps">Krok {snapshot.context.past.length} z {snapshot.context.past.length + snapshot.context.future.length}</span>
        </div>
      }
      title="Branche, HEAD, merge i rebase"
      description="Merge to fast-forward, jeśli HEAD jest przodkiem celu; inaczej powstaje merge commit z dwoma rodzicami. Checkout commita daje detached HEAD."
      state={{ value: snapshot.value, head, branches }}
    >
      <BranchGraph context={snapshot.context} onCheckout={(target) => send({ type: 'CHECKOUT', target })} />
      <div className="git-actions">
        <button onClick={() => send({ type: 'COMMIT' })}>git commit</button>
        <span className="muted">
          Tworzy commit <code>c{commits.length + 1}</code> na bieżącym HEAD (<code>{headId}</code>).{' '}
          {head.kind === 'branch' ? <>Branch <code>{head.name}</code> przesuwa się na nowy commit.</> : 'W detached HEAD przesuwa się tylko HEAD — żaden branch nie podąża za commitem.'}
        </span>

        <button onClick={() => send({ type: 'BRANCH', name: `feature-${names.length}` })}>git branch feature-{names.length}</button>
        <span className="muted">
          Tworzy tylko nowy wskaźnik <code>feature-{names.length}</code> na commicie <code>{headId}</code>. HEAD zostaje tam, gdzie był.
        </span>

        {/* git switch -c = create the branch, then check it out (two events on the same machine) */}
        <button
          onClick={() => {
            const name = `feature-${names.length}`
            send({ type: 'BRANCH', name })
            send({ type: 'CHECKOUT', target: name })
          }}
        >
          git switch -c feature-{names.length}
        </button>
        <span className="muted">
          Robi to samo co <code>git branch</code>, a potem od razu przełącza HEAD na <code>feature-{names.length}</code> (branch + checkout w jednym kroku).
        </span>
      </div>
      <div className="git-group" role="group" aria-label="Przełączanie branchy">
        <strong>Przełącz branch</strong>
        <span className="muted">
          <code>git checkout &lt;branch&gt;</code> / <code>git switch &lt;branch&gt;</code> — przenosi HEAD na wskazany branch. Żeby wejść w detached HEAD, kliknij commit na grafie.
        </span>
        <div className="event-picker">
          <strong className="picker-label">checkout:</strong>
          {names.map((n) => {
            const active = head.kind === 'branch' && head.name === n
            return (
              <button
                key={`co-${n}`}
                className={active ? 'chip active' : 'chip'}
                aria-current={active ? 'true' : undefined}
                onClick={() => send({ type: 'CHECKOUT', target: n })}
              >
                {n}
              </button>
            )
          })}
        </div>
      </div>
      <div className="git-group" role="group" aria-label="Merge">
        <strong>Zmerguj do bieżącego brancha</strong>
        <span className="muted">
          <code>git merge &lt;branch&gt;</code> — wciąga wskazany branch do tego, na którym stoi HEAD. W nawiasie widać, co się stanie: fast-forward albo merge commit.
        </span>
        <div className="event-picker">
          {names.map((n) => {
            const preview = MERGE_PREVIEW[mergeKind(snapshot.context, n)]
            return (
              <button
                key={`mg-${n}`}
                className="chip"
                disabled={!snapshot.can({ type: 'MERGE', name: n })}
                title={preview.reason || `git merge ${n}: ${preview.badge}`}
                onClick={() => send({ type: 'MERGE', name: n })}
              >
                merge {n} <span className="merge-preview">({preview.badge})</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="git-group" role="group" aria-label="Rebase">
        <strong>Przepisz bieżący branch na inny (rebase)</strong>
        <span className="muted">
          <code>git rebase &lt;branch&gt;</code> — kopiuje commity, które są tylko na bieżącym branchu, na czubek wskazanego. Historia zostaje liniowa, bez merge commita; skopiowane commity dostają nowe id, a stare stają się nieosiągalne (wyszarzone).
        </span>
        <div className="event-picker">
          {names.map((n) => {
            const preview = REBASE_PREVIEW[rebaseKind(snapshot.context, n)]
            return (
              <button
                key={`rb-${n}`}
                className="chip"
                disabled={!snapshot.can({ type: 'REBASE', name: n })}
                title={preview.reason || `git rebase ${n}: ${preview.badge}`}
                onClick={() => send({ type: 'REBASE', name: n })}
              >
                rebase {n} <span className="merge-preview">({preview.badge})</span>
              </button>
            )
          })}
        </div>
      </div>
      <p className="muted" aria-live="polite">{note}</p>
      <details className="git-log">
        <summary>Lista commitów (alternatywa tekstowa dla grafu)</summary>
      <ol className="history">
        {[...commits].reverse().map((c) => (
          <li key={c.id} className={reachable.has(c.id) ? '' : 'rejected'}>
            <code>{c.id}</code> {c.message}
            {c.parents.length > 0 && ` ← ${c.parents.join(' + ')}`}{' '}
            <button className="chip" onClick={() => send({ type: 'CHECKOUT', target: c.id })}>checkout {c.id}</button>{' '}
            {labels(c.id).map((l) => (
              <span key={l} className="badge ok">{l}</span>
            ))}
          </li>
        ))}
      </ol>
      </details>
      <button className="danger" onClick={onReset}>Reset repozytorium</button>
      <span className="muted">Wyszarzone commity nie są osiągalne z HEAD.</span>
    </Example>
  )
}

export default function GitWorkflowPage() {
  // Remounting Branches with a new key resets its machine (the graph grows without bound otherwise)
  const [repo, setRepo] = useState(0)
  return (
    <>
      <FileLifecycle />
      <MergeConflict />
      <Branches key={repo} onReset={() => setRepo((n) => n + 1)} />
    </>
  )
}
