import { useEffect, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'
import {
  PROFILE_EXAMPLES,
  currentRun,
  fmtClock,
  fmtDuration,
  effectiveSshd,
  keyShort,
  negotiate,
  offeredKeys,
  parseGates,
  parseSshConfig,
  parseSshd,
  resolveHost,
  sshMachine,
  type Files,
  type GateTrace,
  type Master,
  type NodeId,
  type Outcome,
  type Run,
} from '../../machines/ssh.machine'
import { SCENARIOS } from '../../machines/ssh/scenarios'
import { NODE_META, edgeStatus, nodeView, type NodeStatus } from '../../machines/ssh/view'
import { ConfigFiles } from './ConfigFiles'
import { BOUNDARY_X, EDGES, H, NODE_H, NODE_ORDER, NODE_POS, NODE_W, W } from './scene'

const STATUS_TEXT: Record<NodeStatus, string> = { inactive: 'jeszcze nie', active: 'teraz', done: 'wykonane', skipped: 'pominięte', failed: 'zatrzymane' }
const SPEEDS = [
  { id: 'slow', label: 'wolno', ms: 2400 },
  { id: 'read', label: 'do czytania', ms: 1500 },
  { id: 'fast', label: 'szybko', ms: 600 },
]

function outcomeText(o: Outcome | null): string {
  if (!o) return 'w toku'
  switch (o.kind) {
    case 'dispatched': return 'gate: dopuszczone przez reguły demonstratora'
    case 'denied': return 'gate: odrzucono'
    case 'executed': return 'wykonanie bez gate (symulowane)'
    case 'interactive-shell': return 'interaktywny shell (symulowany)'
    case 'auth-failed': return 'uwierzytelnienie nieudane'
  }
}

const policyText = (m: Master | Run['policy']) => {
  const p = m && 'policy' in m ? m.policy : m
  if (!p) return '—'
  return p.kind === 'forced' ? `forced command ${p.forcedCommand} (z ${p.source})` : 'bez forced command'
}

/* ---------- Scene ---------- */

function Scene({ run, masters, now, selected, onSelect, selectedMaster, onSelectMaster }: {
  run: Run | null
  masters: Master[]
  now: number
  selected: NodeId | null
  onSelect: (n: NodeId) => void
  selectedMaster: string | null
  onSelectMaster: (id: string) => void
}) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  return (
    <div className="lab-scene" role="group" aria-label="Scena przepływu: klient po lewej, serwer po prawej">
      <svg className="lab-edges" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {(['idle', 'taken', 'active', 'skipped'] as const).map((s) => (
            <marker key={s} id={`lab-arrow-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className={`lab-arrowhead ${s}`} />
            </marker>
          ))}
        </defs>
        <rect x={BOUNDARY_X} y={0} width={W - BOUNDARY_X} height={H} className="lab-server-zone" />
        <line x1={BOUNDARY_X} y1={0} x2={BOUNDARY_X} y2={H} className="lab-boundary" />
        {EDGES.map((e) => {
          const st = edgeStatus(run, e)
          return (
            <polyline
              key={`${e.from}-${e.to}`}
              points={e.points.map((p) => p.join(',')).join(' ')}
              className={`lab-edge ${st}`}
              markerEnd={`url(#lab-arrow-${st})`}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      <span className="lab-zone-label client">Klient · Mac</span>
      <span className="lab-zone-label server">Serwer · forge@{'forge.lan'}</span>
      {EDGES.filter((e) => e.label).map((e) => (
        <span key={`l-${e.from}-${e.to}`} className={`lab-edge-label ${edgeStatus(run, e)}`} style={{ left: pct(e.labelAt![0], W), top: pct(e.labelAt![1], H) }}>
          {e.label}
        </span>
      ))}
      {NODE_ORDER.map((id) => {
        const v = nodeView(run, id)
        const [cx, cy] = NODE_POS[id]
        return (
          <button
            key={id}
            type="button"
            className={`lab-node ${v.status}${selected === id ? ' selected' : ''}`}
            style={{ left: pct(cx - NODE_W / 2, W), top: pct(cy - NODE_H / 2, H), width: pct(NODE_W, W), height: pct(NODE_H, H) }}
            aria-pressed={selected === id}
            aria-label={`${NODE_META[id].title}: ${STATUS_TEXT[v.status]}${v.note ? `. ${v.note}` : ''}`}
            onClick={() => onSelect(id)}
          >
            <span className="lab-node-title">{NODE_META[id].title}</span>
            <span className="lab-node-status">
              <span className="lab-tag">{STATUS_TEXT[v.status]}</span>
              {v.note && <span className="lab-node-note">{v.note}</span>}
              {!v.note && run && <span className="lab-node-note">{nodeDatum(run, id)}</span>}
            </span>
          </button>
        )
      })}
      <div className="lab-masters-zone">
        <MasterList masters={masters} now={now} selected={selectedMaster} onSelect={onSelectMaster} activeId={run?.connectionId ?? null} />
      </div>
    </div>
  )
}

// One short datum per node from the run, so the scene carries data, not only labels
function nodeDatum(run: Run, id: NodeId): string {
  const reached = run.path.includes(id)
  if (!reached) return ''
  switch (id) {
    case 'request': return `${run.settings.alias} · '${run.settings.command}'`
    case 'path': return run.controlPath ?? 'none'
    case 'lookup': return run.lookupHit === undefined ? 'szukam…' : run.lookupHit ? `znaleziono ${run.lookupHit}` : 'brak mastera'
    case 'channel': return `kanał w ${run.connectionId}`
    case 'auth': return run.actualKey ? `podpis: ${keyShort(run.actualKey)}` : run.acceptedKey ? `przyjęty: ${keyShort(run.acceptedKey)}` : `oferuje: ${keyShort(run.intendedKey)}`
    case 'rule': return run.rule ? `linia ${run.rule.line}${run.rule.comment ? ` · ${run.rule.comment}` : ''}` : ''
    case 'policy': return run.policy?.kind === 'forced' ? `${run.policy.source === 'sshd_config' ? 'ForceCommand ' : 'command='}${run.policy.forcedCommand.split('/').pop()}` : 'bez command='
    case 'gate': return run.gate ? `krok ${run.gateCursor + 1}/${run.gate.steps.length}` : ''
    case 'exec': return run.settings.command.trim() ? 'komenda klienta' : 'shell'
    case 'result': return outcomeText(run.outcome)
  }
}

/* ---------- Masters ---------- */

function MasterList({ masters, now, selected, onSelect, activeId }: { masters: Master[]; now: number; selected: string | null; onSelect: (id: string) => void; activeId: string | null }) {
  return (
    <div className="lab-masters">
      <span className="lab-masters-title">Mastery ControlMaster (lokalne gniazda)</span>
      {masters.length === 0 && <span className="lab-muted">brak — następne ssh otworzy nowe połączenie</span>}
      <ul>
        {masters.map((m) => (
          <li key={m.id}>
            <button type="button" className={`lab-master ${m.status}${selected === m.id ? ' selected' : ''}${activeId === m.id ? ' in-run' : ''}`} aria-pressed={selected === m.id} onClick={() => onSelect(m.id)}>
              <span className="lab-master-head">
                <code>{m.id}</code> <span className="lab-tag">{m.status === 'alive' ? (m.inUseBy ? `w użyciu: ${m.inUseBy}` : 'czeka') : m.status === 'expired' ? 'wygasł' : 'zamknięty'}</span>
              </span>
              <span>otworzył <code>{m.createdBy}</code> · klucz <strong>{keyShort(m.key)}</strong></span>
              <span>{m.policy.kind === 'forced' ? `forced command (${m.policy.profileId})` : 'bez gate'} · {m.status === 'alive' ? (m.inUseBy ? 'TTL od końca sesji' : m.expiresAt === null ? 'bez limitu (persist yes)' : `TTL ${fmtDuration(m.expiresAt - now)}`) : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Gate X-ray ---------- */

export function GateXray({ gate, cursor, live }: { gate: GateTrace; cursor: number; live: boolean }) {
  const shown = gate.steps.slice(0, cursor + 1)
  const current = gate.steps[cursor]
  const finished = cursor >= gate.steps.length - 1
  const failedIdx = gate.failedStep && finished ? gate.failedStep.tokenIndex ?? [] : []
  return (
    <div className="lab-xray">
      <div className="lab-xray-tokens" aria-label="Tokeny parsera">
        <span className="lab-muted">tokeny <code>args</code>:</span>
        {gate.tokens.length === 0 && <span className="lab-muted">(brak)</span>}
        {gate.tokens.map((t, i) => (
          <span key={i} className={['lab-token', current?.tokenIndex?.includes(i) && live && !finished && 'current', failedIdx.includes(i) && 'failed', i < 2 && 'pair'].filter(Boolean).join(' ')}>
            <small>{i}</small>
            <code>{t}</code>
          </span>
        ))}
        {gate.dropped.length > 0 && <span className="lab-token dropped"><small>pominięte</small><code>{gate.dropped.join('⏎')}</code></span>}
      </div>
      <ol className="lab-xray-steps">
        {shown.map((s, i) => (
          <li key={s.id} className={`${s.status}${i === cursor && !finished ? ' current' : ''}`}>
            <code>{s.label}</code>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      {finished && (
        <p className={`lab-verdict ${gate.allowed ? 'ok' : 'no'}`}>
          {gate.allowed ? 'Dopuszczone przez reguły demonstratora — dispatcher przekazałby argv do binarki.' : `Odrzucone: ${gate.failedStep!.detail}`}
        </p>
      )}
      {finished && gate.allowed && (
        <div className="lab-caveat">
          <strong>Dopuszczenie to nie dowód bezpieczeństwa.</strong> Regex argumentów sprawdza tylko znaki, nie znaczenie argumentów. Przepuści opcje zaczynające się od <code>-</code>, sekwencję <code>..</code> i ścieżki absolutne. Nie gwarantuje też, że <code>{gate.argv?.[0]}</code> nie zrobi czegoś niepożądanego: dozwolona podkomenda może zmieniać stan.
          {gate.warnings.length > 0 && (
            <ul>
              {gate.warnings.map((w, i) => <li key={i}><code>{w.token}</code>: {w.note}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Main lab ---------- */

export function SshLab() {
  const [snapshot, send] = useMachine(sshMachine)
  const ctx = snapshot.context
  const running = snapshot.matches('running')
  const awaitingTouch = snapshot.matches({ running: 'awaitingTouch' })

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('read')
  const [viewRunId, setViewRunId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null)
  const [selectedMaster, setSelectedMaster] = useState<string | null>(null)
  const [scenario, setScenario] = useState<{ id: string; next: number } | null>(null)
  const [scenarioPick, setScenarioPick] = useState(SCENARIOS[0].id)

  const sc = scenario ? SCENARIOS.find((s) => s.id === scenario.id)! : null
  const live = currentRun(ctx)
  const viewing = viewRunId ? ctx.runs.find((r) => r.id === viewRunId) ?? null : null
  const run = viewing ?? live
  const masters = viewing ? viewing.mastersAfter ?? ctx.masters : ctx.masters
  const lastEntry = run?.trace.at(-1) ?? null

  // Single driver: autoplay sends exactly the events the manual buttons send
  const scenarioTouch = useRef(false)
  useEffect(() => {
    if (!playing || !running || viewing) return
    const ms = SPEEDS.find((s) => s.id === speed)!.ms
    const id = window.setInterval(() => {
      send(awaitingTouch && scenarioTouch.current ? { type: 'TOUCH' } : { type: 'STEP' })
    }, ms)
    return () => window.clearInterval(id)
  }, [playing, running, viewing, speed, awaitingTouch, send])

  const loadScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id)!
    setViewRunId(null)
    setSelectedMaster(null)
    send({ type: 'RESET_ENV' })
    send({ type: 'SET_MUX', mux: s.mux })
    send({ type: 'SET_SERVER_PROFILE', profileId: s.profileId })
    Object.entries(s.files ?? {}).forEach(([file, text]) => send({ type: 'SET_FILE', file: file as keyof Files, text }))
    send({ type: 'SET_ALIAS', alias: s.requests[0].alias })
    send({ type: 'SET_COMMAND', command: s.requests[0].command })
    setScenario({ id, next: 0 })
  }

  const runNow = () => {
    setViewRunId(null)
    if (sc && scenario && scenario.next < sc.requests.length) {
      const rq = sc.requests[scenario.next]
      rq.before?.forEach((e) => send(e))
      send({ type: 'SET_ALIAS', alias: rq.alias })
      send({ type: 'SET_COMMAND', command: rq.command })
      scenarioTouch.current = !!rq.touch
      setScenario({ ...scenario, next: scenario.next + 1 })
    } else {
      scenarioTouch.current = false
    }
    send({ type: 'RUN' })
  }

  // Leave scenario mode when the user edits the next request by hand
  const manual = (fn: () => void) => () => {
    setScenario(null)
    fn()
  }

  const nextScenarioReq = sc && scenario && scenario.next < sc.requests.length ? sc.requests[scenario.next] : null
  const selMaster = selectedMaster ? masters.find((m) => m.id === selectedMaster) ?? null : null
  // Prediction for the next request, derived from the current files (no run needed)
  const cfg = parseSshConfig(ctx.files.sshConfig)
  const aliases = [...new Set([...cfg.aliases, ctx.settings.alias])]
  const nextHost = resolveHost(cfg, ctx.settings.alias)
  const nextOffered = offeredKeys(nextHost)
  const nextNeg = negotiate(ctx.files, nextHost, nextOffered)
  const nextForce = effectiveSshd(parseSshd(ctx.files.sshdConfig), nextHost.user).forceCommand
  const nextCommand = nextForce ? `ForceCommand "${nextForce.cmd}" (sshd_config)` : nextNeg.rule?.command ? `command="${nextNeg.rule.command}"` : null
  const gates = parseGates(ctx.files.gates, PROFILE_EXAMPLES).gates
  const nextGate = gates.find((g) => (nextForce?.cmd ?? nextNeg.rule?.command ?? '').startsWith(g.path)) ?? gates[0]
  const examples = nextGate?.examples ?? []
  const nodeEntries = run && selectedNode ? run.trace.filter((t) => t.node === selectedNode) : []

  return (
    <div className="lab">
      {/* 1. Experiment */}
      <div className="lab-experiment">
        <div className="lab-field">
          <label htmlFor="lab-scenario">Scenariusz</label>
          <div className="lab-inline">
            <select id="lab-scenario" value={scenarioPick} onChange={(e) => setScenarioPick(e.target.value)} disabled={running}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            <button type="button" onClick={() => loadScenario(scenarioPick)} disabled={running}>Wczytaj (resetuje środowisko)</button>
          </div>
        </div>
        <fieldset className="lab-field" disabled={running}>
          <legend>Następne żądanie</legend>
          <div className="lab-inline">
            {aliases.map((a) => (
              <button key={a} type="button" className={`chip${ctx.settings.alias === a ? ' selected' : ''}`} aria-pressed={ctx.settings.alias === a} onClick={manual(() => send({ type: 'SET_ALIAS', alias: a }))}>
                ssh {a}
              </button>
            ))}
            <input className="lab-cmd" value={ctx.settings.command} onChange={(e) => { setScenario(null); send({ type: 'SET_COMMAND', command: e.target.value }) }} aria-label="Komenda przekazana do ssh" spellCheck={false} />
          </div>
          <div className="lab-inline">
            {examples.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={manual(() => send({ type: 'SET_COMMAND', command: ex }))}>{ex}</button>
            ))}
          </div>
          <p className="lab-muted lab-hint">
            {nextNeg.fail
              ? `Przewidywanie dla nowego połączenia: ${nextNeg.fail}`
              : `Przewidywanie dla nowego połączenia: ${nextNeg.log.join(' · ')}${nextCommand ? ` → ${nextCommand}` : ' → bez forced command'}`}
            {' '}Aliasy i klucze pochodzą z plików poniżej.
          </p>
        </fieldset>
        {sc && (
          <div className="lab-scenario-card">
            <strong>{sc.title}</strong>
            <ol>
              {sc.requests.map((r, i) => (
                <li key={i} className={i < scenario!.next ? 'done' : i === scenario!.next ? 'next' : ''}>
                  <code>ssh {r.alias} '{r.command}'</code> — {r.note}{r.touch === false ? ' (nie dotykaj klucza)' : ''}
                </li>
              ))}
            </ol>
            <p><span className="lab-muted">Oczekiwanie:</span> {sc.expect}</p>
            {scenario!.next >= sc.requests.length && !running && <p><span className="lab-muted">Wynik:</span> {sc.lesson}</p>}
          </div>
        )}
      </div>

      <ConfigFiles files={ctx.files} disabled={running} send={send} />

      {/* 3. Controls (above the scene so they stay next to it) */}
      <div className="lab-controls" role="toolbar" aria-label="Sterowanie przebiegiem">
        <button type="button" className="lab-primary" onClick={runNow} disabled={running}>
          {nextScenarioReq ? `Uruchom żądanie ${scenario!.next + 1}/${sc!.requests.length}` : 'Uruchom'}
        </button>
        <button type="button" onClick={() => send({ type: 'STEP' })} disabled={!running || !!viewing}>
          {awaitingTouch ? 'Czekaj 5 s' : 'Następny krok'}
        </button>
        {awaitingTouch && !viewing && <button type="button" className="lab-touch" onClick={() => send({ type: 'TOUCH' })}>Dotknij YubiKey</button>}
        <button type="button" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>{playing ? 'Pauza' : 'Odtwarzaj'}</button>
        <label className="lab-inline lab-muted">
          tempo
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            {SPEEDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <span className="lab-clock" title="Czas symulowany, niezależny od zegara rzeczywistego">
          czas symulowany <strong>{fmtClock(ctx.now)}</strong>
        </span>
        <button type="button" onClick={() => send({ type: 'ADVANCE_TIME', ms: 5 * 60_000 })} disabled={!!viewing}>+5 min</button>
        <button type="button" className="danger" onClick={() => { setScenario(null); setViewRunId(null); setSelectedMaster(null); send({ type: 'RESET_ENV' }) }}>Reset środowiska</button>
        {playing && !running && <span className="lab-muted">autoodtwarzanie ruszy po „Uruchom”</span>}
      </div>

      {viewing && (
        <div className="lab-history-banner" role="status">
          Oglądasz zapisany przebieg <code>{viewing.id}</code>. Bieżące środowisko i ustawienia pozostają bez zmian.
          <button type="button" onClick={() => setViewRunId(null)}>Wróć do bieżącego</button>
        </div>
      )}

      {/* 2. Scene */}
      <Scene
        run={run}
        masters={masters}
        now={ctx.now}
        selected={selectedNode}
        onSelect={(n) => { setSelectedNode(n === selectedNode ? null : n); setSelectedMaster(null) }}
        selectedMaster={selectedMaster}
        onSelectMaster={(id) => { setSelectedMaster(id === selectedMaster ? null : id); setSelectedNode(null) }}
      />

      {/* Mobile: same model as an ordered list */}
      <ol className="lab-flow-list" aria-label="Przebieg żądania">
        {NODE_ORDER.map((id) => {
          const v = nodeView(run, id)
          return (
            <li key={id} className={`lab-node ${v.status}`}>
              <button type="button" onClick={() => setSelectedNode(id)} aria-pressed={selectedNode === id}>
                <span className="lab-node-title">{NODE_META[id].title}</span> <span className="lab-tag">{STATUS_TEXT[v.status]}</span>
              </button>
              {(v.note || (run && nodeDatum(run, id))) && <span className="lab-node-note">{v.note ?? nodeDatum(run!, id)}</span>}
            </li>
          )
        })}
      </ol>
      <div className="lab-masters-mobile">
        <MasterList masters={masters} now={ctx.now} selected={selectedMaster} onSelect={(id) => { setSelectedMaster(id); setSelectedNode(null) }} activeId={run?.connectionId ?? null} />
      </div>

      {/* 4. Current decision + identity comparison */}
      <div className="lab-decision">
        <div className="lab-identity" aria-label="Porównanie tożsamości">
          <div>
            <span className="lab-muted">zamierzony klucz (alias {run?.settings.alias ?? ctx.settings.alias})</span>
            <strong>{keyShort(run ? run.intendedKey : nextOffered[0]?.keyId)}</strong>
          </div>
          <span className={`lab-cmp ${run?.actualKey ? (run.actualKey === run.intendedKey ? 'eq' : 'ne') : ''}`}>{run?.actualKey ? (run.actualKey === run.intendedKey ? '=' : '≠') : '?'}</span>
          <div>
            <span className="lab-muted">klucz połączenia{run?.mode === 'reuse' ? ` (odziedziczony z ${run.connectionId})` : run?.mode === 'new' ? ' (nowe uwierzytelnienie)' : ''}</span>
            <strong>{run?.actualKey ? keyShort(run.actualKey) : 'jeszcze nieznany'}</strong>
          </div>
        </div>
        {lastEntry ? (
          <dl className="lab-chain" aria-live="polite">
            <div><dt>dane</dt><dd>{lastEntry.data}</dd></div>
            <div><dt>warunek</dt><dd>{lastEntry.reason}</dd></div>
            <div><dt>wynik</dt><dd><strong>{lastEntry.decision}</strong></dd></div>
            <div><dt>konsekwencja</dt><dd>{lastEntry.consequence}</dd></div>
          </dl>
        ) : (
          <p className="lab-muted">Wybierz scenariusz albo ustaw żądanie i naciśnij „Uruchom”. Potem przechodź krokami albo włącz odtwarzanie.</p>
        )}
      </div>

      {/* Node / master details */}
      {(selectedNode || selMaster) && (
        <div className="lab-details">
          {selectedNode && (
            <>
              <h3>{NODE_META[selectedNode].title}</h3>
              <p>{NODE_META[selectedNode].role}</p>
              {nodeView(run, selectedNode).note && <p><strong>{nodeView(run, selectedNode).note}</strong></p>}
              {nodeEntries.length > 0 ? (
                <ul>{nodeEntries.map((t) => <li key={t.step}><code>{fmtClock(t.t)}</code> {t.decision}. {t.consequence}</li>)}</ul>
              ) : (
                <p className="lab-muted">Brak danych w tym przebiegu.</p>
              )}
            </>
          )}
          {selMaster && (
            <>
              <h3>Master <code>{selMaster.id}</code></h3>
              <ul>
                <li>ControlPath: <code>{selMaster.controlPath}</code> (lokalny socket — punkt dostępu do połączenia, nie samo połączenie)</li>
                <li>utworzony przez <code>ssh {selMaster.createdBy}</code> w przebiegu <code>{selMaster.createdByRun}</code> o {fmtClock(selMaster.openedAt)}</li>
                <li>uwierzytelniony kluczem: <strong>{keyShort(selMaster.key)}</strong></li>
                <li>polityka utrwalona przy otwarciu: {policyText(selMaster)}</li>
                <li>status: {selMaster.status}{selMaster.status === 'alive' && selMaster.expiresAt !== null ? `, wygaśnie za ${fmtDuration(selMaster.expiresAt - ctx.now)} (ControlPersist ${selMaster.persistMs! / 60000}m)` : ''}</li>
              </ul>
              {!viewing && selMaster.status === 'alive' && (
                <button type="button" onClick={() => send({ type: 'CLOSE_MASTER', id: selMaster.id })} disabled={selMaster.inUseBy !== null}>
                  {selMaster.inUseBy ? `Zamknięcie niemożliwe: używa go ${selMaster.inUseBy}` : 'Zamknij master (ssh -O exit)'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Gate X-ray */}
      {run?.gate && (
        <section className="lab-section" aria-label="Rentgen gate">
          <h3>Gate: rentgen komendy</h3>
          <GateXray gate={run.gate} cursor={run.gateCursor} live={run.status !== 'finished'} />
        </section>
      )}

      {/* 5. History */}
      <section className="lab-section">
        <h3>Historia przebiegów</h3>
        {ctx.runs.length === 0 ? <p className="lab-muted">Jeszcze nic nie uruchomiono.</p> : (
          <ul className="lab-runs">
            {ctx.runs.map((r) => (
              <li key={r.id}>
                <button type="button" aria-pressed={run?.id === r.id} className={run?.id === r.id ? 'selected' : ''} onClick={() => setViewRunId(r.id === live?.id ? null : r.id)}>
                  <code>{r.id}</code> <code>ssh {r.settings.alias} '{r.settings.command}'</code>
                  <span>{r.mode === 'reuse' ? `reuse ${r.connectionId}` : r.mode === 'new' ? 'nowe połączenie' : '…'}</span>
                  <span className={`lab-tag ${r.outcome?.kind === 'denied' || r.outcome?.kind === 'auth-failed' ? 'bad' : r.outcome ? 'good' : ''}`}>{outcomeText(r.outcome)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {run && (
          <details className="lab-trace">
            <summary>Przebieg {run.id} tekstowo ({run.trace.length} kroków)</summary>
            <ol>
              {run.trace.map((t) => (
                <li key={t.step}>
                  <code>{fmtClock(t.t)}</code> <strong>{NODE_META[t.node].title}</strong>: {t.decision}. <span className="lab-muted">{t.reason}. {t.consequence}.</span>
                  {t.connectionId && <> <code>[{t.connectionId}]</code></>}
                  {t.change && <> <code>{t.change}</code></>}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {/* 6. Technical details */}
      <details className="lab-tech">
        <summary>Szczegóły techniczne: snapshot i ograniczenia modelu</summary>
        <div className="lab-tech-grid">
          <div>
            <span className="ssh-file-label">snapshot XState</span>
            <pre>{JSON.stringify({ value: snapshot.value, now: ctx.now, settings: ctx.settings, files: Object.fromEntries(Object.entries(ctx.files).map(([k, v]) => [k, `${v.split('\n').length} linii`])), masters: ctx.masters.map(({ id, controlPath, key, status, inUseBy, expiresAt }) => ({ id, controlPath, key, status, inUseBy, expiresAt })), runs: ctx.runs.length }, null, 2)}</pre>
          </div>
        </div>
        <p className="lab-muted">
          Model parsera odtwarza <code>read -r -a</code> z domyślnym IFS: czyta tylko pierwszą linię, dzieli po spacji i tabulatorze, nie interpretuje cudzysłowów ani globów. Wartość <code>ControlPath none</code> wyłącza multiplexing. Samo <code>ControlMaster no</code> nadal pozwala podłączyć się do istniejącego mastera. Parsery obsługują podzbiór dyrektyw (reszta jest zgłaszana jako „nie modelowane”); %C to zastępczy skrót, nie prawdziwy SHA1. To demonstracja mechanizmu, a nie audyt bezpieczeństwa SSH: nic nie łączy się z serwerem i nic nie jest uruchamiane.
        </p>
      </details>
    </div>
  )
}
