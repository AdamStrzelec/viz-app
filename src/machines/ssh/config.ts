/* Parsers for the editable config files. Pure, no React/XState. Subset of OpenSSH semantics, documented per directive. */

export type DiagLevel = 'error' | 'warn' | 'info'
export type Diag = { line: number; level: DiagLevel; msg: string }

/* ---------- Keys that exist on the Mac (fixed inventory) ---------- */

export type KeyDef = { id: string; file: string; type: string; blob: string; comment: string; touch: boolean; short: string; inAgent: boolean }

export const KEYS: KeyDef[] = [
  { id: 'yubikey', file: '~/.ssh/id_ed25519_sk', type: 'sk-ssh-ed25519@openssh.com', blob: 'AAAAyubikey01', comment: 'yubikey', touch: true, short: 'YubiKey', inAgent: false },
  { id: 'gate-key', file: '~/.ssh/id_ed25519_gate', type: 'ssh-ed25519', blob: 'AAAAgatekey01', comment: 'gate-only', touch: false, short: 'id_ed25519_gate', inAgent: false },
  { id: 'laptop', file: '~/.ssh/id_ed25519', type: 'ssh-ed25519', blob: 'AAAAlaptop01', comment: 'me@mac', touch: false, short: 'id_ed25519', inAgent: true },
]
export const keyById = (id: string | null | undefined) => KEYS.find((k) => k.id === id) ?? null
export const keyShort = (id: string | null | undefined) => keyById(id)?.short ?? '—'
const keyByFile = (f: string) => KEYS.find((k) => k.file === f.replace(/^(\$HOME|%d)\//, '~/'))
const keyByBlob = (b: string) => KEYS.find((k) => k.blob === b)
// OpenSSH default identity order (only existing files matter here)
const DEFAULT_IDS = ['~/.ssh/id_rsa', '~/.ssh/id_ecdsa', '~/.ssh/id_ecdsa_sk', '~/.ssh/id_ed25519', '~/.ssh/id_ed25519_sk']

export const LOCAL = { host: 'mac', user: 'me', ip: '192.168.1.20' }
export const SERVER = { host: 'forge.lan', port: 22, users: ['forge'] }

/* ---------- Shared helpers ---------- */

type Line = { no: number; key: string; value: string; raw: string }

// "Key value" or "Key=value"; # comments; blank lines skipped
function lines(text: string): Line[] {
  const out: Line[] = []
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    const m = t.match(/^([A-Za-z]+)\s*(?:=\s*|\s+)(.*)$/) ?? t.match(/^([A-Za-z]+)()$/)
    out.push({ no: i + 1, key: (m?.[1] ?? t).toLowerCase(), value: (m?.[2] ?? '').trim().replace(/^"(.*)"$/, '$1'), raw: t })
  })
  return out
}

// ssh_config / sshd_config pattern list: * ? and !negation
export function matchPatterns(patterns: string[], value: string): boolean {
  const glob = (p: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
  let hit = false
  for (const p of patterns) {
    if (p.startsWith('!')) { if (glob(p.slice(1)).test(value)) return false }
    else if (glob(p).test(value)) hit = true
  }
  return hit
}

const yesNo = (v: string) => /^(yes|no)$/i.test(v)

function parseDuration(v: string): number | null {
  const m = v.match(/^(\d+)([smhdw]?)$/i)
  if (!m) return null
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2].toLowerCase() as '' | 's'] ?? 1
  return Number(m[1]) * mult * 1000
}

// Stand-in for %C (real: SHA1 of %l%h%p%r[%j]). Deterministic, NOT the real hash.
function pseudoHash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193
  for (const c of s) { a = Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0; b = Math.imul(b ^ c.charCodeAt(0), 2246822519) >>> 0 }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/* ---------- ~/.ssh/config ---------- */

type Block = { patterns: string[]; line: number; items: Line[]; isMatch: boolean }
export type ParsedSshConfig = { blocks: Block[]; diags: Diag[]; aliases: string[] }

const SSH_MODELED = ['hostname', 'user', 'port', 'identityfile', 'identitiesonly', 'controlmaster', 'controlpath', 'controlpersist']

export function parseSshConfig(text: string): ParsedSshConfig {
  const diags: Diag[] = []
  const blocks: Block[] = [{ patterns: ['*'], line: 0, items: [], isMatch: false }]
  for (const l of lines(text)) {
    if (l.key === 'host') {
      const patterns = l.value.split(/\s+/).filter(Boolean)
      if (!patterns.length) diags.push({ line: l.no, level: 'error', msg: 'Host bez wzorca' })
      blocks.push({ patterns, line: l.no, items: [], isMatch: false })
      continue
    }
    if (l.key === 'match') {
      diags.push({ line: l.no, level: 'warn', msg: 'Match nie jest modelowany — blok pominięty' })
      blocks.push({ patterns: [], line: l.no, items: [], isMatch: true })
      continue
    }
    const b = blocks.at(-1)!
    if (b.isMatch) continue
    if (!SSH_MODELED.includes(l.key)) { diags.push({ line: l.no, level: 'warn', msg: `${l.raw.split(/[\s=]/)[0]}: nie modelowane, ignoruję` }); continue }
    const v = l.value
    if (!v) { diags.push({ line: l.no, level: 'error', msg: `${l.key}: brak wartości` }); continue }
    if (l.key === 'port' && !/^\d+$/.test(v)) { diags.push({ line: l.no, level: 'error', msg: 'Port musi być liczbą' }); continue }
    if (l.key === 'identitiesonly' && !yesNo(v)) { diags.push({ line: l.no, level: 'error', msg: 'IdentitiesOnly: yes albo no' }); continue }
    if (l.key === 'controlmaster' && !/^(yes|no|auto|ask|autoask)$/i.test(v)) { diags.push({ line: l.no, level: 'error', msg: 'ControlMaster: yes, no, auto, ask, autoask' }); continue }
    if (l.key === 'controlpersist' && !/^(yes|no)$/i.test(v) && parseDuration(v) === null) { diags.push({ line: l.no, level: 'error', msg: 'ControlPersist: yes, no albo czas (np. 10m)' }); continue }
    if (l.key === 'identityfile' && !keyByFile(v)) diags.push({ line: l.no, level: 'warn', msg: `${v}: pliku nie ma na Macu — ssh go pominie` })
    if (l.key === 'controlpath' && v !== 'none' && /%[^nhrplCu%d]/.test(v)) diags.push({ line: l.no, level: 'warn', msg: 'nieobsługiwany token % w ControlPath' })
    b.items.push(l)
  }
  const aliases = [...new Set(blocks.flatMap((b) => b.patterns).filter((p) => !/[*?!]/.test(p)))]
  if (blocks.length > 1 && blocks[0].items.length) diags.push({ line: blocks[0].items[0].no, level: 'info', msg: 'opcje przed pierwszym Host dotyczą wszystkich hostów' })
  return { blocks, diags, aliases }
}

export type HostConfig = {
  alias: string
  hostname: string
  user: string
  port: number
  identityFiles: string[]
  identitiesOnly: boolean
  controlMaster: 'yes' | 'no' | 'auto'
  controlPathRaw: string | null
  controlPath: string | null
  persistMs: number | null // null = forever (ControlPersist yes); 0 = close with last session
  matchedLines: number[] // Host lines that applied
  source: Record<string, number> // directive -> line it came from
}

// First obtained value wins (ssh_config(5)); IdentityFile accumulates
export function resolveHost(cfg: ParsedSshConfig, alias: string): HostConfig {
  const got: Record<string, Line> = {}
  const ids: Line[] = []
  const matched: number[] = []
  for (const b of cfg.blocks) {
    if (b.isMatch || !matchPatterns(b.patterns, alias)) continue
    if (b.line) matched.push(b.line)
    for (const l of b.items) {
      if (l.key === 'identityfile') ids.push(l)
      else if (!got[l.key]) got[l.key] = l
    }
  }
  const v = (k: string) => got[k]?.value
  const cm = (v('controlmaster') ?? 'no').toLowerCase()
  const persistRaw = (v('controlpersist') ?? 'no').toLowerCase()
  const h: HostConfig = {
    alias,
    hostname: v('hostname')?.replace(/%h/g, alias) ?? alias,
    user: v('user') ?? LOCAL.user,
    port: Number(v('port') ?? 22),
    identityFiles: ids.map((l) => l.value),
    identitiesOnly: (v('identitiesonly') ?? 'no').toLowerCase() === 'yes',
    controlMaster: cm === 'no' ? 'no' : cm === 'yes' ? 'yes' : 'auto',
    controlPathRaw: v('controlpath') ?? null,
    controlPath: null,
    persistMs: persistRaw === 'no' ? 0 : persistRaw === 'yes' ? null : parseDuration(persistRaw) ?? 0,
    matchedLines: matched,
    source: Object.fromEntries([...Object.entries(got).map(([k, l]) => [k, l.no]), ...(ids[0] ? [['identityfile', ids[0].no]] : [])]),
  }
  h.controlPath = expandControlPath(h)
  return h
}

export function expandControlPath(h: Pick<HostConfig, 'alias' | 'hostname' | 'user' | 'port' | 'controlPathRaw'>): string | null {
  const raw = h.controlPathRaw
  if (!raw || raw === 'none') return null
  return raw.replace(/%(.)/g, (_, t: string) => {
    switch (t) {
      case 'n': return h.alias
      case 'h': return h.hostname
      case 'r': return h.user
      case 'p': return String(h.port)
      case 'l': return LOCAL.host
      case 'u': return LOCAL.user
      case 'd': return '~'
      case 'C': return pseudoHash(`${LOCAL.host}${h.hostname}${h.port}${h.user}`)
      case '%': return '%'
      default: return `%${t}`
    }
  })
}

export type OfferedKey = { keyId: string; via: 'agent' | 'IdentityFile' | 'domyślny plik' }

// Simplification: without IdentitiesOnly, agent keys are offered first, then IdentityFile (or default files)
export function offeredKeys(h: HostConfig): OfferedKey[] {
  const out: OfferedKey[] = []
  const add = (k: KeyDef | undefined, via: OfferedKey['via']) => { if (k && !out.some((o) => o.keyId === k.id)) out.push({ keyId: k.id, via }) }
  if (!h.identitiesOnly) KEYS.filter((k) => k.inAgent).forEach((k) => add(k, 'agent'))
  if (h.identityFiles.length) h.identityFiles.forEach((f) => add(keyByFile(f), 'IdentityFile'))
  else DEFAULT_IDS.forEach((f) => add(keyByFile(f), 'domyślny plik'))
  return out
}

/* ---------- authorized_keys ---------- */

export type AuthorizedKey = {
  line: number
  text: string
  type: string
  blob: string
  comment: string
  keyId: string | null
  command: string | null
  restrictions: string[]
  from: string[] | null
}
export type ParsedAuthorizedKeys = { entries: AuthorizedKey[]; diags: Diag[] }

const KEY_TYPES = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/
const FLAG_OPTS = ['no-pty', 'no-port-forwarding', 'no-agent-forwarding', 'no-x11-forwarding', 'no-user-rc', 'pty', 'port-forwarding', 'agent-forwarding', 'x11-forwarding', 'user-rc', 'no-touch-required', 'verify-required']
const RESTRICT_SET = ['no-pty', 'no-port-forwarding', 'no-agent-forwarding', 'no-X11-forwarding', 'no-user-rc']

// Split the options field honoring double quotes
function splitOptions(s: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (const c of s) {
    if (c === '"') q = !q
    if (c === ',' && !q) { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

export function parseAuthorizedKeys(text: string): ParsedAuthorizedKeys {
  const entries: AuthorizedKey[] = []
  const diags: Diag[] = []
  text.split('\n').forEach((raw, i) => {
    const no = i + 1
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    // options field = everything up to the first unquoted whitespace, unless it starts with a key type
    let rest = t, opts = ''
    const first = t.split(/\s+/)[0]
    if (!KEY_TYPES.test(first)) {
      let q = false, j = 0
      for (; j < t.length; j++) { if (t[j] === '"') q = !q; if (!q && /\s/.test(t[j])) break }
      opts = t.slice(0, j)
      rest = t.slice(j).trim()
    }
    const [type, blob, ...cm] = rest.split(/\s+/)
    if (!type || !KEY_TYPES.test(type) || !blob) { diags.push({ line: no, level: 'error', msg: 'sshd odrzuci linię: brak typu klucza albo klucza' }); return }
    let command: string | null = null
    let from: string[] | null = null
    const restrictions: string[] = []
    let bad = false
    for (const o of opts ? splitOptions(opts) : []) {
      const [k, ...vv] = o.split('=')
      const key = k.toLowerCase()
      const val = vv.join('=').replace(/^"(.*)"$/, '$1')
      if (key === 'command') command = val
      else if (key === 'from') from = val.split(',')
      else if (key === 'restrict') restrictions.push(...RESTRICT_SET)
      else if (FLAG_OPTS.includes(key)) {
        if (key.startsWith('no-')) restrictions.push(key === 'no-x11-forwarding' ? 'no-X11-forwarding' : key)
        else { const neg = `no-${key === 'x11-forwarding' ? 'X11-forwarding' : key}`; const idx = restrictions.indexOf(neg); if (idx >= 0) restrictions.splice(idx, 1) }
      } else if (['environment', 'permitopen', 'permitlisten', 'principals', 'tunnel', 'expiry-time'].includes(key)) diags.push({ line: no, level: 'warn', msg: `${key}: nie modelowane` })
      else { diags.push({ line: no, level: 'error', msg: `nieznana opcja „${k}” — sshd pominie całą linię` }); bad = true }
    }
    if (bad) return
    const keyId = keyByBlob(blob)?.id ?? null
    if (!keyId) diags.push({ line: no, level: 'info', msg: 'klucz nie należy do żadnego klucza na Macu' })
    else if (keyByBlob(blob)!.type !== type) diags.push({ line: no, level: 'error', msg: `typ ${type} nie zgadza się z kluczem ${keyShort(keyId)}` })
    if (keyId && entries.some((e) => e.keyId === keyId)) diags.push({ line: no, level: 'warn', msg: 'ten sam klucz wyżej — sshd użyje pierwszej pasującej linii' })
    entries.push({ line: no, text: t, type, blob, comment: cm.join(' '), keyId, command, restrictions: [...new Set(restrictions)], from })
  })
  return { entries, diags }
}

// First line for this key whose from= (if any) admits the client address
export function findAuthorizedKey(ak: ParsedAuthorizedKeys, keyId: string): { entry: AuthorizedKey | null; skipped: AuthorizedKey[] } {
  const skipped: AuthorizedKey[] = []
  for (const e of ak.entries) {
    if (e.keyId !== keyId || keyById(keyId)!.type !== e.type) continue
    if (e.from && !matchPatterns(e.from, LOCAL.ip)) { skipped.push(e); continue }
    return { entry: e, skipped }
  }
  return { entry: null, skipped }
}

/* ---------- sshd_config ---------- */

export type ParsedSshd = { global: Line[]; matches: { criteria: [string, string[]][]; line: number; items: Line[] }[]; diags: Diag[] }
const SSHD_MODELED = ['forcecommand', 'pubkeyauthentication', 'permittty', 'allowusers', 'denyusers', 'allowtcpforwarding', 'disableforwarding']

export function parseSshd(text: string): ParsedSshd {
  const p: ParsedSshd = { global: [], matches: [], diags: [] }
  for (const l of lines(text)) {
    if (l.key === 'match') {
      const parts = l.value.split(/\s+/)
      const criteria: [string, string[]][] = []
      if (parts[0]?.toLowerCase() === 'all') criteria.push(['all', []])
      else for (let i = 0; i < parts.length; i += 2) {
        const k = parts[i].toLowerCase()
        if (!['user', 'address', 'host', 'group'].includes(k) || !parts[i + 1]) { p.diags.push({ line: l.no, level: 'error', msg: `Match: nieobsługiwane kryterium „${parts[i]}”` }); continue }
        if (k === 'group' || k === 'host') p.diags.push({ line: l.no, level: 'warn', msg: `Match ${parts[i]}: przyjmuję, że nie pasuje` })
        criteria.push([k, parts[i + 1].split(',')])
      }
      p.matches.push({ criteria, line: l.no, items: [] })
      continue
    }
    if (!SSHD_MODELED.includes(l.key)) { p.diags.push({ line: l.no, level: 'warn', msg: `${l.raw.split(/[\s=]/)[0]}: nie modelowane, ignoruję` }); continue }
    if (['pubkeyauthentication', 'permittty', 'disableforwarding'].includes(l.key) && !yesNo(l.value)) { p.diags.push({ line: l.no, level: 'error', msg: 'oczekiwane yes albo no' }); continue }
    if (['allowusers', 'denyusers'].includes(l.key) && p.matches.length) p.diags.push({ line: l.no, level: 'info', msg: 'AllowUsers/DenyUsers działają globalnie' })
    ;(p.matches.at(-1)?.items ?? p.global).push(l)
  }
  return p
}

export type SshdEffective = {
  forceCommand: { cmd: string; line: number } | null
  pubkey: boolean
  permitTTY: boolean
  tcpForwarding: boolean
  userAllowed: { ok: boolean; why: string }
  matchedLines: number[]
}

// Global: first value wins. A matching Match block overrides global (first match block wins per keyword).
export function effectiveSshd(p: ParsedSshd, user: string): SshdEffective {
  const pick: Record<string, Line> = {}
  for (const l of p.global) if (!pick[l.key]) pick[l.key] = l
  const fromMatch: Record<string, Line> = {}
  const matchedLines: number[] = []
  for (const m of p.matches) {
    const ok = m.criteria.length > 0 && m.criteria.every(([k, v]) => k === 'all' || (k === 'user' && matchPatterns(v, user)) || (k === 'address' && matchPatterns(v, LOCAL.ip)))
    if (!ok) continue
    matchedLines.push(m.line)
    for (const l of m.items) if (!fromMatch[l.key]) fromMatch[l.key] = l
  }
  const eff = { ...pick, ...fromMatch }
  const allow = eff.allowusers?.value.split(/\s+/)
  const deny = eff.denyusers?.value.split(/\s+/)
  const fc = eff.forcecommand
  const noFwd = eff.disableforwarding?.value.toLowerCase() === 'yes'
  return {
    forceCommand: fc && fc.value.toLowerCase() !== 'none' ? { cmd: fc.value, line: fc.no } : null,
    pubkey: (eff.pubkeyauthentication?.value ?? 'yes').toLowerCase() === 'yes',
    permitTTY: (eff.permittty?.value ?? 'yes').toLowerCase() === 'yes',
    tcpForwarding: !noFwd && (eff.allowtcpforwarding?.value ?? 'yes').toLowerCase() !== 'no',
    userAllowed: deny && matchPatterns(deny, user)
      ? { ok: false, why: `DenyUsers (linia ${eff.denyusers.no}) blokuje ${user}` }
      : allow && !matchPatterns(allow, user)
        ? { ok: false, why: `AllowUsers (linia ${eff.allowusers.no}) nie obejmuje ${user}` }
        : { ok: true, why: '' },
    matchedLines,
  }
}

/* ---------- Gate allowlist DSL ---------- */

export type GateProfile = {
  id: string
  path: string // forced command path the gate lives at
  label: string
  repo: string
  binary: string
  allowed: string[]
  argPattern: string
  examples: string[]
}
export type ParsedGates = { gates: GateProfile[]; diags: Diag[] }

export const DEFAULT_ARG_PATTERN = '^[a-zA-Z0-9._/-]+$'

/*
gate /home/forge/bin/wt-gate
  cd /home/forge/repo
  exec ~/.local/bin/wt
  allow wt list
  arg ^[a-zA-Z0-9._/-]+$
*/
export function parseGates(text: string, examples: Record<string, string[]> = {}): ParsedGates {
  const gates: (GateProfile & { line: number; hasExec: boolean })[] = []
  const diags: Diag[] = []
  text.split('\n').forEach((raw, i) => {
    const no = i + 1
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    const [kw, ...rest] = t.split(/\s+/)
    const val = rest.join(' ')
    if (kw === 'gate') {
      if (!val.startsWith('/')) diags.push({ line: no, level: 'error', msg: 'gate: podaj ścieżkę absolutną skryptu' })
      const id = val.split('/').pop()!.replace(/-gate$/, '')
      gates.push({ id, path: val, label: id, repo: '/', binary: '', allowed: [], argPattern: DEFAULT_ARG_PATTERN, examples: [], line: no, hasExec: false })
      return
    }
    const g = gates.at(-1)
    if (!g) { diags.push({ line: no, level: 'error', msg: 'najpierw „gate /ścieżka”' }); return }
    if (kw === 'cd') g.repo = val
    else if (kw === 'exec') { g.binary = val; g.hasExec = true; if (!val.startsWith('/') && !val.startsWith('~')) diags.push({ line: no, level: 'warn', msg: 'ścieżka względna: sesja bez TTY często nie ma PATH' }) }
    else if (kw === 'allow') {
      if (rest.length !== 2) { diags.push({ line: no, level: 'error', msg: 'allow: dokładnie dwa słowa (<komenda> <podkomenda>), jak w case "$a0 $a1"' }); return }
      g.allowed.push(val)
    } else if (kw === 'arg') {
      try { new RegExp(val); g.argPattern = val } catch { diags.push({ line: no, level: 'error', msg: 'arg: niepoprawny regex' }) }
      if (!val.startsWith('^') || !val.endsWith('$')) diags.push({ line: no, level: 'warn', msg: 'regex bez ^…$ dopasuje fragment — przepuści dowolne znaki obok' })
    } else diags.push({ line: no, level: 'error', msg: `nieznane słowo „${kw}” (gate, cd, exec, allow, arg)` })
  })
  for (const g of gates) {
    if (!g.hasExec) diags.push({ line: g.line, level: 'error', msg: `${g.path}: brak exec — gate pominięty` })
    if (!g.allowed.length) diags.push({ line: g.line, level: 'warn', msg: `${g.path}: pusta allowlista — odmówi wszystkiego` })
    g.examples = examples[g.id] ?? [...g.allowed.map((a) => a), 'rm -rf ~']
    if (gates.filter((x) => x.path === g.path).length > 1) diags.push({ line: g.line, level: 'warn', msg: 'ta ścieżka jest zdefiniowana wyżej — używam pierwszej' })
  }
  return { gates: gates.filter((g) => g.hasExec).map(({ line: _l, hasExec: _h, ...g }) => g), diags }
}

export function gatesText(gs: Pick<GateProfile, 'path' | 'repo' | 'binary' | 'allowed' | 'argPattern'>[]) {
  return gs.map((g) => [`gate ${g.path}`, `  cd ${g.repo}`, `  exec ${g.binary}`, ...g.allowed.map((a) => `  allow ${a}`), `  arg ${g.argPattern}`].join('\n')).join('\n\n')
}
