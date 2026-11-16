import { useState } from 'react'
import { Example } from '../components/Example'
import { PROFILES, gateScriptText, traceGate } from '../machines/ssh.machine'
import { GateXray, SshLab } from './ssh/SshLab'

function Simulator() {
  return (
    <Example
      wide
      className="ssh-simulator lab-example"
      title="Laboratorium: droga żądania ssh"
      description="Ten sam użytkownik forge, dwa aliasy. Alias wyraża intencję. O polityce decyduje klucz, którym uwierzytelniono połączenie: nowe albo istniejące, wspólne przez ControlMaster. Przechodź krok po kroku i obserwuj, co zostaje między uruchomieniami."
      state={null}
    >
      <SshLab />
    </Example>
  )
}

function GateTester() {
  const [profileId, setProfileId] = useState('backup')
  const [command, setCommand] = useState('backup run daily')
  const profile = PROFILES.find((p) => p.id === profileId)!
  const gate = traceGate(profile, command)

  return (
    <Example
      title="Gate dla dowolnego zestawu komend"
      description="Ten sam szablon, inna allowlista. Wpisz SSH_ORIGINAL_COMMAND i zobacz tokeny oraz krok, na którym gate odmawia. Enter w polu wstawia nową linię — sprawdź, co gate robi z resztą."
      state={null}
    >
      <div className="ssh-row">
        {PROFILES.map((p) => (
          <button key={p.id} type="button" className={`chip${profileId === p.id ? ' selected' : ''}`} aria-pressed={profileId === p.id} onClick={() => { setProfileId(p.id); setCommand(p.examples[0]) }}>
            {p.label}
          </button>
        ))}
      </div>
      <textarea className="lab-gate-input" rows={2} value={command} onChange={(e) => setCommand(e.target.value)} aria-label="SSH_ORIGINAL_COMMAND" spellCheck={false} />
      <div className="ssh-row">
        {[...profile.examples, `${profile.allowed[0]}\nrm -rf ~`].map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => setCommand(ex)}>{ex.replace('\n', '⏎')}</button>
        ))}
      </div>
      <GateXray gate={gate} cursor={gate.steps.length - 1} live={false} />
      <pre className="ssh-script">{gateScriptText(profile)}</pre>
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
        <div className="ssh-box">forge@host<small>własny klucz, NAT ⇒ Tailscale / <span style={{ whiteSpace: 'nowrap' }}>ssh -R</span></small></div>
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
