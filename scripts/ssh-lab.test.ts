// Run: npm run test:ssh  (node:test + --experimental-strip-types, no extra deps)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createActor } from 'xstate'
import { sshMachine, currentRun, profileById, traceGate, tokenize, parseSshConfig, resolveHost, offeredKeys, parseAuthorizedKeys, parseSshd, effectiveSshd, parseGates, defaultFiles, type SshEvent, type Run, type Files } from '../src/machines/ssh.machine.ts'
import type { Scenario } from '../src/machines/ssh/scenarios.ts'
import { SCENARIOS } from '../src/machines/ssh/scenarios.ts'
import { nodeView } from '../src/machines/ssh/view.ts'

type Actor = ReturnType<typeof createActor<typeof sshMachine>>

const setup = (sc: Scenario) =>
  fresh(
    { type: 'SET_MUX', mux: sc.mux },
    { type: 'SET_SERVER_PROFILE', profileId: sc.profileId },
    ...Object.entries(sc.files ?? {}).map(([file, text]) => ({ type: 'SET_FILE', file: file as keyof Files, text }) as SshEvent),
  )

function fresh(...events: SshEvent[]): Actor {
  const a = createActor(sshMachine).start()
  events.forEach((e) => a.send(e))
  return a
}

// Drive one request to the end with STEP only (same event autoplay uses)
function request(a: Actor, alias: string, command: string, touch = true): Run {
  a.send({ type: 'SET_ALIAS', alias })
  a.send({ type: 'SET_COMMAND', command })
  a.send({ type: 'RUN' })
  for (let i = 0; i < 100 && !a.getSnapshot().matches('idle'); i++) {
    const s = a.getSnapshot()
    a.send(touch && s.matches({ running: 'awaitingTouch' }) ? { type: 'TOUCH' } : { type: 'STEP' })
  }
  assert.ok(a.getSnapshot().matches('idle'), 'run finished')
  return currentRun(a.getSnapshot().context)!
}

/* ---------- tokenizer / gate ---------- */

test('tokenize models read -r -a: first line only, quotes literal', () => {
  assert.deepEqual(tokenize('wt list\nrm -rf ~').tokens, ['wt', 'list'])
  assert.deepEqual(tokenize('wt list\nrm -rf ~').dropped, ['rm -rf ~'])
  assert.deepEqual(tokenize('wt new "x; rm -rf ~"').tokens, ['wt', 'new', '"x;', 'rm', '-rf', '~"'])
  assert.deepEqual(tokenize('  wt\tlist  ').tokens, ['wt', 'list'])
  assert.deepEqual(tokenize('').tokens, [])
})

test('gate: allowed, denied pair, denied arg, empty', () => {
  const wt = profileById('wt')
  assert.equal(traceGate(wt, 'wt new feature-x').allowed, true)
  const pair = traceGate(wt, 'rm -rf ~')
  assert.equal(pair.allowed, false)
  assert.equal(pair.failedStep?.id, 'pair')
  const arg = traceGate(wt, 'wt new "x; rm -rf ~"')
  assert.equal(arg.failedStep?.id, 'arg-2')
  assert.deepEqual(arg.failedStep?.tokenIndex, [2])
  assert.equal(traceGate(wt, '').failedStep?.id, 'pair')
  assert.equal(traceGate(wt, 'wt').allowed, false) // "wt " is not on the list
})

test('gate: newline tail ignored like bash (allowed, with warn step)', () => {
  const g = traceGate(profileById('wt'), 'wt list\nrm -rf ~')
  assert.equal(g.allowed, true)
  assert.equal(g.steps.find((s) => s.id === 'raw')?.status, 'warn')
})

test('gate: regex admits options, .. and absolute paths — flagged as warnings, not "safe"', () => {
  const g = traceGate(profileById('wt'), 'wt drop ../../etc')
  assert.equal(g.allowed, true)
  assert.ok(g.warnings.some((w) => w.token === '../../etc'))
  const o = traceGate(profileById('backup'), 'backup run --all')
  assert.equal(o.allowed, true)
  assert.ok(o.warnings.some((w) => w.token === '--all'))
  assert.ok(traceGate(profileById('wt'), 'wt new /etc').warnings.some((w) => w.token === '/etc'))
})

/* ---------- connection model ---------- */

test('new restricted connection: auth → rule → gate, creates master', () => {
  const a = fresh()
  const r = request(a, 'wt-forge', 'wt list')
  assert.equal(r.mode, 'new')
  assert.equal(r.actualKey, 'gate-key')
  assert.deepEqual(r.path, ['request', 'path', 'lookup', 'auth', 'rule', 'policy', 'gate', 'result'])
  assert.equal(r.outcome?.kind, 'dispatched')
  const m = a.getSnapshot().context.masters
  assert.equal(m.length, 1)
  assert.equal(m[0].status, 'alive')
  assert.equal(m[0].inUseBy, null)
})

test('reuse skips authentication and authorized_keys', () => {
  const a = fresh()
  request(a, 'wt-forge', 'wt list')
  const r = request(a, 'wt-forge', 'wt list')
  assert.equal(r.mode, 'reuse')
  assert.ok(!r.path.includes('auth') && !r.path.includes('rule'))
  assert.ok(r.path.includes('channel'))
  assert.equal(nodeView(r, 'auth').status, 'skipped')
  assert.equal(a.getSnapshot().context.masters.length, 1)
})

test('shared: wt-forge then forge → forge inherits forced command', () => {
  const a = fresh({ type: 'SET_MUX', mux: 'shared' })
  request(a, 'wt-forge', 'wt list')
  const r = request(a, 'forge', 'uptime')
  assert.equal(r.intendedKey, 'yubikey')
  assert.equal(r.actualKey, 'gate-key')
  assert.equal(r.policy?.kind, 'forced')
  assert.equal(r.outcome?.kind, 'denied')
})

test('shared: forge then wt-forge → second request bypasses gate', () => {
  const a = fresh({ type: 'SET_MUX', mux: 'shared' })
  request(a, 'forge', 'uptime')
  const r = request(a, 'wt-forge', 'cat /etc/hostname')
  assert.equal(r.intendedKey, 'gate-key')
  assert.equal(r.actualKey, 'yubikey')
  assert.equal(r.policy?.kind, 'none')
  assert.ok(!r.path.includes('gate'))
  assert.equal(r.outcome?.kind, 'executed')
})

test('per-alias: two independent masters', () => {
  const a = fresh()
  const r1 = request(a, 'wt-forge', 'wt list')
  const r2 = request(a, 'forge', 'uptime')
  assert.equal(r1.mode, 'new')
  assert.equal(r2.mode, 'new')
  const alive = a.getSnapshot().context.masters.filter((m) => m.status === 'alive')
  assert.deepEqual(alive.map((m) => m.controlPath).sort(), ['~/.ssh/cm-forge', '~/.ssh/cm-wt-forge'])
  assert.equal(request(a, 'wt-forge', 'wt list').connectionId, r1.connectionId)
})

test('mux off: no masters, always new auth', () => {
  const a = fresh({ type: 'SET_MUX', mux: 'off' })
  request(a, 'wt-forge', 'wt list')
  assert.equal(request(a, 'wt-forge', 'wt list').mode, 'new')
  assert.equal(a.getSnapshot().context.masters.length, 0)
})

test('ControlPersist expiry and manual close force re-authentication', () => {
  const a = fresh()
  request(a, 'wt-forge', 'wt list')
  a.send({ type: 'ADVANCE_TIME', ms: 11 * 60_000 })
  assert.equal(a.getSnapshot().context.masters[0].status, 'expired')
  assert.equal(request(a, 'wt-forge', 'wt list').mode, 'new')
  const id = a.getSnapshot().context.masters[1].id
  a.send({ type: 'CLOSE_MASTER', id })
  assert.equal(a.getSnapshot().context.masters[1].status, 'closed')
  assert.equal(request(a, 'wt-forge', 'wt list').mode, 'new')
})

test('YubiKey touch timeout fails auth, no master', () => {
  const a = fresh()
  const r = request(a, 'forge', 'uptime', false)
  assert.equal(r.outcome?.kind, 'auth-failed')
  assert.equal(nodeView(r, 'auth').status, 'failed')
  assert.equal(a.getSnapshot().context.masters.length, 0)
})

test('YubiKey with touch executes without gate; empty command = interactive shell', () => {
  const a = fresh()
  assert.equal(request(a, 'forge', 'uptime').outcome?.kind, 'executed')
  assert.equal(request(a, 'forge', '').outcome?.kind, 'interactive-shell')
})

test('changing settings does not alter past runs or environment', () => {
  const a = fresh()
  const r1 = request(a, 'wt-forge', 'wt list')
  const before = JSON.stringify(a.getSnapshot().context.runs[0])
  const masters = JSON.stringify(a.getSnapshot().context.masters)
  a.send({ type: 'SET_ALIAS', alias: 'forge' })
  a.send({ type: 'SET_COMMAND', command: 'x' })
  a.send({ type: 'SET_MUX', mux: 'shared' })
  a.send({ type: 'SET_SERVER_PROFILE', profileId: 'deploy' })
  assert.equal(JSON.stringify(a.getSnapshot().context.runs[0]), before)
  assert.equal(JSON.stringify(a.getSnapshot().context.masters), masters)
  assert.equal(r1.settings.alias, 'wt-forge')
})

test('server profile change applies to new connections only', () => {
  const a = fresh()
  request(a, 'wt-forge', 'wt list')
  a.send({ type: 'SET_SERVER_PROFILE', profileId: 'backup' })
  const reuse = request(a, 'wt-forge', 'wt list')
  assert.equal(reuse.policy?.kind === 'forced' && reuse.policy.profileId, 'wt')
  assert.equal(reuse.outcome?.kind, 'dispatched')
  a.send({ type: 'CLOSE_MASTER', id: reuse.connectionId! })
  const fresh2 = request(a, 'wt-forge', 'wt list')
  assert.equal(fresh2.policy?.kind === 'forced' && fresh2.policy.profileId, 'backup')
  assert.equal(fresh2.outcome?.kind, 'denied')
})

test('cannot close a master while a run uses it; reset clears everything', () => {
  const a = fresh()
  request(a, 'wt-forge', 'wt list')
  a.send({ type: 'RUN' })
  for (let i = 0; i < 3; i++) a.send({ type: 'STEP' }) // into channel
  const m = a.getSnapshot().context.masters[0]
  assert.equal(m.inUseBy, 'r2')
  a.send({ type: 'CLOSE_MASTER', id: m.id })
  assert.equal(a.getSnapshot().context.masters[0].status, 'alive')
  a.send({ type: 'RESET_ENV' })
  const c = a.getSnapshot().context
  assert.ok(a.getSnapshot().matches('idle'))
  assert.equal(c.masters.length + c.runs.length + c.now, 0)
})

test('step-by-step and autoplay produce identical traces (same events)', () => {
  // Autoplay = the same STEP events at intervals; replay scenarios twice and compare
  for (const sc of SCENARIOS) {
    const play = () => {
      const a = setup(sc)
      for (const rq of sc.requests) {
        rq.before?.forEach((e) => a.send(e))
        request(a, rq.alias, rq.command, rq.touch ?? false)
      }
      return JSON.stringify(a.getSnapshot().context)
    }
    assert.equal(play(), play(), sc.id)
  }
})

test('scenario outcomes', () => {
  const outcomes = (id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id)!
    const a = setup(sc)
    return sc.requests.map((rq) => {
      rq.before?.forEach((e) => a.send(e))
      const r = request(a, rq.alias, rq.command, rq.touch ?? false)
      return `${r.mode}:${r.outcome?.kind}`
    })
  }
  assert.deepEqual(outcomes('gate-ok'), ['new:dispatched'])
  assert.deepEqual(outcomes('gate-deny'), ['new:denied'])
  assert.deepEqual(outcomes('yubikey'), ['new:executed'])
  assert.deepEqual(outcomes('timeout'), ['new:auth-failed'])
  assert.deepEqual(outcomes('shared-restricted-first'), ['new:dispatched', 'reuse:denied'])
  assert.deepEqual(outcomes('shared-yubikey-first'), ['new:executed', 'reuse:executed'])
  assert.deepEqual(outcomes('per-alias'), ['new:dispatched', 'new:executed', 'reuse:dispatched'])
  assert.deepEqual(outcomes('expire'), ['new:dispatched', 'new:dispatched'])
  assert.deepEqual(outcomes('percent-c'), ['new:dispatched', 'reuse:denied'])
  assert.deepEqual(outcomes('force-command'), ['new:denied', 'new:denied'])
  assert.deepEqual(outcomes('identities-only'), ['new:executed'])
})

/* ---------- config files ---------- */

test('ssh_config: first value wins, IdentityFile accumulates, %n/%C expansion', () => {
  const cfg = parseSshConfig('Host wt-*\n  User early\n  IdentityFile ~/.ssh/id_ed25519_gate\nHost wt-forge\n  HostName forge.lan\n  User forge\n  ControlPath ~/.ssh/cm-%n\nHost *\n  IdentityFile ~/.ssh/id_ed25519\n  ForwardAgent yes\n')
  const h = resolveHost(cfg, 'wt-forge')
  assert.equal(h.user, 'early')
  assert.deepEqual(h.identityFiles, ['~/.ssh/id_ed25519_gate', '~/.ssh/id_ed25519'])
  assert.equal(h.controlPath, '~/.ssh/cm-wt-forge')
  assert.ok(cfg.diags.some((d) => d.level === 'warn' && d.msg.startsWith('ForwardAgent')))
  const c = parseSshConfig('Host a b\n  HostName forge.lan\n  User forge\n  ControlPath ~/.ssh/%C\n')
  assert.equal(resolveHost(c, 'a').controlPath, resolveHost(c, 'b').controlPath)
})

test('ssh_config: IdentitiesOnly no adds agent key first', () => {
  const h = resolveHost(parseSshConfig('Host x\n  IdentityFile ~/.ssh/id_ed25519_gate\n'), 'x')
  assert.deepEqual(offeredKeys(h).map((o) => o.keyId), ['laptop', 'gate-key'])
})

test('authorized_keys: options, restrict, unknown option drops line', () => {
  const ak = parseAuthorizedKeys('restrict,command="/x y" ssh-ed25519 AAAAgatekey01 c\nbogus ssh-ed25519 AAAAlaptop01\n')
  assert.equal(ak.entries.length, 1)
  assert.equal(ak.entries[0].command, '/x y')
  assert.ok(ak.entries[0].restrictions.includes('no-pty'))
  assert.ok(ak.diags.some((d) => d.line === 2 && d.level === 'error'))
})

test('authorized_keys from= rejects key, sshd AllowUsers / Match ForceCommand', () => {
  const a = fresh({ type: 'SET_FILE', file: 'authorizedKeys', text: 'from="10.0.0.*",command="/home/forge/bin/wt-gate" ssh-ed25519 AAAAgatekey01 c\n' })
  assert.equal(request(a, 'wt-forge', 'wt list').outcome?.kind, 'auth-failed')
  const eff = effectiveSshd(parseSshd('AllowUsers root\nMatch User forge\n  ForceCommand /bin/true\n'), 'forge')
  assert.equal(eff.userAllowed.ok, false)
  assert.equal(eff.forceCommand?.cmd, '/bin/true')
})

test('gates DSL: edited allowlist applies to reused master too', () => {
  const g = parseGates(defaultFiles().gates)
  assert.deepEqual(g.gates.map((x) => x.id), ['wt', 'backup', 'deploy'])
  const a = fresh()
  assert.equal(request(a, 'wt-forge', 'wt status').outcome?.kind, 'denied')
  a.send({ type: 'SET_FILE', file: 'gates', text: defaultFiles().gates.replace('allow wt drop', 'allow wt drop\n  allow wt status') })
  const r = request(a, 'wt-forge', 'wt status')
  assert.equal(r.mode, 'reuse')
  assert.equal(r.outcome?.kind, 'dispatched')
})

test('ControlPersist no closes master with the session; ControlMaster no never creates one', () => {
  const a = fresh({ type: 'SET_FILE', file: 'sshConfig', text: defaultFiles().sshConfig.replaceAll('ControlPersist 10m', 'ControlPersist no') })
  request(a, 'wt-forge', 'wt list')
  assert.equal(a.getSnapshot().context.masters[0].status, 'closed')
  const b = fresh({ type: 'SET_FILE', file: 'sshConfig', text: defaultFiles().sshConfig.replaceAll('ControlMaster auto', 'ControlMaster no') })
  request(b, 'wt-forge', 'wt list')
  assert.equal(b.getSnapshot().context.masters.length, 0)
})
