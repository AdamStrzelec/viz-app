import type { NodeId, Run } from '../ssh.machine.ts'

// Pure projection of a Run onto scene nodes/edges. Works for live and historical runs alike.

export type NodeStatus = 'inactive' | 'active' | 'done' | 'skipped' | 'failed'
export type NodeView = { status: NodeStatus; note: string | null }

export const NODE_META: Record<NodeId, { title: string; zone: 'client' | 'server'; role: string }> = {
  request: { title: 'Żądanie', zone: 'client', role: 'Polecenie ssh z aliasem i komendą. Alias wskazuje zamierzony klucz, ale nie przesądza o tożsamości połączenia.' },
  path: { title: 'ControlPath', zone: 'client', role: 'Klient rozwija wzorzec ControlPath. Wynik to ścieżka lokalnego gniazda: punktu dostępu do mastera, a nie samego połączenia.' },
  lookup: { title: 'Lookup mastera', zone: 'client', role: 'Klient sprawdza, czy pod tą ścieżką czeka żywy master. Od tego zależy, czy nastąpi nowe uwierzytelnienie.' },
  channel: { title: 'Nowy kanał w masterze', zone: 'client', role: 'Reuse: nowa sesja to kanał w istniejącym, już uwierzytelnionym połączeniu. Bez nowego podpisu i bez ponownego wyboru reguły.' },
  auth: { title: 'Nowe uwierzytelnienie', zone: 'server', role: 'sshd wysyła wyzwanie, klient odpowiada podpisem (dowodem posiadania klucza). Klucz prywatny nie opuszcza Maca.' },
  rule: { title: 'Reguła authorized_keys', zone: 'server', role: 'sshd wybiera linię po kluczu, którym faktycznie się uwierzytelniono. Opcje tej linii stają się polityką połączenia.' },
  policy: { title: 'Polityka połączenia', zone: 'server', role: 'Ograniczenia przypisane do połączenia na całe jego życie: forced command, no-pty, brak forwardingu.' },
  gate: { title: 'Gate (forced command)', zone: 'server', role: 'Skrypt uruchamiany zamiast komendy klienta. Komenda klienta trafia do niego jako SSH_ORIGINAL_COMMAND.' },
  exec: { title: 'Wykonanie bez gate', zone: 'server', role: 'Brak command= w regule: sshd wykonuje komendę klienta przez shell użytkownika, a przy pustej komendzie otwiera interaktywny shell.' },
  result: { title: 'Wynik (symulacja)', zone: 'server', role: 'Wynik decyzji modelu. Nic nie zostało faktycznie uruchomione.' },
}

export function nodeView(run: Run | null, id: NodeId): NodeView {
  if (!run) return { status: 'inactive', note: null }
  const o = run.outcome
  if (o?.kind === 'denied' && id === 'gate') return { status: 'failed', note: `odrzucono: ${o.reason}` }
  if (o?.kind === 'auth-failed' && id === 'auth') return { status: 'failed', note: o.reason }
  if (run.status !== 'finished' && run.at === id) return { status: 'active', note: run.status === 'awaiting-touch' ? `czekam na dotyk: ${run.touchWaitedMs / 1000}/30 s` : null }
  if (run.path.includes(id)) return { status: 'done', note: null }

  if (run.mode === 'reuse' && (id === 'auth' || id === 'rule')) return { status: 'skipped', note: `pominięte: reuse mastera ${run.connectionId}, połączenie już uwierzytelnione` }
  if (run.mode === 'new' && id === 'channel') return { status: 'skipped', note: run.controlPath ? 'nie dotyczy: lookup nie znalazł mastera' : 'nie dotyczy: ControlPath none' }
  if (run.policy && run.at !== 'rule' && run.path.includes('policy')) {
    if (run.policy.kind === 'forced' && id === 'exec') return { status: 'skipped', note: 'pominięte: reguła wymusza command=, komenda klienta trafia do gate' }
    if (run.policy.kind === 'none' && id === 'gate') return { status: 'skipped', note: 'pominięte: reguła bez command=, gate nie istnieje dla tego połączenia' }
  }
  if (o?.kind === 'denied' && id === 'result') return { status: 'skipped', note: 'nie osiągnięto: odmowa w gate' }
  if (o?.kind === 'auth-failed') return { status: 'skipped', note: 'nie osiągnięto: brak połączenia' }
  return { status: 'inactive', note: null }
}

export type EdgeDef = { from: NodeId; to: NodeId; label?: string; points: [number, number][] }
export type EdgeStatus = 'idle' | 'taken' | 'active' | 'skipped'

export function edgeStatus(run: Run | null, e: EdgeDef): EdgeStatus {
  if (!run) return 'idle'
  const i = run.path.findIndex((n, k) => n === e.from && run.path[k + 1] === e.to)
  if (i >= 0) return run.status !== 'finished' && run.at === e.to ? 'active' : 'taken'
  const target = nodeView(run, e.to).status
  return target === 'skipped' && run.path.includes(e.from) ? 'skipped' : 'idle'
}
