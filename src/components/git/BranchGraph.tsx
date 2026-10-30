import { useMemo, type KeyboardEvent } from 'react'
import { ancestors, headCommitId, type BranchesContext } from '../../machines/git.machine'
import { PILL_HEIGHT, RADIUS, layoutGraph, type Label } from './graphLayout'

const laneColor = (lane: number) => `var(--git-branch-${(lane % 4) + 1})`
const pillWidth = (text: string) => text.length * 6.6 + 16

// Enter / Space activate an SVG element exposed as a button
const onActivate = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    action()
  }
}

function Pill({ label, x, y, color, onCheckout }: { label: Label; x: number; y: number; color: string; onCheckout?: () => void }) {
  const width = pillWidth(label.text)
  return (
    <g
      className={onCheckout ? `git-pill ${label.kind} clickable` : `git-pill ${label.kind}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      {...(onCheckout && {
        role: 'button',
        tabIndex: 0,
        'aria-label': `checkout ${label.text}`,
        onClick: onCheckout,
        onKeyDown: onActivate(onCheckout),
      })}
    >
      <rect x={-width / 2} y={0} width={width} height={PILL_HEIGHT} rx={PILL_HEIGHT / 2} style={{ stroke: label.kind === 'branch' || label.kind === 'branch-active' ? color : undefined }} />
      <text x={0} y={PILL_HEIGHT / 2 + 4} textAnchor="middle">
        {label.kind === 'head-detached' ? `⚠ ${label.text}` : label.text}
      </text>
    </g>
  )
}

export function BranchGraph({ context, onCheckout }: { context: BranchesContext; onCheckout: (target: string) => void }) {
  const { commits, branches, head } = context
  const layout = useMemo(() => layoutGraph(commits, branches, head), [commits, branches, head])
  const reachable = useMemo(() => ancestors(commits, headCommitId(context)), [commits, context])
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))

  const summary =
    head.kind === 'branch'
      ? `HEAD na branchu ${head.name}, commit ${branches[head.name]}.`
      : `Detached HEAD na commicie ${head.id}.`
  const description = `${summary} Branche: ${Object.entries(branches).map(([n, id]) => `${n} → ${id}`).join(', ')}. Liczba commitów: ${commits.length}.`

  return (
    <>
      {head.kind === 'detached' && (
        <p className="badge no" role="status">⚠ Detached HEAD — nowe commity nie należą do żadnego brancha. Utwórz branch, żeby ich nie zgubić.</p>
      )}
      <p className="muted" aria-live="polite">{summary}</p>
      <div className="git-graph-scroll">
        <svg className="git-graph" role="img" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
          <title>Graf commitów</title>
          <desc>{description}</desc>

          {layout.edges.map((e) => {
            const from = byId.get(e.from)!
            const to = byId.get(e.to)!
            const mid = (from.x + to.x) / 2
            const d = from.y === to.y ? `M${from.x},${from.y} L${to.x},${to.y}` : `M${from.x},${from.y} C${mid},${from.y} ${mid},${to.y} ${to.x},${to.y}`
            return (
              <path
                key={`${e.from}-${e.to}`}
                d={d}
                pathLength={1}
                className={['git-edge', e.secondParent && 'second', !reachable.has(e.to) && 'dim'].filter(Boolean).join(' ')}
                style={{ stroke: laneColor(e.secondParent ? from.lane : to.lane) }}
              />
            )
          })}

          {layout.nodes.map((n) => (
            <g
              key={n.id}
              className={reachable.has(n.id) ? 'git-commit' : 'git-commit dim'}
              role="button"
              tabIndex={0}
              aria-label={`checkout commit ${n.id}`}
              onClick={() => onCheckout(n.id)}
              onKeyDown={onActivate(() => onCheckout(n.id))}
            >
              <circle cx={n.x} cy={n.y} r={22} className="git-hit" />
              {n.merge && <circle cx={n.x} cy={n.y} r={RADIUS + 4} className="git-merge-ring" style={{ stroke: laneColor(n.lane) }} />}
              <circle cx={n.x} cy={n.y} r={RADIUS} style={{ fill: laneColor(n.lane) }} />
              <text x={n.x} y={n.y + RADIUS + 16} textAnchor="middle" className="git-commit-id">{n.id}</text>
            </g>
          ))}

          {Object.keys(layout.labels).map((id) => {
            const node = byId.get(id)!
            return (
              <line key={`ptr-${id}`} x1={node.x} y1={node.y - RADIUS - 6} x2={node.x} y2={node.y - RADIUS} className="git-pointer" />
            )
          })}

          {/* Pills are keyed by identity (branch name / HEAD), not by commit, so a moved pointer slides instead of remounting */}
          {Object.entries(layout.labels).flatMap(([id, labels]) => {
            const node = byId.get(id)!
            const stackTop = node.y - RADIUS - 6
            return labels.map((label, i) => (
              <Pill
                key={label.kind.startsWith('head') ? 'HEAD' : `branch:${label.text}`}
                label={label}
                x={node.x}
                y={stackTop - (i + 1) * (PILL_HEIGHT + 2) + 2}
                color={laneColor(node.lane)}
                onCheckout={label.kind === 'branch' ? () => onCheckout(label.text) : undefined}
              />
            ))
          })}
        </svg>
      </div>
    </>
  )
}
