/* Pure SSH lab domain: no React, no XState. Everything here is a simulation model. */

import { DEFAULT_ARG_PATTERN, KEYS, gatesText, type GateProfile } from './config.ts'
export * from './config.ts'

export type Alias = string
export type KeyId = string
// Presets for ~/.ssh/config: shared = cm-%r@%h:%p, per-alias = cm-%n, off = ControlPath none
export type MuxMode = 'shared' | 'per-alias' | 'off'

export const HOST = 'forge.lan'
export const USER = 'forge'
export const PORT = 22
export const TOUCH_TIMEOUT_MS = 30_000
export const STEP_MS = 1_000
export const TOUCH_WAIT_STEP_MS = 5_000

export const MUX_LABEL: Record<MuxMode, string> = {
  'per-alias': 'ControlPath ~/.ssh/cm-%n (osobno per alias)',
  shared: 'ControlPath ~/.ssh/cm-%r@%h:%p (współdzielone)',
  off: 'ControlPath none (bez multiplexingu)',
}

/* ---------- Gate profiles ---------- */

export const PROFILES: GateProfile[] = [
  {
    id: 'wt',
    path: '/home/forge/bin/wt-gate',
    argPattern: DEFAULT_ARG_PATTERN,
    label: 'wt (worktrees)',
    repo: '/home/forge/repo',
    binary: '~/.local/bin/wt',
    allowed: ['wt list', 'wt new', 'wt drop'],
    examples: ['wt list --porcelain', 'wt new feature-x', 'wt new "x; rm -rf ~"', 'wt drop ../../etc', 'rm -rf ~'],
  },
  {
    id: 'backup',
    path: '/home/forge/bin/backup-gate',
    argPattern: DEFAULT_ARG_PATTERN,
    label: 'backup (restic)',
    repo: '/srv/backup',
    binary: '/usr/local/bin/backup',
    allowed: ['backup run', 'backup status'],
    examples: ['backup status', 'backup run daily', 'backup run --all', 'backup prune --all', 'cat /etc/shadow'],
  },
  {
    id: 'deploy',
    path: '/home/forge/bin/deploy-gate',
    argPattern: DEFAULT_ARG_PATTERN,
    label: 'deploy (aplikacja)',
    repo: '/srv/app',
    binary: '/srv/app/bin/deploy',
    allowed: ['deploy release', 'deploy rollback', 'deploy logs'],
    examples: ['deploy release v1.4.2', 'deploy logs api', 'deploy release $(whoami)', 'bash -i'],
  },
]

export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[0]

export const PROFILE_EXAMPLES = Object.fromEntries(PROFILES.map((p) => [p.id, p.examples]))

/* ---------- Tokenizer: models `read -r -a args <<< "$SSH_ORIGINAL_COMMAND"` ---------- */

export type Tokenized = { firstLine: string; dropped: string[]; tokens: string[] }

// read reads ONE line; default IFS splits on space/tab (newline ends the line). No quote handling, no globbing.
export function tokenize(raw: string): Tokenized {
  const [firstLine, ...dropped] = raw.split('\n')
  return { firstLine, dropped, tokens: firstLine.split(/[ \t]+/).filter(Boolean) }
}

/* ---------- Gate trace: every step the script performs, in order ---------- */

export type GateStepStatus = 'ok' | 'fail' | 'info' | 'warn'
export type GateStep = { id: string; label: string; status: GateStepStatus; detail: string; tokenIndex?: number[] }
export type GateTrace = {
  profileId: string
  raw: string
  tokens: string[]
  dropped: string[]
  steps: GateStep[]
  allowed: boolean
  failedStep: GateStep | null
  argv: string[] | null
  warnings: { token: string; note: string }[]
}

function semanticWarnings(tokens: string[]) {
  const out: { token: string; note: string }[] = []
  for (const t of tokens.slice(1)) {
    if (t.startsWith('-')) out.push({ token: t, note: 'zaczyna się od „-”: program potraktuje to jako opcję, regex tego nie blokuje' })
    if (t.includes('..')) out.push({ token: t, note: 'zawiera „..”: może wskazać katalog poza repozytorium' })
    if (t.startsWith('/')) out.push({ token: t, note: 'ścieżka absolutna: regex dopuszcza dowolne miejsce w systemie plików' })
  }
  return out
}

export function traceGate(profile: GateProfile, raw: string): GateTrace {
  const { tokens, dropped } = tokenize(raw)
  const steps: GateStep[] = [
    { id: 'cwd', label: 'cd', status: 'info', detail: `cd ${profile.repo} — zawsze ten sam katalog, niezależnie od klienta` },
    dropped.length
      ? { id: 'raw', label: 'SSH_ORIGINAL_COMMAND', status: 'warn', detail: `read -r czyta tylko pierwszą linię. Pominięte linie: ${dropped.map((d) => JSON.stringify(d)).join(', ')}` }
      : { id: 'raw', label: 'SSH_ORIGINAL_COMMAND', status: 'info', detail: raw === '' ? '(puste — klient nie podał komendy)' : JSON.stringify(raw) },
    { id: 'tokens', label: 'tokeny', status: 'info', detail: tokens.length ? `${tokens.length} ${tokenWord(tokens.length)} (podział po spacji/tab, cudzysłowy nie są interpretowane)` : 'brak tokenów' },
  ]
  const fail = (step: GateStep): GateTrace => ({ profileId: profile.id, raw, tokens, dropped, steps: [...steps, step], allowed: false, failedStep: step, argv: null, warnings: semanticWarnings(tokens) })

  // Same as bash: "${args[0]:-} ${args[1]:-}" (single space, no trimming)
  const pair = `${tokens[0] ?? ''} ${tokens[1] ?? ''}`
  const listed = profile.allowed.includes(pair)
  const pairStep: GateStep = {
    id: 'pair',
    label: 'allowlista',
    status: listed ? 'ok' : 'fail',
    detail: listed ? `para "${pair}" jest na liście` : `para "${pair.trim() || '(pusto)'}" nie należy do {${profile.allowed.join(', ')}} → echo denied, exit 1`,
    tokenIndex: [0, 1].filter((i) => i < tokens.length),
  }
  if (!listed) return fail(pairStep)
  steps.push(pairStep)

  const re = new RegExp(profile.argPattern)
  for (let i = 0; i < tokens.length; i++) {
    const ok = re.test(tokens[i])
    const step: GateStep = {
      id: `arg-${i}`,
      label: `args[${i}]`,
      status: ok ? 'ok' : 'fail',
      detail: ok ? `"${tokens[i]}" pasuje do ${profile.argPattern}` : `"${tokens[i]}" nie pasuje do ${profile.argPattern} → echo bad arg, exit 1`,
      tokenIndex: [i],
    }
    if (!ok) return fail(step)
    steps.push(step)
  }

  const argv = [profile.binary, ...tokens.slice(1)]
  steps.push({ id: 'argv', label: 'argv', status: 'info', detail: JSON.stringify(argv) })
  steps.push({ id: 'dispatch', label: 'exec', status: 'ok', detail: `exec ${argv.join(' ')} — dopuszczone przez reguły demonstratora (nic nie zostało uruchomione)` })
  return { profileId: profile.id, raw, tokens, dropped, steps, allowed: true, failedStep: null, argv, warnings: semanticWarnings(tokens) }
}

/* ---------- Policy and masters ---------- */

export type Policy =
  | { kind: 'forced'; profileId: string; forcedCommand: string; source: 'authorized_keys' | 'sshd_config'; restrictions: string[] }
  | { kind: 'none'; restrictions: string[] }

export const RESTRICTIONS = ['no-pty', 'no-port-forwarding', 'no-agent-forwarding', 'no-X11-forwarding']
export const gateIdFromPath = (cmd: string) => cmd.split(/\s+/)[0].split('/').pop()!.replace(/-gate$/, '')

export type MasterStatus = 'alive' | 'closed' | 'expired'
export type Master = {
  id: string
  controlPath: string
  createdBy: Alias
  createdByRun: string
  key: KeyId
  policy: Policy
  openedAt: number
  inUseBy: string | null // runId currently holding a session channel
  persistMs: number | null // ControlPersist frozen at creation; null = forever
  expiresAt: number | null // countdown starts when the last session ends
  status: MasterStatus
  endedAt: number | null
}

export function findMaster(masters: Master[], controlPath: string | null): Master | null {
  if (!controlPath) return null
  return masters.find((m) => m.status === 'alive' && m.controlPath === controlPath) ?? null
}

export function expireMasters(masters: Master[], now: number): Master[] {
  return masters.map((m) =>
    m.status === 'alive' && m.inUseBy === null && m.expiresAt !== null && m.expiresAt <= now ? { ...m, status: 'expired', endedAt: m.expiresAt } : m,
  )
}

/* ---------- Default files and presets ---------- */

const key = (id: string) => KEYS.find((k) => k.id === id)!

export function sshConfigText(mux: MuxMode) {
  const mx = mux === 'off' ? '\n    ControlPath none' : `\n    ControlMaster auto\n    ControlPath ${mux === 'shared' ? '~/.ssh/cm-%r@%h:%p' : '~/.ssh/cm-%n'}\n    ControlPersist 10m`
  return `Host forge
    HostName ${HOST}
    User ${USER}
    # YubiKey: sk-ssh-ed25519, wymaga dotyku
    IdentityFile ${key('yubikey').file}
    IdentitiesOnly yes${mx}

Host wt-forge
    HostName ${HOST}
    User ${USER}
    IdentityFile ${key('gate-key').file}
    IdentitiesOnly yes${mx}
`
}

export function authorizedKeysText(profileId: string) {
  const y = key('yubikey'), g = key('gate-key')
  return `# ~forge/.ssh/authorized_keys
${y.type} ${y.blob} ${y.comment}
command="/home/forge/bin/${profileId}-gate",${RESTRICTIONS.join(',')} ${g.type} ${g.blob} ${profileId}-only
`
}

export const DEFAULT_SSHD = `# /etc/ssh/sshd_config (fragment)
PubkeyAuthentication yes
AllowUsers forge
`

export const DEFAULT_GATES = `# allowlisty skryptów gate (z tego powstaje bash poniżej)
${gatesText(PROFILES)}
`

export type Files = { sshConfig: string; authorizedKeys: string; sshdConfig: string; gates: string }
export const defaultFiles = (mux: MuxMode = 'per-alias', profileId = 'wt'): Files => ({
  sshConfig: sshConfigText(mux),
  authorizedKeys: authorizedKeysText(profileId),
  sshdConfig: DEFAULT_SSHD,
  gates: DEFAULT_GATES,
})

export function gateScriptText(profile: GateProfile) {
  return `#!/usr/bin/env bash
set -euo pipefail
cd ${profile.repo}
read -r -a args <<< "\${SSH_ORIGINAL_COMMAND:-}"
case "\${args[0]:-} \${args[1]:-}" in
  ${profile.allowed.map((a) => `"${a}"`).join('|')}) ;;
  *) echo "denied" >&2; exit 1 ;;
esac
for a in "\${args[@]}"; do [[ $a =~ ${profile.argPattern} ]] || { echo "bad arg" >&2; exit 1; }; done
exec ${profile.binary} "\${args[@]:1}"`
}

export const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `T+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Polish plural: 1 token, 2-4 tokeny, 5+ tokenów (12-14 → tokenów)
function tokenWord(n: number): string {
  if (n === 1) return 'token'
  const d = n % 10, t = n % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'tokeny' : 'tokenów'
}
