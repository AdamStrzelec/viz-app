import { assign, setup } from 'xstate'

/* ---------- Gate profiles: generic "forced command" allowlists ---------- */

export type GateProfile = {
  id: string
  label: string
  repo: string // fixed working directory the gate always cd's into
  binary: string // absolute path, ssh without TTY often has no PATH
  allowed: string[] // "<cmd> <subcommand>" pairs
  examples: string[]
}

export const PROFILES: GateProfile[] = [
  {
    id: 'wt',
    label: 'wt (worktrees)',
    repo: '/home/forge/repo',
    binary: '~/.local/bin/wt',
    allowed: ['wt list', 'wt new', 'wt drop'],
    examples: ['wt list --porcelain', 'wt new feature-x', 'wt new "x; rm -rf ~"', 'rm -rf ~'],
  },
  {
    id: 'backup',
    label: 'backup (restic)',
    repo: '/srv/backup',
    binary: '/usr/local/bin/backup',
    allowed: ['backup run', 'backup status'],
    examples: ['backup status', 'backup run daily', 'backup prune --all', 'cat /etc/shadow'],
  },
  {
    id: 'deploy',
    label: 'deploy (aplikacja)',
    repo: '/srv/app',
    binary: '/srv/app/bin/deploy',
    allowed: ['deploy release', 'deploy rollback', 'deploy logs'],
    examples: ['deploy release v1.4.2', 'deploy logs api', 'deploy release $(whoami)', 'bash -i'],
  },
]

export const ARG_PATTERN = /^[a-zA-Z0-9._/-]+$/

export type GateStep = { label: string; ok: boolean; detail: string }
export type GateResult = { allowed: boolean; steps: GateStep[]; exec: string | null }

// Mirrors the gate script: split on whitespace, check "<cmd> <sub>" against allowlist, validate every arg
export function checkGate(profile: GateProfile, original: string): GateResult {
  const args = original.trim().split(/\s+/).filter(Boolean)
  const steps: GateStep[] = [{ label: 'cd', ok: true, detail: `cd ${profile.repo} (zawsze, niezależnie od klienta)` }]
  const pair = `${args[0] ?? ''} ${args[1] ?? ''}`.trim()
  const listed = profile.allowed.includes(pair)
  steps.push({ label: 'allowlist', ok: listed, detail: listed ? `"${pair}" jest na liście` : `"${pair || '(pusto)'}" nie jest na liście → denied` })
  if (!listed) return { allowed: false, steps, exec: null }
  const bad = args.find((a) => !ARG_PATTERN.test(a))
  steps.push({ label: 'args', ok: !bad, detail: bad ? `argument ${bad} nie pasuje do ${ARG_PATTERN.source} → bad arg` : `wszystkie argumenty pasują do ${ARG_PATTERN.source}` })
  if (bad) return { allowed: false, steps, exec: null }
  const exec = `exec ${profile.binary} ${args.slice(1).join(' ')}`
  steps.push({ label: 'exec', ok: true, detail: exec })
  return { allowed: true, steps, exec }
}

/* ---------- Connection simulator ---------- */

export type Alias = 'forge' | 'wt-forge'
export type ControlPathMode = 'per-alias' | 'shared' // %n vs %r@%h:%p
export const ALIAS_KEY: Record<Alias, 'yubikey' | 'restricted'> = { forge: 'yubikey', 'wt-forge': 'restricted' }

type Socket = { alias: Alias; key: 'yubikey' | 'restricted' }

export type SshContext = {
  alias: Alias
  controlMaster: boolean
  controlPath: ControlPathMode
  profileId: string
  command: string
  socket: Socket | null
  session: Socket | null // which key the current command actually runs under
  reused: boolean
  gate: GateResult | null
  output: string
  log: string[]
}

export type SshEvent =
  | { type: 'SET_ALIAS'; alias: Alias }
  | { type: 'TOGGLE_CONTROL_MASTER' }
  | { type: 'SET_CONTROL_PATH'; mode: ControlPathMode }
  | { type: 'SET_PROFILE'; profileId: string }
  | { type: 'SET_COMMAND'; command: string }
  | { type: 'RUN' }
  | { type: 'TOUCH' }
  | { type: 'EXPIRE_SOCKET' }

const profileOf = (ctx: SshContext) => PROFILES.find((p) => p.id === ctx.profileId) ?? PROFILES[0]

// Returns the socket the client would reuse for the current alias, if any
export function reusableSocket(ctx: SshContext): Socket | null {
  if (!ctx.controlMaster || !ctx.socket) return null
  if (ctx.controlPath === 'shared') return ctx.socket // same user@host:port → same socket file
  return ctx.socket.alias === ctx.alias ? ctx.socket : null
}

const push = (ctx: SshContext, line: string) => [...ctx.log, line].slice(-12)

export const sshMachine = setup({
  types: { context: {} as SshContext, events: {} as SshEvent },
  guards: {
    canReuse: ({ context }) => reusableSocket(context) !== null,
    isYubiKey: ({ context }) => ALIAS_KEY[context.alias] === 'yubikey',
    sessionIsRestricted: ({ context }) => context.session?.key === 'restricted',
    gateAllows: ({ context }) => checkGate(profileOf(context), context.command).allowed,
  },
  actions: {
    openSession: assign(({ context }) => {
      const session: Socket = { alias: context.alias, key: ALIAS_KEY[context.alias] }
      return {
        session,
        reused: false,
        socket: context.controlMaster ? session : context.socket,
        log: push(context, `ssh ${context.alias}: handshake kluczem ${session.key}${context.controlMaster ? ', ControlMaster otwiera gniazdo' : ''}`),
      }
    }),
    reuseSession: assign(({ context }) => {
      const socket = reusableSocket(context)!
      const mismatch = socket.alias !== context.alias
      return {
        session: socket,
        reused: true,
        log: push(context, `ssh ${context.alias}: reuse gniazda (bez auth)${mismatch ? ` — UWAGA: gniazdo otworzył ${socket.alias} kluczem ${socket.key}!` : ''}`),
      }
    }),
    runGate: assign(({ context }) => {
      const gate = checkGate(profileOf(context), context.command)
      return { gate, output: gate.allowed ? `$ ${gate.exec}\nok (exit 0)` : `${gate.steps.at(-1)!.detail}\nexit 1`, log: push(context, `gate: ${gate.allowed ? 'przepuszczono' : 'odrzucono'} "${context.command}"`) }
    }),
    runShell: assign(({ context }) => ({ gate: null, output: `$ ${context.command}\n(pełny shell — wykonano dowolną komendę)`, log: push(context, `shell: ${context.command}`) })),
    clearRun: assign({ gate: null, output: '', session: null, reused: false }),
  },
}).createMachine({
  id: 'ssh',
  context: {
    alias: 'wt-forge',
    controlMaster: true,
    controlPath: 'per-alias',
    profileId: 'wt',
    command: 'wt new feature-x',
    socket: null,
    session: null,
    reused: false,
    gate: null,
    output: '',
    log: [],
  },
  on: {
    SET_ALIAS: { actions: assign({ alias: ({ event }) => event.alias }) },
    TOGGLE_CONTROL_MASTER: { actions: assign({ controlMaster: ({ context }) => !context.controlMaster, socket: null }) },
    SET_CONTROL_PATH: { actions: assign({ controlPath: ({ event }) => event.mode, socket: null }) },
    SET_PROFILE: { actions: assign({ profileId: ({ event }) => event.profileId, command: ({ event }) => PROFILES.find((p) => p.id === event.profileId)!.examples[0] }) },
    SET_COMMAND: { actions: assign({ command: ({ event }) => event.command }) },
    EXPIRE_SOCKET: { actions: assign({ socket: null, log: ({ context }) => push(context, 'ControlPersist minął — gniazdo zamknięte') }) },
  },
  initial: 'idle',
  states: {
    idle: { on: { RUN: { target: 'connecting', actions: 'clearRun' } } },
    connecting: {
      always: [
        { guard: 'canReuse', target: 'routing', actions: 'reuseSession' },
        { guard: 'isYubiKey', target: 'awaitingTouch' },
        { target: 'handshake' },
      ],
    },
    awaitingTouch: {
      on: { TOUCH: { target: 'routing', actions: 'openSession' } },
      after: { 10000: { target: 'failed', actions: assign({ output: 'sign_and_send_pubkey: signing failed (brak dotyku)', log: ({ context }) => push(context, 'YubiKey: timeout') }) } },
    },
    handshake: { after: { 700: { target: 'routing', actions: 'openSession' } } },
    // sshd picks the authorized_keys line by the key that authenticated the connection
    routing: {
      after: {
        700: [
          { guard: 'sessionIsRestricted', target: 'gate' },
          { target: 'executing', actions: 'runShell' },
        ],
      },
    },
    gate: {
      after: {
        700: [
          { guard: 'gateAllows', target: 'executing', actions: 'runGate' },
          { target: 'denied', actions: 'runGate' },
        ],
      },
    },
    executing: { after: { 600: 'done' } },
    done: { on: { RUN: { target: 'connecting', actions: 'clearRun' } } },
    denied: { on: { RUN: { target: 'connecting', actions: 'clearRun' } } },
    failed: { on: { RUN: { target: 'connecting', actions: 'clearRun' } } },
  },
})
