import { useEffect, useState } from 'react'
import { useMachine } from '@xstate/react'
import { Cabinet, Sieve } from '@lucasmarkes/hairline/react'
import { Example } from '../components/Example'
import { lessonPipelineMachine, PIPELINE_SCENARIOS, PIPELINE_STAGES, type StageId } from '../machines/lessonPipeline.machine'
import {
  DAY,
  LESSON_KEYS,
  MINUTE,
  SRS_INTERVALS,
  SRS_STORAGE_KEY,
  UI_KEY,
  isDue,
  isMastered,
  itemKey,
  lessonRuntimeMachine,
  progress,
  type SrsItem,
} from '../machines/lessonRuntime.machine'
import { ALL_POSITIONS, SAMPLE_LESSON } from '../machines/lessonRuntime.data'
import { RUNTIME_SCENARIOS } from '../machines/lessonRuntime.scenarios'
import './LessonEnginePage.css'

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

const fmtTime = (ms: number) => {
  const d = Math.floor(ms / DAY)
  const m = Math.floor((ms % DAY) / MINUTE)
  return `d${d} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ------------------------------------------------------------------ pipeline --

type StageStatus = 'active' | 'completed' | 'failed' | 'inactive'

function PipelineSection() {
  const [snapshot, send] = useMachine(lessonPipelineMachine)
  const reduced = useReducedMotion()
  const ctx = snapshot.context
  const value = String(snapshot.value)
  const terminal = ['published', 'rejected', 'crashed'].includes(value)

  const statusOf = (id: StageId): StageStatus =>
    ctx.failed.includes(id) ? 'failed' : ctx.done.includes(id) ? 'completed' : snapshot.matches(id) ? 'active' : 'inactive'

  const outcome =
    value === 'published' ? 'opublikowana · exit 0' : value === 'rejected' ? 'needs_attention · exit 1 (brak publikacji)' : value === 'crashed' ? 'awaria narzędzia · exit 2' : 'w toku'

  return (
    <Example
      wide
      title="a. Produkcja lekcji: bin/lekcja → bramka → publikacja"
      description="Każdy etap to stan maszyny. G3–ZAKRES zbierają uwagi w jednym przebiegu (bramka nie przerywa na pierwszym błędzie, poza wyjątkiem = exit 2). bin/lekcja bramka zatrzymuje się na czerwonym werdykcie — audyt sensu i publikacja nie ruszają."
      state={{ value: snapshot.value, context: { scenario: ctx.scenario, exitCode: ctx.exitCode, done: ctx.done, failed: ctx.failed, issues: ctx.issues.map((i) => i.code) } }}
      actions={<button className="chip" onClick={() => send({ type: 'RESET' })}>RESET</button>}
    >
      <div className="le-row">
        <div className="le-scenarios" role="radiogroup" aria-label="Scenariusz produkcji">
          {PIPELINE_SCENARIOS.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={ctx.scenario === s.id}
              className={['chip', ctx.scenario === s.id && 'le-on'].filter(Boolean).join(' ')}
              disabled={value !== 'idle'}
              onClick={() => send({ type: 'SELECT', scenario: s.id })}
              title={s.hint}
            >
              SELECT · {s.label}
            </button>
          ))}
        </div>
        <button onClick={() => send({ type: 'NEXT' })} disabled={terminal}>NEXT →</button>
      </div>
      <p className="muted le-hint">{PIPELINE_SCENARIOS.find((s) => s.id === ctx.scenario)!.hint}</p>

      <div className="le-pipe-grid">
        <ol className="le-stages" aria-label="Etapy produkcji">
          {PIPELINE_STAGES.map((s) => {
            const st = statusOf(s.id)
            const issue = ctx.issues.find((i) => i.stage === s.id)
            return (
              <li key={s.id} className={`le-stage le-${st}`}>
                <span className="le-badge">{st}</span>
                <strong>{s.label}</strong>
                <small>{s.who}</small>
                {issue && <code className="le-issue">{issue.code}</code>}
              </li>
            )
          })}
          <li className={`le-stage le-outcome le-${value === 'published' ? 'completed' : terminal ? 'failed' : 'inactive'}`}>
            <span className="le-badge">wynik</span>
            <strong>{outcome}</strong>
          </li>
        </ol>
        <div className="le-side">
          <Sieve className="le-figure" theme="auto" play={!reduced} label="Sito: bramka przepuszcza tylko zweryfikowane twierdzenia" />
          <h3 className="le-h3">Artefakty</h3>
          <ul className="le-files">
            {ctx.artifacts.length === 0 && <li className="muted">— jeszcze nic (NEXT)</li>}
            {ctx.artifacts.map((a, i) => (
              <li key={i} className={statusOf(a.stage) === 'failed' ? 'le-file-bad' : ''}>
                <code>{a.path}</code>
                <small>{a.note}</small>
              </li>
            ))}
          </ul>
          <h3 className="le-h3">Log</h3>
          <pre className="le-log" aria-live="polite">{ctx.log.join('\n') || '$ lekcja bramka'}</pre>
        </div>
      </div>
    </Example>
  )
}

// ------------------------------------------------------------------- runtime --

function Bar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="le-bar" title={hint}>
      <span>{label}</span>
      <div className="le-bar-track" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="le-bar-fill" style={{ width: `${value * 100}%` }} />
      </div>
      <b>{Math.round(value * 100)}%</b>
    </div>
  )
}

const HORIZON = 21

// Leitner schedule: current due plus the projection if every next answer is correct
function Timeline({ items, now }: { items: Record<string, SrsItem>; now: number }) {
  const W = 640
  const rowH = 26
  const left = 46
  const x = (ms: number) => left + (Math.min(ms, HORIZON * DAY) / (HORIZON * DAY)) * (W - left - 10)
  return (
    <svg className="le-timeline" viewBox={`0 0 ${W} ${LESSON_KEYS.length * rowH + 30}`} role="img" aria-label={`Harmonogram powtórek, teraz ${fmtTime(now)}`}>
      {Array.from({ length: HORIZON + 1 }, (_, d) => (
        <g key={d}>
          <line x1={x(d * DAY)} x2={x(d * DAY)} y1={4} y2={LESSON_KEYS.length * rowH + 6} className="le-tl-grid" />
          {d % 3 === 0 && <text x={x(d * DAY)} y={LESSON_KEYS.length * rowH + 22} className="le-tl-label" textAnchor="middle">d{d}</text>}
        </g>
      ))}
      {LESSON_KEYS.map((k, r) => {
        const it = items[k]
        const y = r * rowH + 16
        const proj: number[] = []
        if (it) {
          let t = Math.max(it.due, now)
          for (let b = it.box + 1; b < SRS_INTERVALS.length && t < HORIZON * DAY; b++) {
            t += SRS_INTERVALS[b] * DAY
            proj.push(t)
          }
        }
        return (
          <g key={k}>
            <text x={4} y={y + 4} className="le-tl-label">{k.split(':')[1]}</text>
            {it && (
              <>
                {proj.map((t, i) => <circle key={i} cx={x(t)} cy={y} r={3} className="le-tl-proj" />)}
                <circle cx={x(it.due)} cy={y} r={6} className={isDue(it, now) ? 'le-tl-due now' : 'le-tl-due'} />
                <text x={x(it.due) + 9} y={y + 4} className="le-tl-label">b{it.box}</text>
              </>
            )}
          </g>
        )
      })}
      <line x1={x(now)} x2={x(now)} y1={0} y2={LESSON_KEYS.length * rowH + 8} className="le-tl-now" />
    </svg>
  )
}

function RuntimeSection() {
  const [snapshot, send] = useMachine(lessonRuntimeMachine)
  const reduced = useReducedMotion()
  const ctx = snapshot.context
  const [scenarioId, setScenarioId] = useState(RUNTIME_SCENARIOS[0].id)
  const [cursor, setCursor] = useState(0)
  const [auto, setAuto] = useState(false)
  const scenario = RUNTIME_SCENARIOS.find((s) => s.id === scenarioId)!
  const finished = cursor >= scenario.steps.length
  const playing = auto && !finished

  // Playback control: a user-started timer replays the preset list; it never reacts to animations
  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(() => {
      send(scenario.steps[cursor].event)
      setCursor((c) => c + 1)
    }, reduced ? 1400 : 800)
    return () => window.clearTimeout(t)
  }, [playing, cursor, reduced, scenario, send])

  const next = () => {
    if (finished) return
    send(scenario.steps[cursor].event)
    setCursor((c) => c + 1)
  }
  const restart = (id = scenarioId) => {
    setAuto(false)
    setScenarioId(id)
    setCursor(0)
    send({ type: 'RESET' })
  }

  const p = progress(ctx.srs, ctx.now, ctx.akty)
  const value = String(snapshot.value)
  const proposed = snapshot.hasTag('proposed')
  const can = (e: Parameters<typeof send>[0]) => snapshot.can(e)

  return (
    <Example
      wide
      title="b–c. Runtime ucznia: kartoteka SRS (Leitner) w czasie"
      description="Maszyna wzorowana na pakiety/lekcja-ui/src/lib/srs.ts. Klikaj eventy ręcznie albo odtwarzaj preset (Dalej / Auto). Każda ocena: trafienie → box+1, ok+1, due = teraz + BOX[box] dni; błąd → box 0, ok 0, zle+1."
      state={{ value: snapshot.value, context: { now: fmtTime(ctx.now), dueMode: ctx.dueMode, module: ctx.module, biegMode: ctx.biegMode, queue: ctx.queue, akty: ctx.akty, lastEvent: ctx.lastEvent } }}
      actions={<button className="chip" onClick={() => restart()}>RESET</button>}
    >
      <div className="le-player">
        <div className="le-scenarios" role="radiogroup" aria-label="Preset scenariusza">
          {RUNTIME_SCENARIOS.map((s) => (
            <button key={s.id} role="radio" aria-checked={s.id === scenarioId} className={['chip', s.id === scenarioId && 'le-on'].filter(Boolean).join(' ')} onClick={() => restart(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="muted le-hint">{scenario.summary}</p>
        <div className="le-row">
          <button onClick={next} disabled={finished}>Dalej ({Math.min(cursor + 1, scenario.steps.length)}/{scenario.steps.length})</button>
          <button className="chip" onClick={() => setAuto(!playing)} disabled={finished}>{playing ? 'Pauza' : 'Auto'}</button>
          <label className="le-mode">
            due po błędzie:
            <select value={ctx.dueMode} disabled={value !== 'boot'} onChange={(e) => send({ type: 'SET_DUE_MODE', mode: e.target.value as 'react' | 'v2' })}>
              <option value="react">React srs.ts (teraz + 0)</option>
              <option value="v2">silnik v2 (teraz + 10 min)</option>
            </select>
          </label>
        </div>
        <ol className="le-steps" aria-label="Kroki presetu">
          {scenario.steps.map((s, i) => (
            <li key={i} className={i < cursor ? 'le-step-done' : i === cursor ? 'le-step-next' : ''}>
              <code>{s.event.type}{'cid' in s.event ? ` ${s.event.cid}` : ''}{'mod' in s.event && s.event.type !== 'STEP' ? ` ${s.event.mod}` : ''}{'mode' in s.event ? ` ${s.event.mode}` : ''}{'days' in s.event ? ` +${s.event.days}d` : ''}</code>
              <span>{s.note}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="le-manual" aria-label="Eventy ręczne">
        <span className="le-h3">Eventy ręczne · stan <code>{value}</code>{proposed && <em className="le-proposed"> PROPOZYCJA</em>}</span>
        <div className="le-row">
          <button className="chip" disabled={!can({ type: 'LOAD' })} onClick={() => send({ type: 'LOAD' })}>LOAD</button>
          {SAMPLE_LESSON.modules.map((m) => (
            <button key={m.id} className="chip" disabled={!can({ type: 'OPEN_MODULE', mod: m.id })} onClick={() => send({ type: 'OPEN_MODULE', mod: m.id })}>OPEN_MODULE {m.id}</button>
          ))}
          <button className="chip" disabled={!can({ type: 'STEP', mod: ctx.module ?? 'm1', i: 1 })} onClick={() => send({ type: 'STEP', mod: ctx.module ?? 'm1', i: 1 })}>STEP</button>
          {(['dzis', 'bledy', 'mix'] as const).map((m) => (
            <button key={m} className="chip" disabled={!can({ type: 'START_BIEG', mode: m })} onClick={() => send({ type: 'START_BIEG', mode: m })}>BIEG {m}</button>
          ))}
          <button className="chip" disabled={!can({ type: 'START_KOLOKWIUM' })} onClick={() => send({ type: 'START_KOLOKWIUM' })}>KOLOKWIUM</button>
          <button className="chip" disabled={!can({ type: 'BACK' })} onClick={() => send({ type: 'BACK' })}>BACK</button>
          <button className="chip" onClick={() => send({ type: 'ADVANCE', days: 1 })}>ADVANCE +1d</button>
          <button className="chip" onClick={() => send({ type: 'ADVANCE', days: 7 })}>ADVANCE +7d</button>
        </div>
      </div>

      <div className="le-runtime-grid">
        <div>
          <h3 className="le-h3">Kartoteka <code>{SRS_STORAGE_KEY}</code> · teraz {fmtTime(ctx.now)}</h3>
          <table className="le-table">
            <thead>
              <tr><th>klucz</th><th>box</th><th>due</th><th>ok</th><th>n</th><th>zle</th><th>ocena</th></tr>
            </thead>
            <tbody>
              {ALL_POSITIONS.map((pos) => {
                const k = itemKey(pos.cid)
                const it = ctx.srs.items[k]
                const answerable = can({ type: 'ANSWER', cid: pos.cid, ok: true }) && (ctx.module === null || ctx.module === pos.mod)
                return (
                  <tr key={k} className={[it && isDue(it, ctx.now) && 'le-due', isMastered(it) && 'le-mastered', ctx.queue.includes(k) && 'le-queued'].filter(Boolean).join(' ')}>
                    <td><code>{k}</code><small>{pos.q}</small></td>
                    <td><span className={`le-box b${it?.box ?? 0}`}>{it ? it.box : '–'}</span></td>
                    <td>{it ? fmtTime(it.due) : '–'}</td>
                    <td>{it?.ok ?? '–'}</td>
                    <td>{it?.n ?? '–'}</td>
                    <td>{it?.zle ?? '–'}</td>
                    <td className="le-ans">
                      <button className="chip" disabled={!answerable} aria-label={`ANSWER ${pos.cid} ok`} onClick={() => send({ type: 'ANSWER', cid: pos.cid, ok: true })}>✓</button>
                      <button className="chip" disabled={!answerable} aria-label={`ANSWER ${pos.cid} błąd`} onClick={() => send({ type: 'ANSWER', cid: pos.cid, ok: false })}>✗</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted le-legend">
            <span className="le-due-sw" /> na dziś (due ≤ teraz) · <b>pogrubione</b> = opanowane (ok ≥ 2) · BOX = [{SRS_INTERVALS.join(', ')}] dni
          </p>
        </div>
        <div className="le-side">
          <Cabinet className="le-figure" theme="auto" play={!reduced} label="Szafka: kartoteka pozycji powtórkowych" />
          <Bar label="Przerobione (akty / pozycje×2)" value={p.przerobione} hint={`${ctx.akty.length} aktów / ${p.wszystkie * 2}`} />
          <Bar label={`Opanowane ${p.opanowane}/${p.wszystkie}`} value={p.opanowane / p.wszystkie} />
          <p className="le-kpi">na dziś: <b>{p.dzis}</b> · z błędami: <b>{p.bledy}</b> · akty: <b>{ctx.akty.length}</b></p>
          <div className={`le-complete ${proposed ? 'on' : ''}`}>
            <em className="le-proposed">PROPOZYCJA</em> stan „lekcja ukończona”: {proposed ? 'osiągnięty — wszystkie pozycje ok ≥ 2' : `brak (${p.opanowane}/${p.wszystkie} opanowanych)`}
          </div>
        </div>
      </div>
      <h3 className="le-h3">Oś czasu: due (duże kółko, b = pudełko) i projekcja kolejnych powtórek przy samych trafieniach</h3>
      <Timeline items={ctx.srs.items} now={ctx.now} />
    </Example>
  )
}

// ------------------------------------------------------------------- outputs --

function OutputsSection() {
  return (
    <Example wide title="d. Co wychodzi na końcu" description="Dwa niezależne wyjścia: pliki w repo (produkcja) i localStorage przeglądarki ucznia (runtime)." state={null}>
      <div className="le-out-grid">
        <div className="le-out">
          <h3 className="le-h3">Produkcja (exit 0)</h3>
          <ul className="le-files">
            <li><code>lekcje/{SAMPLE_LESSON.dziedzina}/{SAMPLE_LESSON.slug}/index.html</code><small>opublikowana lekcja + claims, audyt.md, lekcja.gate.json, zakres, audyt-sensu.md, ryciny/</small></li>
            <li><code>…/lekcja.srs.json</code><small>{'{ pozycje: [...] }'} — z tego korzysta wspólna kartoteka; bez niego publikacja nie startuje</small></li>
            <li><code>lekcje/_manifest.json</code><small>{'{ wersja: 1, lekcje: [{ slug, dziedzina, sciezka, src_id, data, sha256_index, sha256_claims, claimow, liczb, pozycji_srs, bramka }] }'}</small></li>
          </ul>
          <p className="muted">exit 1 → tylko audyt.md + lekcja.gate.json w lekcje/_wip; exit 2 → nic, awaria narzędzia.</p>
        </div>
        <div className="le-out">
          <h3 className="le-h3">Runtime (przeglądarka)</h3>
          <ul className="le-files">
            <li><code>localStorage["{SRS_STORAGE_KEY}"]</code><small>{'{ ver: 1, items: { "{slug}:{cid}": { box, due, ok, n, zle, lekcja, mod, typ, … } } }'} — wspólna dla całego korpusu</small></li>
            <li><code>localStorage["{UI_KEY}"]</code><small>{'{ akty: [...], seen, theme, krok }'} — stan widoku tej lekcji, źródło paska „Przerobione”</small></li>
          </ul>
          <p className="muted">Nie ma zapisu „lekcja ukończona” — ukończenie to dziś tylko wniosek z kartoteki (pokazany wyżej jako propozycja).</p>
        </div>
      </div>
    </Example>
  )
}

function NotesSection() {
  return (
    <Example wide title="e. Rozbieżności i znane błędy" description="Z porównania lekcje/_silnik/demo/index.html (v2) z pakiety/lekcja-ui/src/lib/srs.ts." state={null}>
      <ul className="le-notes">
        <li><b>due po błędzie:</b> v2 <code>ocen()</code> i <code>bieg()</code> ustawiają <code>due = teraz() + 600000</code> (10 min); React <code>rate()</code> liczy <code>now + SRS_INTERVALS[0] * DAY</code> = teraz. Przełącznik „due po błędzie” wyżej pokazuje obie wersje.</li>
        <li><b>bieg nie woła akt():</b> <code>bieg().dalej()</code> ocenia inline (kopiuje logikę <code>ocen</code>) bez <code>akt('ocena:…')</code>, więc powtórki nie ruszają paska „Przerobione”. Kolokwium idzie przez <code>ocen()</code> i akty dokłada.</li>
        <li><b>akty są zbiorem:</b> <code>akt(k)</code> dodaje klucz tylko raz — druga ocena tej samej pozycji pasek nie zwiększa.</li>
        <li><b>brak stanu końcowego:</b> ani v2, ani React nie mają stanu „lekcja ukończona”; <code>completed</code> w maszynie (tag <code>proposed</code>) to propozycja.</li>
      </ul>
    </Example>
  )
}

export default function LessonEnginePage() {
  return (
    <>
      <h1 className="page-title">Silnik lekcji fajdi</h1>
      <p className="muted">Od sesji pisania do kartoteki ucznia: produkcja lekcji w repo i nauka w przeglądarce, krok po kroku. Lekcja przykładowa: <code>{SAMPLE_LESSON.slug}</code> (2 moduły, {ALL_POSITIONS.length} pozycji).</p>
      <PipelineSection />
      <RuntimeSection />
      <OutputsSection />
      <NotesSection />
    </>
  )
}
