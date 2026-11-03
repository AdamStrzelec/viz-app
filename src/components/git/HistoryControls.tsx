type Props = { past: number; future: number; onUndo: () => void; onRedo: () => void }

// Undo / redo buttons plus a "step n of m" counter; disabled state follows the history lengths
export function HistoryControls({ past, future, onUndo, onRedo }: Props) {
  return (
    <div className="git-history" role="group" aria-label="Historia kroków">
      <button disabled={past === 0} onClick={onUndo}>↶ Cofnij</button>
      <button disabled={future === 0} onClick={onRedo}>↷ Ponów</button>
      <span className="git-steps">Krok {past} z {past + future}</span>
    </div>
  )
}
