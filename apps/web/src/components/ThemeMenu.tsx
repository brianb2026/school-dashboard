import { useEffect, useRef, useState } from "react";
import { applyTheme, savedTheme, THEMES, type Theme } from "../lib/theme";
import { Icon } from "./Icon";

/** The theme list: a preview chip and a name for each. */
export function ThemePicker({ value, onPick }: { value: Theme; onPick: (t: Theme) => void }) {
  return (
    <div className="theme-list" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={value === t.id} className={`theme-opt ${value === t.id ? "on" : ""}`} onClick={() => onPick(t.id)}>
          <span className="theme-chip" aria-hidden style={{ background: t.preview[0] }}>
            <i style={{ background: t.preview[1] }} />
            <b style={{ background: t.preview[2] }} />
          </span>
          <span className="theme-text">
            <span>{t.name}</span>
            <span className="faint">{t.note}</span>
          </span>
          {value === t.id && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );
}

/** Top-bar button that opens the theme list. */
export function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  // Settings can change it too.
  useEffect(() => {
    const sync = () => setTheme(savedTheme());
    window.addEventListener("sd-theme", sync);
    return () => window.removeEventListener("sd-theme", sync);
  }, []);
  const dark = ["dark", "midnight", "mocha"].includes(theme);
  return (
    <div className="menu-wrap" ref={box}>
      <button type="button" className="icon-btn theme-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" aria-label="Theme" title="Theme">
        <Icon name={theme === "auto" ? "auto" : dark ? "moon" : "sun"} />
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label="Theme">
          <ThemePicker
            value={theme}
            onPick={(t) => {
              setTheme(t);
              pickTheme(t);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Apply a theme everywhere on the page (the top-bar menu and Settings stay in step). */
export function pickTheme(t: Theme): void {
  applyTheme(t);
  window.dispatchEvent(new Event("sd-theme"));
}
