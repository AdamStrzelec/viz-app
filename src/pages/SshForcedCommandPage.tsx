import { useState } from 'react'
import { useMachine } from '@xstate/react'
import { Example } from '../components/Example'
import { ALIAS_KEY, checkGate, PROFILES, reusableSocket, sshMachine, type Alias } from '../machines/ssh.machine'

const STAGES = [
  { id: 'client', label: 'Mac (klient ssh)', sub: '~/.ssh/config → alias' },
  { id: 'auth', label: 'Uwierzytelnienie', sub: 'YubiKey / klucz / gniazdo' },
  { id: 'sshd', label: 'sshd + authorized_keys', sub: 'dobór linii po kluczu' },
  { id: 'gate', label: 'forced command', sub: 'gate: allowlist + regex' },
  { id: 'exec', label: 'Wykonanie', sub: 'stdout + exit code' },
] as const

// Which pipeline stage is lit for each machine state
const STAGE_OF: Record<string, (typeof STAGES)[number]['id']> = {
  idle: 'client',
  connecting: 'auth',
  awaitingTouch: 'auth',
  handshake: 'auth',
  routing: 'sshd',
  gate: 'gate',
  executing: 'exec',
  done: 'exec',
  denied: 'gate',
  failed: 'auth',
}

function Simulator() {
  const [snapshot, send] = useMachine(sshMachine)
  const ctx = snapshot.context
  const state = String(snapshot.value)
  const profile = PROFILES.find((p) => p.id === ctx.profileId)!
  const busy = !['idle', 'done', 'denied', 'failed'].includes(state)
  const activeStage = STAGE_OF[state]
  const willReuse = reusableSocket(ctx)
  const skipped = (id: string) => (id === 'gate' && ctx.session?.key === 'yubikey') || (id === 'auth' && ctx.reused)

  const configText = `Host forge
    HostName adres.hosta
    User forge
    # YubiKey (sk-ssh-ed25519)${ctx.controlMaster ? `\n    ControlMaster auto\n    ControlPath ${ctx.controlPath === 'shared' ? '~/.ssh/cm-%r@%h:%p' : '~/.ssh/cm-%n'}\n    ControlPersist 10m` : ''}

Host wt-forge
    HostName adres.hosta
    User forge
    IdentityFile ~/.ssh/id_ed25519_gate
    IdentitiesOnly yes${ctx.controlMaster ? `\n    ControlMaster auto\n    ControlPath ${ctx.controlPath === 'shared' ? '~/.ssh/cm-%r@%h:%p' : '~/.ssh/cm-%n'}\n    ControlPersist 10m` : ''}`

  return (
    <Example
      wide
      className="ssh-simulator"
      title="Symulator połączenia ssh"
      description="Dwa aliasy, ten sam użytkownik forge. Klucz, którym się uwierzytelnisz, wybiera linię w authorized_keys: YubiKey daje pełny shell, klucz ograniczony zawsze trafia do gate. Spróbuj ControlPath współdzielonego: najpierw wt-forge, potem forge."
      state={{ value: snapshot.value, socket: ctx.socket, session: ctx.session, reused: ctx.reused }}
    >
      <div className="ssh-settings">
        <div className="ssh-row">
          <span className="ssh-key">alias</span>
          {(['forge', 'wt-forge'] as Alias[]).map((a) => (
            <button key={a} className={`chip${ctx.alias === a ? ' selected' : ''}`} disabled={busy} onClick={() => send({ type: 'SET_ALIAS', alias: a })}>
              ssh {a} <small>({ALIAS_KEY[a]})</small>
            </button>
          ))}
        </div>
        <div className="ssh-row">
          <span className="ssh-key">gate</span>
          {PROFILES.map((p) => (
            <button key={p.id} className={`chip${ctx.profileId === p.id ? ' selected' : ''}`} disabled={busy} onClick={() => send({ type: 'SET_PROFILE', profileId: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="ssh-row">
          <span className="ssh-key">mux</span>
          <label>
            <input type="checkbox" checked={ctx.controlMaster} disabled={busy} onChange={() => send({ type: 'TOGGLE_CONTROL_MASTER' })} /> ControlMaster
          </label>
          <button className={`chip${ctx.controlPath === 'per-alias' ? ' selected' : ''}`} disabled={busy || !ctx.controlMaster} onClick={() => send({ type: 'SET_CONTROL_PATH', mode: 'per-alias' })}>
            cm-%n (per alias)
          </button>
          <button className={`chip${ctx.controlPath === 'shared' ? ' selected' : ''}`} disabled={busy || !ctx.controlMaster} onClick={() => send({ type: 'SET_CONTROL_PATH', mode: 'shared' })}>
            cm-%r@%h:%p (współdzielone)
          </button>
        </div>
        <div className="ssh-row">
          <span className="ssh-key ssh-key-cmd">cmd</span>
          <input value={ctx.command} disabled={busy} onChange={(e) => send({ type: 'SET_COMMAND', command: e.target.value })} aria-label="Komenda" />
          <button disabled={busy} onClick={() => send({ type: 'RUN' })}>Uruchom</button>
        </div>
        <div className="ssh-row">
          <span className="ssh-key" />
          {profile.examples.map((ex) => (
            <button key={ex} className="chip" disabled={busy} onClick={() => send({ type: 'SET_COMMAND', command: ex })}>{ex}</button>
          ))}
        </div>
      </div>

      <code className="ssh-cmdline">$ ssh {ctx.alias} '{ctx.command}'</code>

      <ol className="ssh-pipeline" aria-label="Etapy połączenia">
        {STAGES.map((s) => {
          const failed = (state === 'denied' && s.id === 'gate') || (state === 'failed' && s.id === 'auth')
          const cls = ['ssh-stage', activeStage === s.id && 'active', failed && 'failed', skipped(s.id) && 'skipped'].filter(Boolean).join(' ')
          return (
            <li key={s.id} className={cls}>
              <strong>{s.label}</strong>
              <span>{s.sub}</span>
              {s.id === 'auth' && state === 'awaitingTouch' && (
                <button className="ssh-touch" onClick={() => send({ type: 'TOUCH' })}>🔑 Dotknij YubiKey</button>
              )}
              {s.id === 'auth' && ctx.reused && <em>reuse gniazda</em>}
              {s.id === 'gate' && ctx.session?.key === 'yubikey' && <em>pominięte — shell</em>}
            </li>
          )
        })}
      </ol>

      <div className="ssh-socket">
        <span className={`badge ${ctx.socket ? 'ok' : ''}`}>
          {ctx.socket ? `gniazdo otwarte: ${ctx.controlPath === 'shared' ? 'cm-forge@adres.hosta:22' : `cm-${ctx.socket.alias}`} (klucz ${ctx.socket.key})` : 'brak gniazda ControlMaster'}
        </span>
        {willReuse && !busy && (
          <span className={`badge ${willReuse.alias !== ctx.alias ? 'no' : 'ok'}`}>
            {willReuse.alias !== ctx.alias ? `ssh ${ctx.alias} wejdzie w gniazdo ${willReuse.alias}!` : 'następne ssh bez auth'}
          </span>
        )}
        <button className="chip" disabled={!ctx.socket || busy} onClick={() => send({ type: 'EXPIRE_SOCKET' })}>minęło 10 min</button>
      </div>

      <div className="ssh-files">
        <div>
          <span className="ssh-file-label">~/.ssh/config (Mac)</span>
          <pre>{configText}</pre>
        </div>
        <div>
          <span className="ssh-file-label">~forge/.ssh/authorized_keys (host)</span>
          <pre className="ssh-keys">
            <span className={ctx.session?.key === 'yubikey' ? 'hit' : ''}>sk-ssh-ed25519@openssh.com AAAA… yubikey</span>
            {'\n'}
            <span className={ctx.session?.key === 'restricted' ? 'hit' : ''}>
              command="/home/forge/bin/{profile.id}-gate",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… {profile.id}-only
            </span>
          </pre>
        </div>
      </div>

      {ctx.gate && (
        <ul className="ssh-steps">
          {ctx.gate.steps.map((st) => (
            <li key={st.label} className={st.ok ? 'ok' : 'no'}>
              <code>{st.label}</code> {st.detail}
            </li>
          ))}
        </ul>
      )}
      {ctx.output && <pre className={state === 'denied' || state === 'failed' ? 'ssh-out bad' : 'ssh-out'}>{ctx.output}</pre>}
      <ol className="history">
        {ctx.log.map((l, i) => (
          <li key={i} className={l.includes('UWAGA') ? 'rejected' : ''}>{l}</li>
        ))}
      </ol>
    </Example>
  )
}

function GateTester() {
  const [profileId, setProfileId] = useState('backup')
  const [command, setCommand] = useState('backup run daily')
  const profile = PROFILES.find((p) => p.id === profileId)!
  const result = checkGate(profile, command)

  const script = `#!/usr/bin/env bash
set -euo pipefail
cd ${profile.repo}
read -r -a args <<< "\${SSH_ORIGINAL_COMMAND:-}"
case "\${args[0]:-} \${args[1]:-}" in
  ${profile.allowed.map((a) => `"${a}"`).join('|')}) ;;
  *) echo "denied" >&2; exit 1 ;;
esac
for a in "\${args[@]}"; do [[ $a =~ ^[a-zA-Z0-9._/-]+$ ]] || { echo "bad arg" >&2; exit 1; }; done
exec ${profile.binary} "\${args[@]:1}"`

  return (
    <Example
      title="Gate dla dowolnego zestawu komend"
      description="Ten sam szablon, inna lista. Zmieniasz tylko katalog, binarkę i allowlistę. Wpisz komendę i zobacz, na którym kroku odpada."
      state={{ SSH_ORIGINAL_COMMAND: command, allowed: result.allowed }}
    >
      <div className="ssh-row">
        {PROFILES.map((p) => (
          <button key={p.id} className={`chip${profileId === p.id ? ' selected' : ''}`} onClick={() => { setProfileId(p.id); setCommand(p.examples[0]) }}>
            {p.label}
          </button>
        ))}
      </div>
      <input value={command} onChange={(e) => setCommand(e.target.value)} aria-label="SSH_ORIGINAL_COMMAND" />
      <div className="ssh-row">
        {profile.examples.map((ex) => (
          <button key={ex} className="chip" onClick={() => setCommand(ex)}>{ex}</button>
        ))}
      </div>
      <ul className="ssh-steps">
        {result.steps.map((st, i) => (
          <li key={st.label} className={[st.ok ? 'ok' : 'no', i === 0 && 'ssh-step-first'].filter(Boolean).join(' ')}><code>{st.label}</code> {st.detail}</li>
        ))}
      </ul>
      <span className={`badge ${result.allowed ? 'ok' : 'no'}`}>{result.allowed ? 'przepuszczone' : 'odrzucone, exit 1'}</span>
      <pre className="ssh-script">{script}</pre>
    </Example>
  )
}

function Direction() {
  return (
    <Example
      title="Kierunek: kto wykonuje u kogo"
      description="Klucz prywatny = klient, który wysyła komendy. authorized_keys = serwer, który je wykonuje. Odwrotny kierunek to osobna, niezależna konfiguracja."
      state={null}
    >
      <div className="ssh-direction">
        <div className="ssh-box">Twój Mac<small>klucz prywatny / YubiKey</small></div>
        <div className="ssh-arrow">ssh ──►</div>
        <div className="ssh-box">forge@host<small>authorized_keys + gate</small></div>
      </div>
      <div className="ssh-direction off">
        <div className="ssh-box">Twój Mac<small>Logowanie zdalne + własny gate</small></div>
        <div className="ssh-arrow">◄── ssh</div>
        <div className="ssh-box">forge@host<small>własny klucz, NAT ⇒ Tailscale / ssh -R</small></div>
      </div>
    </Example>
  )
}

export default function SshForcedCommandPage() {
  return (
    <>
      <Simulator />
      <GateTester />
      <Direction />
    </>
  )
}
