import type { ReactNode } from 'react'

type Props = { title: string; description: string; state: unknown; children: ReactNode; wide?: boolean; actions?: ReactNode }

export function Example({ title, description, state, children, wide, actions }: Props) {
  return (
    <section className={wide ? 'example wide' : 'example'}>
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
