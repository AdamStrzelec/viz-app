import { useState } from 'react'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'
import { BranchGraph } from '../components/git/BranchGraph'
import { FileZones } from '../components/git/FileZones'
import { HistoryControls } from '../components/git/HistoryControls'
import { MergeDiagram } from '../components/git/MergeDiagram'
import {
  allCommits,
  ancestors,
  BASE,
  branchesMachine,
  canMergePr,
  fetchNeeded,
  fileMachine,
  headCommitId,
  mergeKind,
  PEOPLE,
  prKind,
  pullKind,
  pushKind,
  rebaseKind,
  remoteOnlyIds,
  type BranchesContext,
  type BranchesEvent,
  type MergeKind,
  type PrKind,
  type PullKind,
  type PushKind,
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

const PUSH_PREVIEW: Record<PushKind, { badge: string; result: string }> = {
  new: { badge: 'nowy branch', result: 'push: na origin powstał nowy branch, wysłano brakujące commity.' },
  'fast-forward': { badge: 'FF', result: 'push (fast-forward): origin przesunął wskaźnik brancha na twój commit.' },
  'up-to-date': { badge: 'up to date', result: '' },
  rejected: { badge: 'odrzucony — najpierw pull', result: '' },
}

const PULL_PREVIEW: Record<PullKind, { badge: string; result: string }> = {
  'fast-forward': { badge: 'FF', result: 'pull = fetch + fast-forward: lokalny branch dogonił origin, bez nowego commita.' },
  'merge-commit': { badge: 'merge commit', result: 'pull = fetch + merge: historia się rozeszła, więc powstał lokalny merge commit.' },
  'up-to-date': { badge: 'up to date', result: '' },
  'no-remote': { badge: 'brak na origin', result: '' },
  detached: { badge: 'detached', result: '' },
}

const PR_BADGE: Record<PrKind, string> = { ok: 'nowy PR', exists: 'już otwarty', 'no-changes': 'brak zmian', base: 'to bazowy branch' }

function describe(context: BranchesContext, event: BranchesEvent): string {
  switch (event.type) {
    case 'MERGE': return MERGE_PREVIEW[mergeKind(context, event.name)].result
    case 'REBASE': return REBASE_PREVIEW[rebaseKind(context, event.name)].result
    case 'PUSH': return PUSH_PREVIEW[pushKind(context, event.name)].result
    case 'PULL': return PULL_PREVIEW[pullKind(context)].result
    case 'FETCH': return 'fetch: pobrano nowe commity z origin i odświeżono wskaźniki origin/*. Lokalne branche nie ruszyły.'
    case 'SWITCH_PERSON': return `Widzisz teraz lokalne repo: ${event.id}. Zdalne origin i Pull Requesty są wspólne dla wszystkich.`
    case 'OPEN_PR': return `PR otwarty: ${event.from} → ${BASE}. Graf się nie zmienia, dopóki PR nie zostanie zmergowany.`
    case 'MERGE_PR': return `PR zmergowany na origin/${BASE} merge commitem. Twój lokalny ${BASE} jest teraz do tyłu — git fetch / git pull.`
    case 'CLOSE_PR': return 'PR zamknięty bez mergowania — zdalny main bez zmian.'
    default: return ''
  }
}

function Branches({ onReset }: { onReset: () => void }) {
  const [snapshot, machineSend] = useMachine(branchesMachine)
  const [note, setNote] = useState('')
  const send = (event: BranchesEvent) => {
    setNote(describe(snapshot.context, event))
    machineSend(event)
  }
  const { commits, branches, head, remote, tracking, prs, person } = snapshot.context
  const everything = allCommits(snapshot.context)
  const ghost = remoteOnlyIds(snapshot.context)
  // Server tips that the local origin/* pointers do not show yet (needs a fetch)
  const remoteAhead = Object.fromEntries(Object.entries(remote.branches).filter(([name, id]) => tracking[name] !== id))
  const remoteNames = Object.keys(remote.branches)
  const pull = PULL_PREVIEW[pullKind(snapshot.context)]
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
        <HistoryControls
          past={snapshot.context.past.length}
          future={snapshot.context.future.length}
          onUndo={() => send({ type: 'UNDO' })}
          onRedo={() => send({ type: 'REDO' })}
        />
      }
      title="Branche, HEAD, merge, rebase i zdalne repo"
      description="Merge to fast-forward, jeśli HEAD jest przodkiem celu; inaczej powstaje merge commit z dwoma rodzicami. Checkout commita daje detached HEAD. Na tym samym grafie jest też zdalne repo (origin): push, fetch, pull i Pull Requesty."
      state={{ person, value: snapshot.value, head, branches, tracking, origin: remote.branches, prs }}
    >
      <div className="git-group" role="group" aria-label="Lokalne repozytoria">
        <div className="event-picker">
          <strong className="picker-label">Lokalne repo:</strong>
          {PEOPLE.map((p) => (
            <button key={p} className={p === person ? 'chip active' : 'chip'} aria-current={p === person ? 'true' : undefined} onClick={() => send({ type: 'SWITCH_PERSON', id: p })}>
              {p}
            </button>
          ))}
        </div>
        <span className="muted">
          Każda osoba ma własny klon (commity, branche, HEAD, <code>origin/*</code>). Origin i Pull Requesty są wspólne — to one łączą ludzi.
        </span>
      </div>
      <BranchGraph
        commits={everything}
        branches={branches}
        head={head}
        remoteRefs={tracking}
        remoteAhead={remoteAhead}
        ghost={ghost}
        onCheckout={(target) => send({ type: 'CHECKOUT', target })}
      />
      <p className="muted">
        Przerywany znacznik <code>origin/&lt;branch&gt;</code> to to, co lokalne repo wie o zdalnym. Puste, przerywane kółko to commit, który jest tylko na origin (np. wypchnięty przez drugą osobę) — pobierzesz go przez fetch lub pull.
      </p>
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
      <div className="git-group" role="group" aria-label="Zdalne repo">
        <strong>Zdalne repo (origin)</strong>
        <span className="muted">
          <code>git fetch</code> tylko pobiera. <code>git pull</code> to fetch + merge origin/&lt;bieżący branch&gt;. <code>git push</code> wysyła branch — origin odrzuci go, jeśli ma commity, których u ciebie brak (np. od drugiej osoby).
        </span>
        <div className="event-picker">
          <button className="chip" disabled={!snapshot.can({ type: 'FETCH' })} title={fetchNeeded(snapshot.context) ? 'git fetch' : 'Nic nowego na origin'} onClick={() => send({ type: 'FETCH' })}>
            git fetch
          </button>
          <button className="chip" disabled={!snapshot.can({ type: 'PULL' })} onClick={() => send({ type: 'PULL' })}>
            git pull <span className="merge-preview">({pull.badge})</span>
          </button>
          {names.map((n) => (
            <button key={`push-${n}`} className="chip" disabled={!snapshot.can({ type: 'PUSH', name: n })} onClick={() => send({ type: 'PUSH', name: n })}>
              git push origin {n} <span className="merge-preview">({PUSH_PREVIEW[pushKind(snapshot.context, n)].badge})</span>
            </button>
          ))}
        </div>
      </div>
      <div className="git-group" role="group" aria-label="Pull Requesty">
        <strong>Pull Requesty (na origin)</strong>
        <span className="muted">
          PR proponuje scalenie brancha z <code>{BASE}</code>. Merge odbywa się na zdalnym repo (merge commit), a lokalny <code>{BASE}</code> dogonisz przez <code>git pull</code>. Najpierw wypchnij branch.
        </span>
        <div className="event-picker">
          {remoteNames.filter((n) => n !== BASE).map((n) => (
            <button key={`pr-${n}`} className="chip" disabled={!snapshot.can({ type: 'OPEN_PR', from: n })} onClick={() => send({ type: 'OPEN_PR', from: n })}>
              Otwórz PR: {n} → {BASE} <span className="merge-preview">({PR_BADGE[prKind(snapshot.context, n)]})</span>
            </button>
          ))}
        </div>
        {prs.length === 0 ? (
          <span className="muted">Brak pull requestów. Wypchnij branch (push), a potem otwórz PR.</span>
        ) : (
          <ul className="pr-list">
            {prs.map((pr) => (
              <li key={pr.id} className="pr-item">
                <strong>#{pr.id}</strong> <code>{pr.from}</code> → <code>{BASE}</code>{' '}
                <span className={pr.status === 'merged' ? 'badge ok' : pr.status === 'closed' ? 'badge no' : 'badge'}>{pr.status}</span>
                {pr.status === 'open' && (
                  <>
                    <button className="chip" disabled={!canMergePr(snapshot.context, pr.id)} onClick={() => send({ type: 'MERGE_PR', id: pr.id })}>
                      Merge PR #{pr.id}
                    </button>
                    <button className="chip" onClick={() => send({ type: 'CLOSE_PR', id: pr.id })}>Zamknij</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted" aria-live="polite">{note}</p>
      <details className="git-log">
        <summary>Lista commitów (alternatywa tekstowa dla grafu)</summary>
      <ol className="history">
        {[...everything].reverse().map((c) => (
          <li key={c.id} className={reachable.has(c.id) || ghost.has(c.id) ? '' : 'rejected'}>
            <code>{c.id}</code> {c.message}
            {c.parents.length > 0 && ` ← ${c.parents.join(' + ')}`}{' '}
            <button className="chip" disabled={ghost.has(c.id)} onClick={() => send({ type: 'CHECKOUT', target: c.id })}>checkout {c.id}</button>{' '}
            {ghost.has(c.id) && <span className="badge">tylko na origin</span>}{' '}
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
