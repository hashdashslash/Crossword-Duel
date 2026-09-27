const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

interface Props {
  onLetter: (letter: string) => void;
  onBackspace: () => void;
}

/** On-screen letter keyboard for phones (the phone's own keyboard is never opened). */
export function Keyboard({ onLetter, onBackspace }: Props) {
  const press = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    fn();
  };
  return (
    <div className="keyboard" role="group" aria-label="Keyboard">
      {ROWS.map((row, i) => (
        <div className="kb-row" key={row}>
          {[...row].map((ch) => (
            <button key={ch} className="key" onPointerDown={press(() => onLetter(ch))} aria-label={ch}>
              {ch}
            </button>
          ))}
          {i === 2 && (
            <button className="key key-wide" onPointerDown={press(onBackspace)} aria-label="Backspace">
              ⌫
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
