/** A small on/off switch with its label. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <span className="track" aria-hidden>
        <span className="knob" />
      </span>
      {label}
    </button>
  );
}
