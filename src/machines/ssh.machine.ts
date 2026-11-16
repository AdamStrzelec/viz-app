import { assign, setup } from 'xstate'
import {
  HOST,
  PORT,
  SERVER,
  STEP_MS,
  TOUCH_TIMEOUT_MS,
  TOUCH_WAIT_STEP_MS,
  authorizedKeysText,
  defaultFiles,
  effectiveSshd,
  expireMasters,
  findAuthorizedKey,
  findMaster,
  gateIdFromPath,
  keyById,
  keyShort,
  offeredKeys,
  parseAuthorizedKeys,
  parseGates,
  parseSshConfig,
  parseSshd,
  resolveHost,
  sshConfigText,
  traceGate,
  PROFILE_EXAMPLES,
  type Alias,
  type AuthorizedKey,
  type Files,
  type GateTrace,
  type HostConfig,
  type KeyId,
  type Master,
  type MuxMode,
  type OfferedKey,
  type Policy,
} from './ssh/domain.ts'

export * from './ssh/domain.ts'

/* ---------- Data model ---------- */

export type NodeId = 'request' | 'path' | 'lookup' | 'channel' | 'auth' | 'rule' | 'policy' | 'gate' | 'exec' | 'result'

// Settings for the NEXT request only. Never touch environment or past runs.
export type RequestSettings = { alias: Alias; command: string }

export type Outcome =
  | { kind: 'dispatched'; argv: string[] }
  | { kind: 'denied'; stepId: string; reason: string; tokenIndex: number[] }
  | { kind: 'executed'; command: string }
  | { kind: 'interactive-shell' }
  | { kind: 'auth-failed'; reason: string }

export type TraceEntry = {
  runId: string
  step: number
  t: number // simulated ms
  node: NodeId
  event: string
  data: string // what went into the decision
  reason: string // the condition checked
  decision: string // the result
  consequence: string
  connectionId?: string
  change?: string
}

export type Run = {
  id: string
  startedAt: number
  settings: RequestSettings // frozen at RUN
  host: HostConfig // ~/.ssh/config resolved for this alias, frozen at RUN
  offered: OfferedKey[]
  intendedKey: KeyId | null // first key ssh would offer
  acceptedKey: KeyId | null // key sshd agreed to (before signature)
  rule: AuthorizedKey | null
  controlPath: string | null
  path: NodeId[]
  at: NodeId
  status: 'running' | 'awaiting-touch' | 'finished'
  mode: 'new' | 'reuse' | null
  lookupHit: string | null | undefined // undefined = lookup not done yet
  connectionId: string | null
  actualKey: KeyId | null
  policy: Policy | null
  gate: GateTrace | null
  gateCursor: number // index of the last revealed gate step
  touchWaitedMs: number
  outcome: Outcome | null
  trace: TraceEntry[]
  mastersAtStart: Master[]
  mastersAfter: Master[] | null
}

export type FileId = keyof Files

export type SshContext = {
  settings: RequestSettings
  files: Files // client file: read at RUN; server files: read on new connection; gates: read each execution
  now: number
  masters: Master[]
  seq: { run: number; master: number }
  runs: Run[]
}

export type SshEvent =
  | { type: 'SET_ALIAS'; alias: Alias }
  | { type: 'SET_COMMAND'; command: string }
  | { type: 'SET_FILE'; file: FileId; text: string }
  | { type: 'SET_MUX'; mux: MuxMode } // preset: rewrites ~/.ssh/config
  | { type: 'SET_SERVER_PROFILE'; profileId: string } // preset: rewrites authorized_keys
  | { type: 'RUN' }
  | { type: 'STEP' }
  | { type: 'TOUCH' }
  | { type: 'ADVANCE_TIME'; ms: number }
  | { type: 'CLOSE_MASTER'; id: string }
  | { type: 'RESET_ENV' }

export const initialContext = (): SshContext => ({
  settings: { alias: 'wt-forge', command: 'wt list --porcelain' },
  files: defaultFiles(),
  now: 0,
  masters: [],
  seq: { run: 0, master: 0 },
  runs: [],
})

export const currentRun = (ctx: SshContext): Run | null => ctx.runs.at(-1) ?? null

/* ---------- Pure transition helpers (each returns a context patch) ---------- */

type Patch = Partial<SshContext>
type EntryIn = Omit<TraceEntry, 'runId' | 'step' | 't' | 'node'>

function tick(ctx: SshContext, ms = STEP_MS): Pick<SshContext, 'now' | 'masters'> {
  const now = ctx.now + ms
  return { now, masters: expireMasters(ctx.masters, now) }
}

// Advance the current run to `node`, appending one trace entry
function advance(ctx: SshContext, node: NodeId | null, entry: EntryIn, runPatch: Partial<Run> = {}, ms = STEP_MS): Patch {
  const run = currentRun(ctx)!
  const t = tick(ctx, ms)
  const at = node ?? run.at
  const path = node && run.path.at(-1) !== node ? [...run.path, node] : run.path
  const next: Run = {
    ...run,
    ...runPatch,
    at,
    path,
    trace: [...run.trace, { runId: run.id, step: run.trace.length + 1, t: t.now, node: at, ...entry }],
  }
  return { ...t, runs: [...ctx.runs.slice(0, -1), next] }
}

function patchRun(ctx: SshContext, p: Partial<Run>): Run[] {
  return [...ctx.runs.slice(0, -1), { ...currentRun(ctx)!, ...p }]
}

function startRun(ctx: SshContext): Patch {
  const id = `r${ctx.seq.run + 1}`
  const s = { ...ctx.settings }
  const host = resolveHost(parseSshConfig(ctx.files.sshConfig), s.alias)
  const offered = offeredKeys(host)
  const intended = offered[0]?.keyId ?? null
  const run: Run = {
    id,
    startedAt: ctx.now,
    settings: s,
    host,
    offered,
    intendedKey: intended,
    acceptedKey: null,
    rule: null,
    controlPath: null,
    path: ['request'],
    at: 'request',
    status: 'running',
    mode: null,
    lookupHit: undefined,
    connectionId: null,
    actualKey: null,
    policy: null,
    gate: null,
    gateCursor: -1,
    touchWaitedMs: 0,
    outcome: null,
    trace: [
      {
        runId: id,
        step: 1,
        t: ctx.now,
        node: 'request',
        event: 'RUN',
        data: `ssh ${s.alias} '${s.command}'`,
        reason: host.matchedLines.length
          ? `~/.ssh/config: Host w liniach ${host.matchedLines.join(', ')} → ${host.user}@${host.hostname}:${host.port}, IdentitiesOnly ${host.identitiesOnly ? 'yes' : 'no'}`
          : `brak bloku Host dla „${s.alias}” — ${s.alias} traktowany jako nazwa hosta`,
        decision: offered.length ? `klucze do zaoferowania: ${offered.map((o) => `${keyShort(o.keyId)} (${o.via})`).join(', ')}` : 'brak kluczy do zaoferowania',
        consequence: 'to tylko intencja — o faktycznej tożsamości zdecyduje połączenie',
      },
    ],
    mastersAtStart: ctx.masters,
    mastersAfter: null,
  }
  return { runs: [...ctx.runs, run], seq: { ...ctx.seq, run: ctx.seq.run + 1 } }
}

function resolvePathStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const h = run.host
  const cp = h.controlPath
  const raw = h.controlPathRaw
  const tokens = raw ? [...raw.matchAll(/%(.)/g)].map((m) => m[1]) : []
  const TOKEN_TEXT: Record<string, string> = { n: '%n = alias z polecenia', h: '%h = HostName', r: '%r = zdalny user', p: '%p = port', C: '%C = skrót z %l%h%p%r (bez aliasu!)', l: '%l = lokalny host', u: '%u = lokalny user', d: '%d = katalog domowy' }
  return advance(
    ctx,
    'path',
    {
      event: 'STEP',
      data: raw ? `ControlPath ${raw} (linia ${h.source.controlpath})` : 'brak ControlPath',
      reason: !raw ? 'bez ControlPath nie ma multiplexingu' : raw === 'none' ? 'none wyłącza multiplexing' : tokens.map((t) => TOKEN_TEXT[t] ?? `%${t}`).join(', ') || 'stała ścieżka — wspólna dla wszystkich aliasów',
      decision: cp ?? 'brak gniazda',
      consequence: cp ? 'klient sprawdzi, czy pod tą ścieżką czeka master' : 'każde wywołanie otwiera nowe połączenie',
    },
    { controlPath: cp },
  )
}

function lookupStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const existing = findMaster(ctx.masters, run.controlPath)
  const forceNew = run.host.controlMaster === 'yes'
  const m = forceNew ? null : existing
  return advance(
    ctx,
    'lookup',
    {
      event: 'STEP',
      data: `${run.controlPath ?? '(brak ControlPath)'} · ControlMaster ${run.host.controlMaster}`,
      reason: forceNew ? 'ControlMaster yes: klient nie podłącza się do istniejącego mastera' : 'czy pod tą ścieżką istnieje żywy master?',
      decision: m ? `tak: ${m.id} (otworzył ${m.createdBy}, klucz ${keyShort(m.key)})` : forceNew && existing ? `${existing.id} istnieje, ale jest pomijany` : 'nie',
      consequence: m ? 'nowy kanał w istniejącym połączeniu — bez uwierzytelnienia' : 'nowe połączenie TCP i nowe uwierzytelnienie',
      connectionId: m?.id,
    },
    { lookupHit: m?.id ?? null },
  )
}

function openChannelStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const m = ctx.masters.find((x) => x.id === run.lookupHit)!
  const mismatch = m.key !== run.intendedKey
  const p = advance(
    ctx,
    'channel',
    {
      event: 'STEP',
      data: `master ${m.id}: klucz ${keyShort(m.key)}, zamierzony ${keyShort(run.intendedKey)}`,
      reason: 'reuse nie wykonuje uwierzytelnienia — tożsamość pochodzi z mastera',
      decision: mismatch ? `klucz połączenia ≠ zamierzony klucz` : 'klucz połączenia = zamierzony klucz',
      consequence: mismatch ? `żądanie ${run.settings.alias} działa jako połączenie otwarte przez ${m.createdBy}` : 'zachowanie zgodne z intencją aliasu',
      connectionId: m.id,
      change: `${m.id}.inUseBy = ${run.id}`,
    },
    { mode: 'reuse', connectionId: m.id, actualKey: m.key },
  )
  return { ...p, masters: p.masters!.map((x) => (x.id === m.id ? { ...x, inUseBy: run.id, expiresAt: null } : x)) }
}

// Server side of a new connection: which offered key does sshd accept (before any signature)?
export function negotiate(files: Files, host: HostConfig, offered: OfferedKey[]): { accepted: KeyId | null; rule: AuthorizedKey | null; log: string[]; fail: string | null } {
  if (host.hostname !== HOST) return { accepted: null, rule: null, log: [], fail: `ssh: Could not resolve hostname ${host.hostname}` }
  if (host.port !== PORT) return { accepted: null, rule: null, log: [], fail: `ssh: connect to host ${host.hostname} port ${host.port}: Connection refused` }
  const sshd = effectiveSshd(parseSshd(files.sshdConfig), host.user)
  if (!SERVER.users.includes(host.user)) return { accepted: null, rule: null, log: [], fail: `${host.user}@${host.hostname}: Permission denied (publickey) — na serwerze nie ma konta ${host.user}` }
  if (!sshd.userAllowed.ok) return { accepted: null, rule: null, log: [], fail: `Permission denied (publickey) — ${sshd.userAllowed.why}` }
  if (!sshd.pubkey) return { accepted: null, rule: null, log: [], fail: 'Permission denied — sshd_config: PubkeyAuthentication no' }
  const ak = parseAuthorizedKeys(files.authorizedKeys)
  const log: string[] = []
  for (const o of offered) {
    const { entry, skipped } = findAuthorizedKey(ak, o.keyId)
    if (entry) {
      log.push(`${keyShort(o.keyId)}: przyjęty (authorized_keys linia ${entry.line})`)
      return { accepted: o.keyId, rule: entry, log, fail: null }
    }
    log.push(`${keyShort(o.keyId)}: odrzucony — ${skipped.length ? `from= w linii ${skipped[0].line} nie obejmuje klienta` : 'brak w authorized_keys'}`)
  }
  return { accepted: null, rule: null, log, fail: `Permission denied (publickey) — żaden zaoferowany klucz nie pasuje${offered.length ? '' : ' (brak kluczy)'}` }
}

function beginAuthStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const n = negotiate(ctx.files, run.host, run.offered)
  const k = keyById(n.accepted)
  return advance(
    ctx,
    'auth',
    {
      event: 'STEP',
      data: n.log.length ? n.log.join('; ') : `${run.host.user}@${run.host.hostname}:${run.host.port}`,
      reason: 'sshd sprawdza po kolei zaoferowane klucze publiczne, zanim poprosi o podpis',
      decision: n.fail ?? (k!.touch ? `${k!.short}: klucz sprzętowy, podpis wymaga dotyku` : `${k!.short}: podpis bez interakcji`),
      consequence: n.fail ? 'uwierzytelnienie się nie uda' : 'klucz prywatny nie opuszcza klienta — do serwera idzie tylko podpis',
    },
    { mode: 'new', acceptedKey: n.accepted, rule: n.rule, outcome: n.fail ? { kind: 'auth-failed', reason: n.fail } : null },
  )
}

function requestTouchStep(ctx: SshContext): Patch {
  return advance(
    ctx,
    'auth',
    {
      event: 'STEP',
      data: 'sk-ssh-ed25519: wyzwanie do podpisu',
      reason: `YubiKey podpisze dopiero po dotyku (limit ${TOUCH_TIMEOUT_MS / 1000} s czasu symulowanego)`,
      decision: 'czekam na dotyk',
      consequence: 'pauza zatrzymuje także to odliczanie',
    },
    { status: 'awaiting-touch' },
  )
}

function waitTouchStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  return { ...tick(ctx, TOUCH_WAIT_STEP_MS), runs: patchRun(ctx, { touchWaitedMs: run.touchWaitedMs + TOUCH_WAIT_STEP_MS }) }
}

function authenticateStep(ctx: SshContext, event: string): Patch {
  const run = currentRun(ctx)!
  return advance(
    ctx,
    'auth',
    {
      event,
      data: `podpis kluczem ${keyShort(run.acceptedKey)}`,
      reason: 'sshd weryfikuje podpis kluczem publicznym z authorized_keys',
      decision: 'uwierzytelniono',
      consequence: 'tożsamość połączenia = ten klucz, na całe życie połączenia',
    },
    { status: 'running', actualKey: run.acceptedKey },
  )
}

function touchTimeoutStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const reason = `brak dotyku przez ${(run.touchWaitedMs + TOUCH_WAIT_STEP_MS) / 1000} s → sign_and_send_pubkey: signing failed`
  return advance(
    ctx,
    null,
    {
      event: 'STEP',
      data: 'YubiKey nie potwierdził podpisu',
      reason: `limit ${TOUCH_TIMEOUT_MS / 1000} s`,
      decision: 'uwierzytelnienie nieudane',
      consequence: 'brak połączenia, brak mastera, komenda nie dotarła do serwera',
    },
    { touchWaitedMs: run.touchWaitedMs + TOUCH_WAIT_STEP_MS, outcome: { kind: 'auth-failed', reason } },
    TOUCH_WAIT_STEP_MS,
  )
}

function applyRuleStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const key = run.actualKey!
  const rule = run.rule!
  const sshd = effectiveSshd(parseSshd(ctx.files.sshdConfig), run.host.user)
  const restrictions = [...rule.restrictions, ...(!sshd.permitTTY && !rule.restrictions.includes('no-pty') ? ['no-pty (PermitTTY no)'] : [])]
  const forced = sshd.forceCommand ? { cmd: sshd.forceCommand.cmd, source: 'sshd_config' as const } : rule.command ? { cmd: rule.command, source: 'authorized_keys' as const } : null
  const policy: Policy = forced
    ? { kind: 'forced', profileId: gateIdFromPath(forced.cmd), forcedCommand: forced.cmd, source: forced.source, restrictions }
    : { kind: 'none', restrictions }
  const occupied = findMaster(ctx.masters, run.controlPath)
  const creates = run.controlPath !== null && run.host.controlMaster !== 'no' && !occupied
  const id = `c${ctx.seq.master + 1}`
  const p = advance(
    ctx,
    'rule',
    {
      event: 'STEP',
      data: `klucz połączenia: ${keyShort(key)}`,
      reason: 'sshd wybiera linię authorized_keys po kluczu, którym nastąpiło uwierzytelnienie',
      decision: `linia ${rule.line}: ${rule.text}${sshd.forceCommand ? ` + sshd_config ForceCommand (linia ${sshd.forceCommand.line}) ma pierwszeństwo` : ''}`,
      consequence: creates
        ? `ControlMaster ${run.host.controlMaster}: powstaje master ${id} pod ${run.controlPath}, z tą polityką`
        : run.controlPath && occupied
          ? `gniazdo ${run.controlPath} zajęte przez ${occupied.id} — to połączenie nie zostaje masterem`
          : run.controlPath
            ? 'ControlMaster no: połączenie nie zostaje masterem'
            : 'bez multiplexingu: połączenie zniknie po komendzie',
      connectionId: creates ? id : undefined,
      change: creates ? `masters += ${id}` : undefined,
    },
    { policy, connectionId: creates ? id : null },
  )
  if (!creates) return p
  const master: Master = {
    id,
    controlPath: run.controlPath!,
    createdBy: run.settings.alias,
    createdByRun: run.id,
    key,
    policy,
    openedAt: p.now!,
    inUseBy: run.id,
    persistMs: run.host.persistMs,
    expiresAt: null,
    status: 'alive',
    endedAt: null,
  }
  return { ...p, masters: [...p.masters!, master], seq: { ...ctx.seq, master: ctx.seq.master + 1 } }
}

function inheritPolicyStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const m = ctx.masters.find((x) => x.id === run.connectionId)!
  return advance(
    ctx,
    'policy',
    {
      event: 'STEP',
      data: `polityka zapisana w ${m.id}`,
      reason: 'kanał dziedziczy ograniczenia połączenia master — authorized_keys nie jest sprawdzany ponownie',
      decision: m.policy.kind === 'forced' ? `forced command: ${m.policy.forcedCommand}` : 'bez forced command',
      consequence: m.policy.kind === 'forced' ? 'komenda klienta trafi do gate jako SSH_ORIGINAL_COMMAND' : 'komenda klienta zostanie wykonana bez gate',
      connectionId: m.id,
    },
    { policy: m.policy },
  )
}

function newPolicyStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const pol = run.policy!
  return advance(ctx, 'policy', {
    event: 'STEP',
    data: pol.kind === 'forced' ? `${pol.source === 'sshd_config' ? 'ForceCommand' : 'command='} "${pol.forcedCommand}"${pol.restrictions.length ? `, ${pol.restrictions.join(', ')}` : ''}` : pol.restrictions.length ? pol.restrictions.join(', ') : 'linia bez opcji',
    reason: 'czy jest ForceCommand w sshd_config albo command= w regule?',
    decision: pol.kind === 'forced' ? `tak — forced command z ${pol.source}` : 'nie',
    consequence: pol.kind === 'forced' ? 'sshd zignoruje komendę klienta i uruchomi gate' : 'sshd wykona komendę klienta (albo shell, gdy jej brak)',
    connectionId: run.connectionId ?? undefined,
  })
}

function enterGateStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const pol = run.policy as Extract<Policy, { kind: 'forced' }>
  const def = parseGates(ctx.files.gates, PROFILE_EXAMPLES).gates.find((g) => g.path === pol.forcedCommand.split(/\s+/)[0])
  const gate = def ? traceGate(def, run.settings.command) : missingGate(pol.forcedCommand, run.settings.command)
  return advance(
    ctx,
    'gate',
    {
      event: 'STEP',
      data: `SSH_ORIGINAL_COMMAND=${JSON.stringify(run.settings.command)}`,
      reason: def ? `${def.path} czytany przy każdym wykonaniu (zmiana allowlisty działa też na reuse)` : `${pol.forcedCommand} nie ma w allowliście gate`,
      decision: gate.steps[0].detail,
      consequence: 'gate sprawdza komendę krok po kroku',
      connectionId: run.connectionId ?? undefined,
    },
    { gate, gateCursor: 0 },
  )
}

// Forced command that is not a modelled gate: we do not guess what it does
function missingGate(cmd: string, raw: string): GateTrace {
  const step = { id: 'missing', label: 'exec', status: 'fail' as const, detail: `${cmd}: brak definicji w allowliście gate — symulator nie wie, co robi ten program (traktuję jak exit 127)` }
  return { profileId: gateIdFromPath(cmd), raw, tokens: [], dropped: [], steps: [step], allowed: false, failedStep: step, argv: null, warnings: [] }
}

function gateAdvanceStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const i = run.gateCursor + 1
  const s = run.gate!.steps[i]
  return advance(
    ctx,
    'gate',
    {
      event: 'STEP',
      data: s.label,
      reason: s.detail,
      decision: s.status === 'fail' ? 'odmowa' : s.status === 'ok' ? 'warunek spełniony' : 'informacja',
      consequence: s.status === 'fail' ? 'gate kończy się exit 1, nic nie zostaje uruchomione' : 'następny krok gate',
      connectionId: run.connectionId ?? undefined,
    },
    { gateCursor: i },
  )
}

function gateFinishStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const g = run.gate!
  if (g.allowed) {
    return advance(
      ctx,
      'result',
      {
        event: 'STEP',
        data: JSON.stringify(g.argv),
        reason: 'wszystkie warunki gate spełnione',
        decision: 'dopuszczone przez reguły demonstratora',
        consequence: g.warnings.length ? `uwaga: ${g.warnings.map((w) => w.token).join(', ')} — regex nie ocenia znaczenia argumentów` : 'dispatch do binarki (symulowany — brak realnego wyniku programu)',
        connectionId: run.connectionId ?? undefined,
      },
      { outcome: { kind: 'dispatched', argv: g.argv! } },
    )
  }
  const f = g.failedStep!
  return advance(
    ctx,
    null,
    {
      event: 'STEP',
      data: f.label,
      reason: f.detail,
      decision: 'odrzucono',
      consequence: 'exit 1, połączenie/kanał kończy się bez wykonania',
      connectionId: run.connectionId ?? undefined,
    },
    { outcome: { kind: 'denied', stepId: f.id, reason: f.detail, tokenIndex: f.tokenIndex ?? [] } },
  )
}

function enterExecStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const empty = run.settings.command.trim() === ''
  return advance(ctx, 'exec', {
    event: 'STEP',
    data: empty ? 'brak komendy' : `komenda: ${run.settings.command}`,
    reason: run.policy?.restrictions.some((r) => r.startsWith('no-pty')) && empty ? 'polityka bez forced command, ale no-pty: shell bez terminala' : 'polityka bez forced command',
    decision: empty ? 'sshd uruchamia interaktywny shell logowania' : 'sshd przekazuje komendę do shella użytkownika (shell -c)',
    consequence: 'gate nie bierze udziału',
    connectionId: run.connectionId ?? undefined,
  })
}

function execFinishStep(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const empty = run.settings.command.trim() === ''
  return advance(
    ctx,
    'result',
    {
      event: 'STEP',
      data: empty ? 'shell' : run.settings.command,
      reason: 'brak ograniczeń z authorized_keys',
      decision: empty ? 'sesja interaktywna (symulowana)' : 'komenda wykonana bez gate (symulowane)',
      consequence: 'symulacja — nic nie zostało uruchomione',
      connectionId: run.connectionId ?? undefined,
    },
    { outcome: empty ? { kind: 'interactive-shell' } : { kind: 'executed', command: run.settings.command } },
  )
}

// Release the master channel and start ControlPersist countdown
function finishRun(ctx: SshContext): Patch {
  const run = currentRun(ctx)!
  const masters = ctx.masters.map((m): Master => {
    if (m.inUseBy !== run.id) return m
    if (m.persistMs === 0) return { ...m, inUseBy: null, status: 'closed', endedAt: ctx.now } // ControlPersist no
    return { ...m, inUseBy: null, expiresAt: m.persistMs === null ? null : ctx.now + m.persistMs }
  })
  return { masters, runs: patchRun({ ...ctx, masters }, { status: 'finished', mastersAfter: masters }) }
}

/* ---------- Machine ---------- */

export const sshMachine = setup({
  types: { context: {} as SshContext, events: {} as SshEvent },
  guards: {
    masterFound: ({ context }) => !!currentRun(context)?.lookupHit && findMaster(context.masters, currentRun(context)!.controlPath)?.id === currentRun(context)!.lookupHit,
    authRejected: ({ context }) => currentRun(context)!.outcome?.kind === 'auth-failed',
    needsTouch: ({ context }) => !!keyById(currentRun(context)!.acceptedKey)?.touch,
    touchTimesOut: ({ context }) => currentRun(context)!.touchWaitedMs + TOUCH_WAIT_STEP_MS >= TOUCH_TIMEOUT_MS,
    isReuse: ({ context }) => currentRun(context)!.mode === 'reuse',
    policyForced: ({ context }) => currentRun(context)!.policy?.kind === 'forced',
    gateHasMoreSteps: ({ context }) => {
      const r = currentRun(context)!
      return r.gateCursor < r.gate!.steps.length - 1
    },
    canCloseMaster: ({ context, event }) => event.type === 'CLOSE_MASTER' && context.masters.some((m) => m.id === event.id && m.status === 'alive' && m.inUseBy === null),
  },
  actions: {
    startRun: assign(({ context }) => startRun(context)),
    resolvePath: assign(({ context }) => resolvePathStep(context)),
    lookup: assign(({ context }) => lookupStep(context)),
    openChannel: assign(({ context }) => openChannelStep(context)),
    beginAuth: assign(({ context }) => beginAuthStep(context)),
    requestTouch: assign(({ context }) => requestTouchStep(context)),
    waitTouch: assign(({ context }) => waitTouchStep(context)),
    authenticate: assign(({ context, event }) => authenticateStep(context, event.type)),
    touchTimeout: assign(({ context }) => touchTimeoutStep(context)),
    applyRule: assign(({ context }) => applyRuleStep(context)),
    inheritPolicy: assign(({ context }) => inheritPolicyStep(context)),
    newPolicy: assign(({ context }) => newPolicyStep(context)),
    enterGate: assign(({ context }) => enterGateStep(context)),
    gateAdvance: assign(({ context }) => gateAdvanceStep(context)),
    gateFinish: assign(({ context }) => gateFinishStep(context)),
    enterExec: assign(({ context }) => enterExecStep(context)),
    execFinish: assign(({ context }) => execFinishStep(context)),
    finishRun: assign(({ context }) => finishRun(context)),
  },
}).createMachine({
  id: 'ssh',
  context: initialContext,
  on: {
    SET_ALIAS: { actions: assign({ settings: ({ context, event }) => ({ ...context.settings, alias: event.alias }) }) },
    SET_COMMAND: { actions: assign({ settings: ({ context, event }) => ({ ...context.settings, command: event.command }) }) },
    SET_FILE: { actions: assign({ files: ({ context, event }) => ({ ...context.files, [event.file]: event.text }) }) },
    SET_MUX: { actions: assign({ files: ({ context, event }) => ({ ...context.files, sshConfig: sshConfigText(event.mux) }) }) },
    SET_SERVER_PROFILE: { actions: assign({ files: ({ context, event }) => ({ ...context.files, authorizedKeys: authorizedKeysText(event.profileId) }) }) },
    ADVANCE_TIME: { actions: assign(({ context, event }) => tick(context, event.ms)) },
    CLOSE_MASTER: {
      guard: 'canCloseMaster',
      actions: assign({ masters: ({ context, event }) => context.masters.map((m) => (m.id === event.id ? { ...m, status: 'closed', endedAt: context.now } : m)) }),
    },
    RESET_ENV: { target: '.idle', actions: assign(() => initialContext()) },
  },
  initial: 'idle',
  states: {
    idle: { on: { RUN: { target: 'running', actions: 'startRun' } } },
    running: {
      initial: 'request',
      states: {
        request: { on: { STEP: { target: 'controlPath', actions: 'resolvePath' } } },
        controlPath: { on: { STEP: { target: 'lookup', actions: 'lookup' } } },
        lookup: {
          on: {
            STEP: [
              { guard: 'masterFound', target: 'channel', actions: 'openChannel' },
              { target: 'auth', actions: 'beginAuth' },
            ],
          },
        },
        channel: { on: { STEP: { target: 'policy', actions: 'inheritPolicy' } } },
        auth: {
          on: {
            STEP: [
              { guard: 'authRejected', target: '#ssh.idle', actions: 'finishRun' },
              { guard: 'needsTouch', target: 'awaitingTouch', actions: 'requestTouch' },
              { target: 'rule', actions: ['authenticate', 'applyRule'] },
            ],
          },
        },
        awaitingTouch: {
          on: {
            TOUCH: { target: 'rule', actions: ['authenticate', 'applyRule'] },
            STEP: [
              { guard: 'touchTimesOut', target: '#ssh.idle', actions: ['touchTimeout', 'finishRun'] },
              { actions: 'waitTouch' },
            ],
          },
        },
        rule: { on: { STEP: { target: 'policy', actions: 'newPolicy' } } },
        policy: {
          on: {
            STEP: [
              { guard: 'policyForced', target: 'gate', actions: 'enterGate' },
              { target: 'exec', actions: 'enterExec' },
            ],
          },
        },
        gate: {
          on: {
            STEP: [
              { guard: 'gateHasMoreSteps', actions: 'gateAdvance' },
              { target: '#ssh.idle', actions: ['gateFinish', 'finishRun'] },
            ],
          },
        },
        exec: { on: { STEP: { target: '#ssh.idle', actions: ['execFinish', 'finishRun'] } } },
      },
    },
  },
})
