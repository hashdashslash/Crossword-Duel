import { DIFFICULTIES, type Difficulty } from '../../../shared/config';

export const LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function DifficultyPicker({ value, onChange, disabled }: { value: Difficulty; onChange: (d: Difficulty) => void; disabled?: boolean }) {
  return (
    <div className={`segmented ${disabled ? 'disabled' : ''}`} role="radiogroup" aria-label="Difficulty">
      {DIFFICULTIES.map((d) => (
        <button key={d} role="radio" aria-checked={d === value} className={d === value ? 'on' : ''} disabled={disabled} onClick={() => onChange(d)}>
          {LABELS[d]}
        </button>
      ))}
    </div>
  );
}
