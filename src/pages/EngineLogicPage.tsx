import { useState } from 'react'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'
import { learnerMachine, STAGES, stageOf, type StageId } from '../machines/learner.machine'
import { checkAddress, engineMachine, FAULTS, PERSPECTIVES, STEPS, stepsFor, type Mode, type StepId } from '../machines/engine.machine'

const IDLE = ['idle', 'done', 'blocked', 'toolError']

const VIEWS = [
  { id: 'user', label: '👤 Użytkownik' },
  { id: 'code', label: '⚙️ Kod' },
  { id: 'data', label: '🗂 Dane zewnętrzne' },
] as const

// Shows the current step from the user, code and external-data points of view
function PerspectivePanel({ step, faultCodes }: { step: StepId; faultCodes: string[] }) {
  const p = PERSPECTIVES[step]
  const label = STEPS.find((s) => s.id === step)!.label
  return (
    <div className="eng-views" aria-live="polite">
      <div className="eng-views-title">krok: <strong>{label}</strong>{faultCodes.length > 0 && <> · <code>{faultCodes.join(', ')}</code></>}</div>
      {VIEWS.map((v) => (
        <div key={v.id} className={`eng-view eng-view-${v.id}`}>
          <span className="ssh-file-label">{v.label}</span>
          {v.id === 'user' && <p>{p.user}</p>}
          {v.id === 'code' && <ul>{p.code.map((c) => <li key={c.file + c.fn}><code>{c.file}</code><small>{c.fn}</small></li>)}</ul>}
          {v.id === 'data' && <ul>{p.data.map((d) => <li key={d.name}><code>{d.name}</code><small>{d.what}</small></li>)}</ul>}
        </div>
      ))}
    </div>
  )
}

// Learner-only view: inputs, commands, responses and consequences
function LearnerFlow() {
  const [snapshot, send] = useMachine(learnerMachine)
  const current = String(snapshot.value) as StageId
  const stage = stageOf(current)
  const last = snapshot.context.history.at(-1)
  const visited = new Set(snapshot.context.history.map((h) => h.stage))

  return (
    <Example
      wide
      className="learner-flow"
      title="Flow ucznia: jak powstaje lekcja"
      description="Tylko to, co widzi osoba tworząca lekcję. Wybierz komendę z listy — zobaczysz odpowiedź terminala, jej skutek i to, dokąd prowadzi. Komunikaty z bin/lekcja. [U] = uruchomione na kopii lekcji 2.2, [K] = wniosek z kodu."
      state={{ value: snapshot.value, kroków: snapshot.context.history.length }}
      actions={<button className="chip" onClick={() => send({ type: 'RESET' })}>od początku</button>}
    >
      <ol className="lf-path" aria-label="Etapy">
        {STAGES.map((s) => (
          <li key={s.id} className={['lf-stage', s.id === current && 'active', visited.has(s.id) && s.id !== current && 'visited'].filter(Boolean).join(' ')}>
            <strong>{s.label}</strong>
            <span>{s.where}</span>
          </li>
        ))}
      </ol>

      <div className="lf-grid">
        <div className="lf-panel">
          <span className="ssh-file-label">Co musisz podać</span>
          {stage.needs.length ? <ul>{stage.needs.map((n) => <li key={n}>{n}</li>)}</ul> : <p className="muted">Nic — lekcja jest gotowa.</p>}
          <span className="ssh-file-label">Co możesz wpisać teraz</span>
          <div className="lf-commands">
            {stage.commands.map((c) => (
              <button key={c.input + c.scenario} className={`lf-cmd ${c.tone}`} onClick={() => send({ type: 'TYPE', command: c })}>
                <code>{c.input}</code>
                <small>{c.scenario} → {stageOf(c.next).label} <span className={`lf-src ${c.src}`} title={c.src === 'U' ? 'uruchomione naprawdę' : 'wniosek z kodu'}>{c.src}</span></small>
              </button>
            ))}
          </div>
        </div>

        <div className="lf-panel">
          <span className="ssh-file-label">Odpowiedź terminala</span>
          {last ? (
            <>
              <pre className={`lf-term ${last.command.tone}`}>{`$ ${last.command.input}\n${last.command.output}${last.command.exit !== undefined ? `\n[kod wyjścia: ${last.command.exit}]` : ''}`}</pre>
              <span className="ssh-file-label">Co z tego wynika</span>
              <p className="lf-consequence">{last.command.consequence}</p>
              <p className="muted">{stageOf(last.stage).label} → <strong>{stageOf(last.command.next).label}</strong></p>
            </>
          ) : (
            <p className="muted">Zacznij od lekcja stan albo lekcja.</p>
          )}
        </div>
      </div>

      {snapshot.context.history.length > 0 && (
        <ol className="history">
          {snapshot.context.history.map((h, i) => (
            <li key={i} className={h.command.tone === 'bad' ? 'rejected' : ''}>
              <code>{h.command.input}</code> — {h.command.scenario} → {stageOf(h.command.next).label}
            </li>
          ))}
        </ol>
      )}
    </Example>
  )
}

function Architecture() {
  const lanes = [
    { title: 'Korpus', items: ['PDF (med-paczka-molem/)', '_katalog.yaml: src_id, aliasy', '_pagemap/<src_id>.json: PDF ↔ nadruk', 'podreczniki/<src_id>/rNN-*.md: ### pN'] },
    { title: 'Sesja ucznia', items: ['lekcja: menu z _plan/<src_id>.yaml', 'przygotuj_katalog → lekcje/_wip/<slug>/', 'agent w bwrap: wywiad → plan → zatwierdzenie', 'lekcja szukaj / lekcja rycina'] },
    { title: 'Bramka', items: ['G3 adresy (med_cite_check)', 'G4 liczby (med_num_check)', 'G5 node --check (tylko HTML)', 'ZAKRES → audyt sensu (agent)'] },
    { title: 'Wynik', items: ['HTML: lekcje/<dziedzina>/<slug>/', '_manifest.json + plan: zweryfikowana', 'md: tylko lekcja.gate.json', 'lekcja.srs.json (powtórki)'] },
  ]
  return (
    <Example
      wide
      title="Architektura: od PDF do opublikowanej lekcji"
      description="Każde twierdzenie w lekcji niesie adres {src_id}#p{strona_nadruku}. Adres sprawdza kod (G3, G4), nie model. Model sprawdza dopiero sens, i to tylko zgodność ze stroną, nie prawdę medyczną."
      state={null}
    >
      <div className="eng-lanes">
        {lanes.map((l, i) => (
          <div key={l.title} className="eng-lane">
            <strong>{i + 1}. {l.title}</strong>
            <ul>{l.items.map((it) => <li key={it}>{it}</li>)}</ul>
          </div>
        ))}
      </div>
    </Example>
  )
}

function GateSimulator() {
  const [snapshot, send] = useMachine(engineMachine)
  const ctx = snapshot.context
  const state = String(snapshot.value)
  const busy = !IDLE.includes(state)
  const steps = stepsFor(ctx.mode)
  const resultOf = (id: StepId) => ctx.results.find((r) => r.step === id)
  const visibleFaults = FAULTS.filter((f) => steps.some((s) => s.id === f.step))
  const [picked, setPicked] = useState<StepId | null>(null)
  // Follow the running step; when idle show the clicked step or the last one reached
  const runningStep = steps.find((s) => s.id === state)?.id
  const focusStep: StepId = runningStep ?? picked ?? ctx.results.at(-1)?.step ?? 'wejscie'

  return (
    <Example
      wide
      title="Symulator: lekcja bramka"
      description="Najpierw przygotuj lekcję (menu lekcja → przygotuj_katalog), potem uruchom bramkę. Włącz usterki, żeby zobaczyć, na którym kroku odpada i z jakim kodem wyjścia. Kroki deterministyczne idą przed audytem sensu; jedno NIEZGODNE blokuje."
      state={{ value: snapshot.value, planStatus: ctx.planStatus, exitCode: ctx.exitCode, cache: ctx.cache }}
    >
      <div className="ssh-settings">
        <div className="ssh-row">
          <span className="ssh-key">tryb</span>
          {(['html', 'md'] as Mode[]).map((m) => (
            <button key={m} className={`chip${ctx.mode === m ? ' selected' : ''}`} disabled={state !== 'idle' || ctx.planStatus !== 'TODO'} onClick={() => send({ type: 'SET_MODE', mode: m })}>
              {m === 'html' ? 'index.html (_wip)' : 'lekcja.md (kontener)'}
            </button>
          ))}
        </div>
        <div className="ssh-row">
          <span className="ssh-key">akcje</span>
          <button disabled={busy || ctx.planStatus !== 'TODO'} onClick={() => send({ type: 'PREPARE' })}>1. lekcja → przygotuj</button>
          <button className="chip" disabled={busy || ctx.planStatus === 'TODO'} onClick={() => send({ type: 'RUN' })}>2. lekcja bramka</button>
          <button className="chip" disabled={busy || ctx.cache === 0} onClick={() => send({ type: 'EDIT_CLAIM' })}>zmień 15 twierdzeń</button>
          <button className="chip" disabled={busy} onClick={() => send({ type: 'RESET' })}>reset</button>
        </div>
        <div className="ssh-row">
          <span className="ssh-key">usterki</span>
          {visibleFaults.map((f) => (
            <button key={f.id} className={`chip eng-fault ${f.severity}${ctx.faults.includes(f.id) ? ' selected' : ''}`} disabled={busy} title={`${f.where} — ${f.fix}`} onClick={() => send({ type: 'TOGGLE_FAULT', id: f.id })}>
              {f.step}: {f.code}
            </button>
          ))}
          {ctx.faults.length > 0 && <button className="chip" disabled={busy} onClick={() => send({ type: 'CLEAR_FAULTS' })}>wyczyść</button>}
        </div>
      </div>

      <div className="eng-plan">
        plan jednostki:
        {(['TODO', 'w_toku', 'zweryfikowana'] as const).map((s) => (
          <span key={s} className={`badge${ctx.planStatus === s ? ' ok' : ''}`}>{s}</span>
        ))}
        {ctx.exitCode !== null && <span className={`badge ${ctx.exitCode === 0 ? 'ok' : 'no'}`}>exit {ctx.exitCode}</span>}
      </div>

      <ol className="ssh-pipeline" aria-label="Kroki bramki">
        {steps.map((s) => {
          const r = resultOf(s.id)
          const cls = ['ssh-stage', state === s.id && 'active', r && `eng-${r.status}`, focusStep === s.id && 'eng-focus'].filter(Boolean).join(' ')
          return (
            <li key={s.id} className={cls} onClick={() => setPicked(s.id)} title="Kliknij, żeby zobaczyć perspektywy">
              <strong>{s.label}</strong>
              <span>{s.sub}</span>
              {r?.codes.map((c) => <em key={c}>{c}</em>)}
            </li>
          )
        })}
      </ol>

      <PerspectivePanel step={focusStep} faultCodes={resultOf(focusStep)?.codes ?? []} />

      <div className="ssh-files">
        <div>
          <span className="ssh-file-label">pliki w lekcje/_wip/&lt;slug&gt;/ i dalej</span>
          <pre>{ctx.files.length ? ctx.files.join('\n') : '(nic jeszcze)'}</pre>
        </div>
        <div>
          <span className="ssh-file-label">.audyt-cache.json</span>
          <pre>{`${ctx.cache} / ${ctx.claims} werdyktów ZGODNE w cache\nklucz = sha256(agent, model, INSTRUKCJA,\n  rodzaj, ucięte, twierdzenie, strona)\nNIEZGODNE nigdy nie trafia do cache`}</pre>
        </div>
      </div>

      <ol className="history">
        {ctx.log.map((l, i) => (
          <li key={i} className={/✗|‼|exit [12]/.test(l) ? 'rejected' : ''}>{l}</li>
        ))}
      </ol>
    </Example>
  )
}

function AddressChecker() {
  const [address, setAddress] = useState('robbins-2026#p85')
  const v = checkAddress(address)
  const examples = ['robbins-2026#p85', 'robbins-2026#p130-131', 'robbins-2026#p90', 'robbins-2026#p91', 'robbins-2026#p93', 'robbins-2026#p?149', 'harrison-2030#p12', 'mutschler-2016#p130-131']
  return (
    <Example
      title="G3: sprawdzanie adresu cytowania"
      description="Uproszczone parse_anchor + rozstrzygnij + degraduj na przykładowym korpusie (robbins-2026: strony 85–94, brak ### p90, p91 pominięta, p93 słaba mapa). Zakresy są ilustracyjne."
      state={{ address, verdict: v.code }}
    >
      <input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Adres cytowania" />
      <div className="ssh-row">
        {examples.map((ex) => <button key={ex} className="chip" onClick={() => setAddress(ex)}>{ex}</button>)}
      </div>
      <span className={`badge ${v.severity === 'ok' ? 'ok' : v.severity === 'blokuje' ? 'no' : ''} eng-verdict`}>
        {v.code} · {v.severity === 'ok' ? 'przechodzi' : v.severity}
      </span>
      <p className="muted">{v.detail}</p>
    </Example>
  )
}

function ScenarioTable() {
  const [step, setStep] = useState<StepId | 'all'>('all')
  const rows = FAULTS.filter((f) => step === 'all' || f.step === step)
  return (
    <Example wide title="Scenariusz → kod" description="Co blokuje, co jest tylko ostrzeżeniem i gdzie to siedzi w kodzie. Exit 1 = werdykt blokujący, exit 2 = awaria narzędzia." state={null}>
      <div className="ssh-row">
        <button className={`chip${step === 'all' ? ' selected' : ''}`} onClick={() => setStep('all')}>wszystkie</button>
        {STEPS.filter((s) => FAULTS.some((f) => f.step === s.id)).map((s) => (
          <button key={s.id} className={`chip${step === s.id ? ' selected' : ''}`} onClick={() => setStep(s.id)}>{s.label}</button>
        ))}
      </div>
      <div className="eng-table-wrap">
        <table className="eng-table">
          <thead><tr><th>Krok</th><th>Kod</th><th>Skutek</th><th>Gdzie</th><th>Naprawa</th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>{f.step}</td>
                <td><code>{f.code}</code></td>
                <td><span className={`badge ${f.severity === 'ostrzezenie' ? '' : 'no'}`}>{f.severity}</span></td>
                <td><code>{f.where}</code></td>
                <td>{f.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Example>
  )
}

export default function EngineLogicPage() {
  return (
    <>
      <LearnerFlow />
      <Architecture />
      <GateSimulator />
      <AddressChecker />
      <ScenarioTable />
    </>
  )
}
