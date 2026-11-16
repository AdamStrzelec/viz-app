import { DEFAULT_SSHD, KEYS, authorizedKeysText, sshConfigText, type Alias, type Files, type MuxMode } from './domain.ts'

// A scenario is a declarative event sequence for the SAME actor. Outcomes come from the machine, never from here.
export type ScenarioRequest = {
  alias: Alias
  command: string
  touch?: boolean // autoplay presses the YubiKey when asked
  before?: { type: 'ADVANCE_TIME'; ms: number }[] // environment events sent before this request
  note: string
}

export type Scenario = {
  id: string
  title: string
  mux: MuxMode
  profileId: string
  files?: Partial<Files> // overrides applied after the presets
  requests: ScenarioRequest[]
  expect: string // what a reader might expect
  lesson: string // what actually happens and why
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'gate-ok',
    title: '1. Klucz ograniczony → gate → dozwolona komenda',
    mux: 'per-alias',
    profileId: 'wt',
    requests: [{ alias: 'wt-forge', command: 'wt list --porcelain', note: 'nowe połączenie kluczem id_ed25519_gate' }],
    expect: 'Komenda przejdzie przez gate.',
    lesson: 'Gate przepuszcza parę „wt list”, ale --porcelain to opcja. Regex jej nie zatrzymuje, bo nie ocenia znaczenia argumentów.',
  },
  {
    id: 'gate-deny',
    title: '2. Klucz ograniczony → odrzucenie komendy',
    mux: 'per-alias',
    profileId: 'wt',
    requests: [{ alias: 'wt-forge', command: 'wt new "x; rm -rf ~"', note: 'próba wstrzyknięcia przez cudzysłów' }],
    expect: 'Cudzysłów zgrupuje argument.',
    lesson: 'read -r nie interpretuje cudzysłowów. Token "x; ma średnik i odpada na regexie. Nic nie zostaje uruchomione.',
  },
  {
    id: 'yubikey',
    title: '3. Nowe połączenie YubiKey → dotyk → wykonanie bez gate',
    mux: 'per-alias',
    profileId: 'wt',
    requests: [{ alias: 'forge', command: 'uptime', touch: true, note: 'podpis wymaga dotyku' }],
    expect: 'Każda komenda idzie przez gate.',
    lesson: 'Linia YubiKey w authorized_keys nie ma command=, więc sshd wykonuje komendę klienta bez gate. To nie jest interaktywny shell, bo komenda została podana.',
  },
  {
    id: 'timeout',
    title: '4. Brak dotyku → timeout',
    mux: 'per-alias',
    profileId: 'wt',
    requests: [{ alias: 'forge', command: 'uptime', touch: false, note: 'nikt nie dotyka klucza' }],
    expect: 'ssh poczeka w nieskończoność.',
    lesson: 'Podpis nie powstaje, więc uwierzytelnienie się nie udaje. Nie powstaje też master, a komenda nie dociera do serwera.',
  },
  {
    id: 'shared-restricted-first',
    title: '5. Współdzielony ControlPath: wt-forge, potem forge',
    mux: 'shared',
    profileId: 'wt',
    requests: [
      { alias: 'wt-forge', command: 'wt list', note: 'krok 1: powstaje master z kluczem ograniczonym' },
      { alias: 'forge', command: 'uptime', touch: true, note: 'krok 2: ssh forge trafia na ten sam ControlPath' },
    ],
    expect: 'ssh forge poprosi o YubiKey i wykona komendę bez gate.',
    lesson: 'Oba aliasy rozwiązują się do cm-forge@forge.lan:22. Drugie żądanie wchodzi w master c1, nie uwierzytelnia się i dziedziczy forced command. „uptime” odpada w gate.',
  },
  {
    id: 'shared-yubikey-first',
    title: '6. Współdzielony ControlPath: forge, potem wt-forge',
    mux: 'shared',
    profileId: 'wt',
    requests: [
      { alias: 'forge', command: 'uptime', touch: true, note: 'krok 1: master uwierzytelniony YubiKey' },
      { alias: 'wt-forge', command: 'cat /etc/hostname', note: 'krok 2: alias ograniczony, ale ten sam ControlPath' },
    ],
    expect: 'wt-forge zawsze trafia do gate.',
    lesson: 'Drugie żądanie używa połączenia YubiKey, więc gate w ogóle nie istnieje. To obejście zamierzonego rozdzielenia polityk przez lokalny master, nie eskalacja uprawnień w Linuksie.',
  },
  {
    id: 'per-alias',
    title: '7. Osobne ControlPath (%n): dwa niezależne mastery',
    mux: 'per-alias',
    profileId: 'wt',
    requests: [
      { alias: 'wt-forge', command: 'wt list', note: 'krok 1: master cm-wt-forge' },
      { alias: 'forge', command: 'uptime', touch: true, note: 'krok 2: inna ścieżka, nowe uwierzytelnienie' },
      { alias: 'wt-forge', command: 'wt list', note: 'krok 3: reuse własnego mastera' },
    ],
    expect: 'Jak w scenariuszu 5.',
    lesson: 'Każdy alias ma własne gniazdo. Reuse dzieje się tylko w obrębie jednego aliasu, więc polityki pozostają rozdzielone.',
  },
  {
    id: 'expire',
    title: '8. Wygaśnięcie mastera → ponowne uwierzytelnienie',
    mux: 'per-alias',
    profileId: 'wt',
    requests: [
      { alias: 'wt-forge', command: 'wt list', note: 'krok 1: master z ControlPersist 10m' },
      { alias: 'wt-forge', command: 'wt list', before: [{ type: 'ADVANCE_TIME', ms: 11 * 60_000 }], note: 'krok 2: po 11 min symulowanych' },
    ],
    expect: 'Drugie wywołanie użyje mastera.',
    lesson: 'ControlPersist liczy czas od zakończenia ostatniej sesji. Po 10 minutach master wygasa, lookup nic nie znajduje i następuje nowe uwierzytelnienie.',
  },
  {
    id: 'percent-c',
    title: '9. ControlPath %C: wygląda na unikalny, ale łączy aliasy',
    mux: 'per-alias',
    profileId: 'wt',
    files: { sshConfig: sshConfigText('per-alias').replaceAll('~/.ssh/cm-%n', '~/.ssh/cm-%C') },
    requests: [
      { alias: 'wt-forge', command: 'wt list', note: 'krok 1: master kluczem ograniczonym' },
      { alias: 'forge', command: 'uptime', touch: true, note: 'krok 2: %C dla forge' },
    ],
    expect: '%C to hash, więc każdy alias dostanie własne gniazdo.',
    lesson: '%C liczy skrót z %l%h%p%r — bez aliasu. Oba aliasy mają tego samego usera, host i port, więc gniazdo jest wspólne jak przy cm-%r@%h:%p. Rozdziela dopiero %n albo inny User.',
  },
  {
    id: 'force-command',
    title: '10. sshd_config ForceCommand: YubiKey też trafia do gate',
    mux: 'per-alias',
    profileId: 'wt',
    files: { sshdConfig: `${DEFAULT_SSHD}\nMatch User forge\n    ForceCommand /home/forge/bin/backup-gate\n` },
    requests: [
      { alias: 'forge', command: 'uptime', touch: true, note: 'YubiKey, linia bez command=' },
      { alias: 'wt-forge', command: 'wt list', note: 'klucz z command=wt-gate' },
    ],
    expect: 'forge wykona komendę bez gate, wt-forge pójdzie do wt-gate.',
    lesson: 'ForceCommand z sshd_config ma pierwszeństwo przed command= z authorized_keys. Oba klucze trafiają do backup-gate, więc „uptime” i „wt list” są odrzucane.',
  },
  {
    id: 'identities-only',
    title: '11. Bez IdentitiesOnly: agent oferuje inny klucz pierwszy',
    mux: 'per-alias',
    profileId: 'wt',
    files: {
      sshConfig: sshConfigText('per-alias').replace(/(Host wt-forge[\s\S]*?)\n    IdentitiesOnly yes/, '$1'),
      authorizedKeys: `${authorizedKeysText('wt')}${KEYS[2].type} ${KEYS[2].blob} ${KEYS[2].comment}\n`,
    },
    requests: [{ alias: 'wt-forge', command: 'cat /etc/hostname', note: 'wt-forge bez IdentitiesOnly, id_ed25519 w ssh-agent' }],
    expect: 'wt-forge użyje id_ed25519_gate z IdentityFile i trafi do gate.',
    lesson: 'Bez IdentitiesOnly ssh oferuje też klucze z agenta. id_ed25519 jest w authorized_keys bez command=, sshd przyjmuje go pierwszy i gate nie istnieje dla tego połączenia. (Uproszczenie: agent przed IdentityFile.)',
  },
]
