import { useState } from 'react'
import {
  KEYS,
  MUX_LABEL,
  PROFILES,
  PROFILE_EXAMPLES,
  authorizedKeysText,
  defaultFiles,
  effectiveSshd,
  gateScriptText,
  keyShort,
  offeredKeys,
  parseAuthorizedKeys,
  parseGates,
  parseSshConfig,
  parseSshd,
  resolveHost,
  sshConfigText,
  type Diag,
  type FileId,
  type Files,
  type MuxMode,
} from '../../machines/ssh.machine'

type Tab = { id: FileId; label: string; path: string; scope: string }
const TABS: Tab[] = [
  { id: 'sshConfig', label: '~/.ssh/config', path: 'Mac · ~/.ssh/config', scope: 'klient: czytany przy każdym uruchomieniu ssh' },
  { id: 'authorizedKeys', label: 'authorized_keys', path: 'forge.lan · ~forge/.ssh/authorized_keys', scope: 'serwer: tylko nowe połączenia (master trzyma starą politykę)' },
  { id: 'sshdConfig', label: 'sshd_config', path: 'forge.lan · /etc/ssh/sshd_config', scope: 'serwer: tylko nowe połączenia' },
  { id: 'gates', label: 'allowlista gate', path: 'forge.lan · /home/forge/bin/*-gate', scope: 'gate: czytany przy każdym wykonaniu, także w reuse' },
]

const MUX_PRESETS: MuxMode[] = ['per-alias', 'shared', 'off']

function Diagnostics({ diags }: { diags: Diag[] }) {
  if (!diags.length) return <p className="lab-cfg-ok">Parser: bez uwag.</p>
  return (
    <ul className="lab-cfg-diags" aria-label="Uwagi parsera">
      {[...diags].sort((a, b) => a.line - b.line).map((d, i) => (
        <li key={i} className={d.level}>
          <code>linia {d.line}</code> {d.msg}
        </li>
      ))}
    </ul>
  )
}

function SshConfigSummary({ text }: { text: string }) {
  const cfg = parseSshConfig(text)
  const hosts = cfg.aliases.map((a) => resolveHost(cfg, a))
  // Different aliases resolving to the same socket = shared master
  const clashes = hosts.flatMap((h, i) => hosts.slice(i + 1).filter((o) => h.controlPath && o.controlPath === h.controlPath).map((o) => [h, o] as const))
  return (
    <>
      <Diagnostics diags={cfg.diags} />
      {clashes.map(([a, b]) => (
        <p key={`${a.alias}-${b.alias}`} className="lab-cfg-alert">
          <code>{a.alias}</code> i <code>{b.alias}</code> rozwijają ControlPath do <code>{a.controlPath}</code>. Kto pierwszy otworzy master, ten wybierze klucz i politykę dla obu.
        </p>
      ))}
      <table className="lab-cfg-table">
        <thead>
          <tr><th>alias</th><th>cel</th><th>oferowane klucze</th><th>gniazdo (ControlPath)</th><th>master</th></tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.alias}>
              <td><code>{h.alias}</code></td>
              <td><code>{h.user}@{h.hostname}:{h.port}</code></td>
              <td>{offeredKeys(h).map((o) => `${keyShort(o.keyId)}${o.via === 'agent' ? ' (agent)' : ''}`).join(' → ') || '—'}</td>
              <td><code>{h.controlPath ?? 'brak'}</code></td>
              <td>{h.controlPath ? `${h.controlMaster}, persist ${h.persistMs === null ? 'yes' : h.persistMs === 0 ? 'no' : `${h.persistMs / 60000}m`}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function AuthorizedKeysSummary({ text }: { text: string }) {
  const ak = parseAuthorizedKeys(text)
  return (
    <>
      <Diagnostics diags={ak.diags} />
      <table className="lab-cfg-table">
        <thead>
          <tr><th>linia</th><th>klucz</th><th>forced command</th><th>ograniczenia</th></tr>
        </thead>
        <tbody>
          {ak.entries.map((e) => (
            <tr key={e.line}>
              <td>{e.line}</td>
              <td>{e.keyId ? keyShort(e.keyId) : <span className="lab-muted">obcy klucz</span>}</td>
              <td>{e.command ? <code>{e.command}</code> : <strong>brak — pełny dostęp</strong>}</td>
              <td>{[...e.restrictions, ...(e.from ? [`from=${e.from.join(',')}`] : [])].join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="lab-cfg-keys">
        <summary>Klucze publiczne na Macu (do wklejenia)</summary>
        <ul>
          {KEYS.map((k) => (
            <li key={k.id}>
              <code>{k.type} {k.blob} {k.comment}</code> <span className="lab-muted">{k.file}{k.inAgent ? ', załadowany w ssh-agent' : ''}{k.touch ? ', wymaga dotyku' : ''}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

function SshdSummary({ text }: { text: string }) {
  const p = parseSshd(text)
  const e = effectiveSshd(p, 'forge')
  return (
    <>
      <Diagnostics diags={p.diags} />
      <dl className="lab-cfg-eff">
        <div><dt>dla użytkownika forge</dt><dd>{e.userAllowed.ok ? 'logowanie dozwolone' : e.userAllowed.why}</dd></div>
        <div><dt>PubkeyAuthentication</dt><dd>{e.pubkey ? 'yes' : 'no — klucze nie zadziałają'}</dd></div>
        <div><dt>ForceCommand</dt><dd>{e.forceCommand ? <><code>{e.forceCommand.cmd}</code> (linia {e.forceCommand.line}), nadpisuje command= z authorized_keys</> : 'brak'}</dd></div>
        <div><dt>PermitTTY</dt><dd>{e.permitTTY ? 'yes' : 'no'}</dd></div>
        {e.matchedLines.length > 0 && <div><dt>Match</dt><dd>pasują bloki z linii {e.matchedLines.join(', ')}</dd></div>}
      </dl>
    </>
  )
}

function GatesSummary({ text }: { text: string }) {
  const g = parseGates(text, PROFILE_EXAMPLES)
  return (
    <>
      <Diagnostics diags={g.diags} />
      <p className="lab-muted">Format: <code>gate /ścieżka</code>, potem <code>cd</code>, <code>exec</code>, <code>allow &lt;komenda&gt; &lt;podkomenda&gt;</code>, <code>arg &lt;regex&gt;</code>. Z tego powstaje skrypt bash.</p>
      {g.gates.map((x) => (
        <details key={x.path} className="lab-cfg-keys">
          <summary><code>{x.path}</code>: {x.allowed.join(', ') || 'pusta allowlista'}</summary>
          <pre>{gateScriptText(x)}</pre>
        </details>
      ))}
    </>
  )
}

export function ConfigFiles({ files, disabled, send }: {
  files: Files
  disabled: boolean
  send: (e: { type: 'SET_FILE'; file: FileId; text: string } | { type: 'SET_MUX'; mux: MuxMode } | { type: 'SET_SERVER_PROFILE'; profileId: string }) => void
}) {
  const [tab, setTab] = useState<FileId>('sshConfig')
  const t = TABS.find((x) => x.id === tab)!
  const def = defaultFiles()
  const text = files[tab]
  return (
    <section className="lab-section lab-cfg" aria-label="Pliki konfiguracyjne">
      <h3>Pliki konfiguracyjne</h3>
      <div className="lab-cfg-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'selected' : ''} onClick={() => setTab(x.id)}>
            {x.label}{files[x.id] !== def[x.id] && <span className="lab-cfg-dot" title="zmieniony względem domyślnego"> •</span>}
          </button>
        ))}
      </div>
      <div className="lab-cfg-body" role="tabpanel">
        <div className="lab-cfg-edit">
          <div className="lab-cfg-head">
            <code>{t.path}</code>
            <span className="lab-muted">{t.scope}</span>
          </div>
          <textarea
            className="lab-cfg-text"
            value={text}
            onChange={(e) => send({ type: 'SET_FILE', file: tab, text: e.target.value })}
            readOnly={disabled}
            spellCheck={false}
            rows={Math.min(22, Math.max(8, text.split('\n').length + 1))}
            aria-label={`Edycja ${t.label}`}
          />
          <div className="lab-inline">
            {tab === 'sshConfig' && MUX_PRESETS.map((m) => (
              <button key={m} type="button" className={`chip${text === sshConfigText(m) ? ' selected' : ''}`} disabled={disabled} onClick={() => send({ type: 'SET_MUX', mux: m })}>{MUX_LABEL[m]}</button>
            ))}
            {tab === 'authorizedKeys' && PROFILES.map((p) => (
              <button key={p.id} type="button" className={`chip${text === authorizedKeysText(p.id) ? ' selected' : ''}`} disabled={disabled} onClick={() => send({ type: 'SET_SERVER_PROFILE', profileId: p.id })}>gate-key → {p.label}</button>
            ))}
            {text !== def[tab] && (
              <button type="button" disabled={disabled} onClick={() => send({ type: 'SET_FILE', file: tab, text: def[tab] })}>Przywróć domyślny</button>
            )}
          </div>
          {disabled && <p className="lab-muted">Przebieg trwa — edycja po zakończeniu.</p>}
        </div>
        <div className="lab-cfg-result" aria-live="polite">
          <span className="lab-muted">Co z tego wynika</span>
          {tab === 'sshConfig' && <SshConfigSummary text={text} />}
          {tab === 'authorizedKeys' && <AuthorizedKeysSummary text={text} />}
          {tab === 'sshdConfig' && <SshdSummary text={text} />}
          {tab === 'gates' && <GatesSummary text={text} />}
        </div>
      </div>
    </section>
  )
}
