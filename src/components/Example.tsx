import type { ReactNode } from 'react'

type Props = { title: string; description: string; state: unknown; children: ReactNode; wide?: boolean; actions?: ReactNode; className?: string }

export function Example({ title, description, state, children, wide, actions, className }: Props) {
  return (
    <section className={['example', wide && 'wide', className].filter(Boolean).join(' ')}>
      <header className="example-header">
        <span className="example-dot" />
        <h2>{title}</h2>
        {actions && <div className="example-actions">{actions}</div>}
      </header>
      <p className="muted">{description}</p>
      <div className="controls">{children}</div>
      {state !== null && (
        <div className="state">
          <span className="state-label">snapshot</span>
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </div>
      )}
    </section>
  )
}
